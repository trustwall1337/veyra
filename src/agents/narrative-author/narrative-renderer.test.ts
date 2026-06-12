import { describe, expect, it } from 'vitest';

import type { ClaimRecord } from '../../types/claim-record.js';
import type { Finding } from '../../types/finding.js';

import { composeClaimsFromFindings } from './agent.js';
import { lintClaims, lintContextFromFindings } from './claim-linter.js';
import {
  deterministicFallback,
  renderNarrative,
} from './narrative-renderer.js';

const FORBIDDEN_LANGUAGE = /\b(secure|securely|safe|safely|compliant|compliance)\b/i;

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f-1',
    control_id: 'cc-test',
    finding_type: 'informational',
    evidence_strength: 'low',
    reproducibility: 'static',
    review_action: 'monitor',
    blast_radius: 'unknown',
    title: 'tool-a',
    summary: 'sample',
    evidence_refs: ['ev-1'],
    ...overrides,
  };
}

describe('narrative-author — emits structured ClaimRecord[] (Verification a)', () => {
  it('produces only structured records; no prose strings on the surface', () => {
    const findings = [finding({ id: 'cg-1', finding_type: 'coverage_gap', title: 'scanner_secrets_run', control_id: 'cc-11-7' })];
    const claims = composeClaimsFromFindings({ findings, artifact_refs: [] });
    expect(claims.length).toBe(1);
    for (const claim of claims) {
      expect(typeof claim.claim_type).toBe('string');
      expect(typeof claim.predicate_kind).toBe('string');
      expect(typeof claim.subject_id).toBe('string');
      // every template_params value must be a string scalar (no nested prose)
      for (const v of Object.values(claim.template_params)) {
        expect(typeof v).toBe('string');
      }
    }
  });
});

describe('claim-linter (Verification b/c)', () => {
  it('passes when every field resolves and the template exists', () => {
    const findings = [finding({ id: 'cg-1', finding_type: 'coverage_gap', title: 'scanner_secrets_run', control_id: 'cc-11-7' })];
    const claims = composeClaimsFromFindings({ findings, artifact_refs: [] });
    const ctx = lintContextFromFindings(findings, [], []);
    const report = lintClaims(claims, ctx);
    expect(report.ok).toBe(true);
  });

  it('rejects an unknown claim_type', () => {
    const bad: ClaimRecord = {
      claim_type: 'frobnicate',
      predicate_kind: 'coverage_gap',
      subject_id: 'cc-test',
      predicate_output_id: 'f-1',
      supporting_artifact_refs: ['f-1'],
      template_params: {},
    };
    const ctx = lintContextFromFindings([finding()], [], []);
    const report = lintClaims([bad], ctx);
    expect(report.ok).toBe(false);
    expect(report.failures[0]?.failure.kind).toBe('unknown_claim_type');
  });

  it('rejects when supporting_artifact_refs is empty', () => {
    const bad: ClaimRecord = {
      claim_type: 'informational',
      predicate_kind: 'tool_succeeded',
      subject_id: 'cc-test',
      predicate_output_id: 'f-1',
      supporting_artifact_refs: [],
      template_params: { tool_id: 'x' },
    };
    const ctx = lintContextFromFindings([finding()], [], []);
    const report = lintClaims([bad], ctx);
    expect(report.ok).toBe(false);
    expect(report.failures[0]?.failure.kind).toBe('no_supporting_refs');
  });

  it('rejects when a (claim_type, predicate_kind) has no template', () => {
    const bad: ClaimRecord = {
      claim_type: 'informational',
      predicate_kind: 'unknown_predicate_xyz',
      subject_id: 'cc-test',
      predicate_output_id: 'f-1',
      supporting_artifact_refs: ['f-1'],
      template_params: {},
    };
    const ctx = lintContextFromFindings([finding()], [], []);
    const report = lintClaims([bad], ctx);
    expect(report.ok).toBe(false);
    expect(report.failures[0]?.failure.kind).toBe('missing_template');
  });
});

describe('renderer is pure (Verification d)', () => {
  it('same records → same prose, byte-identical', () => {
    const findings = [finding({ id: 'cg-1', finding_type: 'coverage_gap', title: 'scanner_secrets_run', control_id: 'cc-11-7' })];
    const claims = composeClaimsFromFindings({ findings, artifact_refs: [] });
    const ctx = lintContextFromFindings(findings, [], []);
    const a = renderNarrative(claims, ctx, findings);
    const b = renderNarrative(claims, ctx, findings);
    expect(a.prose).toBe(b.prose);
  });

  it('hard-fails to the deterministic fallback when linter rejects (Verification c)', () => {
    const findings = [finding({ id: 'cg-1', finding_type: 'coverage_gap' })];
    const bad: ClaimRecord = {
      claim_type: 'frobnicate',
      predicate_kind: 'coverage_gap',
      subject_id: 'cc-test',
      predicate_output_id: 'cg-1',
      supporting_artifact_refs: ['cg-1'],
      template_params: {},
    };
    const ctx = lintContextFromFindings(findings, [], []);
    const result = renderNarrative([bad], ctx, findings);
    expect(result.used_fallback).toBe(true);
    expect(result.lint.ok).toBe(false);
  });
});

describe('output-language-lint clean (Verification e)', () => {
  it('rendered narrative never uses forbidden trust-model words', () => {
    const findings = [
      finding({ id: 'cg-1', finding_type: 'coverage_gap', title: 'scanner_secrets_run', control_id: 'cc-11-7' }),
      finding({ id: 'i-1', finding_type: 'informational', title: 'read-code', control_id: 'cc-test' }),
    ];
    const claims = composeClaimsFromFindings({ findings, artifact_refs: [] });
    const ctx = lintContextFromFindings(findings, [], []);
    const result = renderNarrative(claims, ctx, findings);
    expect(FORBIDDEN_LANGUAGE.test(result.prose)).toBe(false);
  });

  it('fallback prose is also output-language-lint clean', () => {
    const findings = [finding({ id: 'b-1', review_action: 'fix_before_launch' })];
    const prose = deterministicFallback(findings);
    expect(FORBIDDEN_LANGUAGE.test(prose)).toBe(false);
  });
});

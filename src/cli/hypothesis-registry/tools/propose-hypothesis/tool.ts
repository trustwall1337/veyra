/**
 * propose-hypothesis tool (Phase 3 / Step 40e).
 *
 * AI authors a hypothesis. Layer-1 schema reject on unknown fields;
 * Layer-2 prewrite guard runs `containsClassificationStringToken` +
 * `containsClaimVocabularyToken` + recursive `containsClassificationKey`
 * BEFORE the registry mutates (Decision D + codex 40e-plan-04 [APPLIED]).
 *
 * Returns `{facts: []}` (Decision L per codex 40e-plan-02 [APPLIED]) —
 * hypothesis-tool acknowledgements never enter the evidence fact stream.
 * The AI reads `view.hypotheses` on the next iteration.
 */

import { z } from 'zod';

import { type ToolDescriptor } from '../../../../core/tools/descriptor.js';
import { asToolId } from '../../../../core/tools/tool-id.js';
import { err, isErr, ok } from '../../../../types/result.js';
import {
  containsClassificationKey,
  type ToolResult,
  toolResultSchema,
} from '../../../../types/tool-result.js';

import type { HypothesisRegistry } from '../../registry.js';
import {
  ClaimVocabularyInArgsError,
  ClassificationKeyInArgsError,
  UnknownStepRefError,
} from '../../types.js';
import {
  containsClaimVocabularyToken,
  containsClassificationStringToken,
} from '../../validate.js';

export const PROPOSE_HYPOTHESIS_TOOL_ID = 'propose-hypothesis';

export const proposeHypothesisArgsSchema = z
  .strictObject({
    statement: z.string().min(1).max(2000),
    confidence: z.enum(['low', 'medium', 'high']),
    control_id_hint: z.string().min(1).max(128).optional(),
    briefing_field_ref: z.string().min(1).max(128).optional(),
    step_refs: z.array(z.number().int().nonnegative()).optional(),
  });

export type ProposeHypothesisArgs = z.infer<typeof proposeHypothesisArgsSchema>;

export interface CreateProposeHypothesisToolDeps {
  readonly registry: HypothesisRegistry;
  /** Loop-side redactor (the chokepoint AI strings pass through). */
  readonly redactor: (raw: string) => string;
  /** Read-only: is this loop-trace seq an accepted tool-call step? */
  readonly isAcceptedStepRef: (seq: number) => boolean;
  /** Audit metadata for the hypothesis row. */
  readonly modelId?: string;
}

export function createProposeHypothesisTool(
  deps: CreateProposeHypothesisToolDeps,
): ToolDescriptor<ProposeHypothesisArgs, ToolResult> {
  const idR = asToolId(PROPOSE_HYPOTHESIS_TOOL_ID);
  if (isErr(idR)) throw new Error(`invalid tool id: ${idR.error.message}`);

  return {
    tool_id: idR.value,
    title:
      'Propose an AI hypothesis about a likely-risk area, citing optional briefing fields and prior accepted-step references; the registry persists it for view.hypotheses on the next iteration.',
    args_schema: proposeHypothesisArgsSchema,
    result_schema: toolResultSchema,
    required_action: 'author_hypothesis',
    source_module:
      'src/cli/hypothesis-registry/tools/propose-hypothesis/tool.ts',
    invoke: async (args) => {
      // Layer-2 prewrite guard (Decision D). Schema-level (Layer 1)
      // strict-object already rejected unknown top-level fields.
      // Return the specific error subclass directly so the loop's trace
      // row carries `tool_error_class: 'ClassificationKeyInArgsError'`
      // (codex 40e-diff-002 [APPLIED]).
      if (containsClassificationKey(args)) {
        return err(
          new ClassificationKeyInArgsError(
            'propose-hypothesis args contained a classification key at some depth',
          ),
        );
      }
      // Walk the entire args object — catches scalar-string smuggling in
      // statement, control_id_hint, briefing_field_ref (any AI-authored
      // string field), not just `statement`.
      if (containsClassificationStringToken(args)) {
        return err(
          new ClassificationKeyInArgsError(
            'propose-hypothesis args contained a classification-key token in a scalar string',
          ),
        );
      }
      if (containsClaimVocabularyToken(args)) {
        return err(
          new ClaimVocabularyInArgsError(
            'propose-hypothesis args contained a claim-vocabulary token (secure/safe/compliant/vulnerable/exploit/launch-blocker/confirmed/proven_*)',
          ),
        );
      }

      // Decision M soft-mode: propose-hypothesis MAY cite step_refs, but
      // does NOT require them. If supplied, every entry must ground to
      // an accepted loop step.
      if (args.step_refs !== undefined && args.step_refs.length > 0) {
        for (const seq of args.step_refs) {
          if (!deps.isAcceptedStepRef(seq)) {
            return err(
              new UnknownStepRefError(
                `propose-hypothesis step_ref ${String(seq)} is not an accepted loop step`,
              ),
            );
          }
        }
      }

      const redacted = deps.redactor(args.statement);

      // `registry.propose` returns Result<LoopHypothesis, never> — minted
      // ids are deterministic + storage cannot fail. Discard the return.
      deps.registry.propose({
        statement: redacted,
        confidence: args.confidence,
        ...(args.control_id_hint !== undefined
          ? { control_id_hint: args.control_id_hint }
          : {}),
        ...(args.briefing_field_ref !== undefined
          ? { briefing_field_ref: args.briefing_field_ref }
          : {}),
        ...(args.step_refs !== undefined ? { step_refs: args.step_refs } : {}),
        ...(deps.modelId !== undefined ? { model_id: deps.modelId } : {}),
      });

      // Decision L: empty facts. The AI reads view.hypotheses next iteration.
      return ok({ facts: [] });
    },
  };
}

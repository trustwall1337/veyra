/**
 * update-hypothesis tool (Phase 3 / Step 40e).
 *
 * Layer-2 prewrite guard runs the same scalar-string + recursive walks
 * as propose-hypothesis on `args.statement_addendum`. Decision M
 * (codex 40e-plan-03 [APPLIED]) requires grounded `step_refs` when
 * disposition transitions to `'partially_evidenced'` or
 * `'evidenced_against'` — AI cannot mark evidence-state without actual
 * evidence behind it.
 *
 * Returns `{facts: []}` (Decision L per codex 40e-plan-02 [APPLIED]).
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
  EmptyStepRefsForEvidenceDispositionError,
  type HypothesisId,
  UnknownStepRefError,
} from '../../types.js';
import {
  containsClaimVocabularyToken,
  containsClassificationStringToken,
} from '../../validate.js';

export const UPDATE_HYPOTHESIS_TOOL_ID = 'update-hypothesis';

export const updateHypothesisArgsSchema = z
  .strictObject({
    hypothesis_id: z.string().min(1).max(64),
    disposition: z
      .enum(['proposed', 'partially_evidenced', 'evidenced_against', 'superseded'])
      .optional(),
    step_refs: z.array(z.number().int().nonnegative()).optional(),
    statement_addendum: z.string().min(1).max(2000).optional(),
  });

export type UpdateHypothesisArgs = z.infer<typeof updateHypothesisArgsSchema>;

export interface CreateUpdateHypothesisToolDeps {
  readonly registry: HypothesisRegistry;
  readonly redactor: (raw: string) => string;
  readonly isAcceptedStepRef: (seq: number) => boolean;
}

const EVIDENCE_BEARING_DISPOSITIONS = new Set([
  'partially_evidenced',
  'evidenced_against',
]);

export function createUpdateHypothesisTool(
  deps: CreateUpdateHypothesisToolDeps,
): ToolDescriptor<UpdateHypothesisArgs, ToolResult> {
  const idR = asToolId(UPDATE_HYPOTHESIS_TOOL_ID);
  if (isErr(idR)) throw new Error(`invalid tool id: ${idR.error.message}`);

  return {
    tool_id: idR.value,
    title:
      'Update an existing AI hypothesis (mark partially_evidenced / evidenced_against / superseded; cite accepted-step refs as evidence; optional statement addendum).',
    args_schema: updateHypothesisArgsSchema,
    result_schema: toolResultSchema,
    required_action: 'author_hypothesis',
    source_module:
      'src/cli/hypothesis-registry/tools/update-hypothesis/tool.ts',
    invoke: async (args) => {
      // Layer-2 prewrite (Decision D + 40e-plan-04). Return specific
      // error subclasses directly so the trace row carries the precise
      // tool_error_class (codex 40e-diff-002 [APPLIED]).
      if (containsClassificationKey(args)) {
        return err(
          new ClassificationKeyInArgsError(
            'update-hypothesis args contained a classification key at some depth',
          ),
        );
      }
      // Walk the entire args object for scalar-string smuggling (catches
      // tokens in any string field, not just statement_addendum).
      if (containsClassificationStringToken(args)) {
        return err(
          new ClassificationKeyInArgsError(
            'update-hypothesis args contained a classification-key token in a scalar string',
          ),
        );
      }
      if (containsClaimVocabularyToken(args)) {
        return err(
          new ClaimVocabularyInArgsError(
            'update-hypothesis args contained a claim-vocabulary token',
          ),
        );
      }

      // Decision M: grounding for evidence-bearing dispositions.
      if (
        args.disposition !== undefined &&
        EVIDENCE_BEARING_DISPOSITIONS.has(args.disposition)
      ) {
        if (args.step_refs === undefined || args.step_refs.length === 0) {
          return err(
            new EmptyStepRefsForEvidenceDispositionError(
              `update-hypothesis disposition "${args.disposition}" requires non-empty step_refs`,
            ),
          );
        }
        for (const seq of args.step_refs) {
          if (!deps.isAcceptedStepRef(seq)) {
            return err(
              new UnknownStepRefError(
                `update-hypothesis step_ref ${String(seq)} is not an accepted loop step`,
              ),
            );
          }
        }
      }

      const redactedAddendum =
        args.statement_addendum !== undefined
          ? deps.redactor(args.statement_addendum)
          : undefined;

      const r = deps.registry.update(args.hypothesis_id as HypothesisId, {
        ...(args.disposition !== undefined
          ? { disposition: args.disposition }
          : {}),
        ...(args.step_refs !== undefined ? { step_refs: args.step_refs } : {}),
        ...(redactedAddendum !== undefined
          ? { statement_addendum: redactedAddendum }
          : {}),
      });
      // r.error is UnknownHypothesisError (extends ToolInvocationError) so
      // its name propagates directly into the trace row.
      if (!r.ok) return err(r.error);

      // Decision L: empty facts. The AI reads the updated hypothesis on
      // the next iteration via view.hypotheses.
      return ok({ facts: [] });
    },
  };
}

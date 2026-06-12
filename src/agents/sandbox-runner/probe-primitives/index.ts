/**
 * Probe-primitive runtime catalog (Step 39b Decision A — one folder, 13
 * sibling entry files). Re-exports the per-control primitives and builds
 * the runtime Map the `probe-http` tool consults at invoke time.
 *
 * Adding a 14th probe: one new `cc-11-N.ts` file + one import line +
 * one Map entry below + one expected-id entry in the V17 catalog-drift
 * test. The `index.ts` is the SOLE place that calls `new Map(...)` — no
 * `switch (probe_id)` in any consumer.
 */

import type { ProbePrimitive } from '../../../types/probe-primitive.js';

import { CC_11_1 } from './cc-11-1.js';
import { CC_11_2 } from './cc-11-2.js';
import { CC_11_3 } from './cc-11-3.js';
import { CC_11_4 } from './cc-11-4.js';
import { CC_11_6 } from './cc-11-6.js';
import { CC_11_9 } from './cc-11-9.js';
import { CC_11_12 } from './cc-11-12.js';
import { CC_11_13A } from './cc-11-13a.js';
import { CC_11_13B } from './cc-11-13b.js';
import { CC_11_13C } from './cc-11-13c.js';
import { CC_11_13D } from './cc-11-13d.js';
import { CC_11_13E } from './cc-11-13e.js';

const ENTRIES: readonly ProbePrimitive[] = [
  CC_11_1,
  CC_11_2,
  CC_11_3,
  CC_11_4,
  CC_11_6,
  CC_11_9,
  CC_11_12,
  CC_11_13A,
  CC_11_13B,
  CC_11_13C,
  CC_11_13D,
  CC_11_13E,
];

export const PROBE_PRIMITIVE_CATALOG: ReadonlyMap<string, ProbePrimitive> =
  new Map<string, ProbePrimitive>(ENTRIES.map((p) => [p.id, p]));

/** Convenience accessor — returns `undefined` for unknown probe ids. */
export function getProbePrimitive(id: string): ProbePrimitive | undefined {
  return PROBE_PRIMITIVE_CATALOG.get(id);
}

/** V17 catalog-drift helper: the canonical list of expected probe ids. */
export const EXPECTED_PROBE_IDS: readonly string[] = ENTRIES.map((p) => p.id);

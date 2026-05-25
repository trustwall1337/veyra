/**
 * JSON reporter — pure function from `ReadinessReport` to a stable
 * JSON string. Determinism: keys are emitted in source-declaration
 * order; arrays preserve their input order.
 */

import type { ReadinessReport } from '../../types/readiness-report.js';

export function renderJsonReport(report: ReadinessReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

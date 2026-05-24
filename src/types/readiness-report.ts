import type { ControlCard } from './control-card.js';
import type { Finding } from './finding.js';

export interface ReadinessSummary {
  readonly total_controls: number;
  readonly evidence_present: number;
  readonly needs_review: number;
  readonly launch_blocker: number;
}

export interface ReadinessReport {
  readonly scan_id: string;
  readonly project_name: string;
  readonly generated_at: string;
  readonly veyra_version: string;
  readonly control_cards: readonly ControlCard[];
  readonly launch_blockers: readonly Finding[];
  readonly readiness_summary: ReadinessSummary;
}

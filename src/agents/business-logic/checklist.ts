/**
 * Fixed deterministic checklist of business-logic concerns.
 *
 * Per PHASE_1_PLAN §4.5: each entry is parameterized by declared-context
 * shape and predicates over (observed_evidence | declared_intent). When
 * an entry applies and no covering evidence exists, the agent emits a
 * coverage_gap finding with at least one suggested_test.
 */

import type {
  DeclaredIntent,
  ObservedEvidence,
} from '../../types/declared-context.js';

export interface ChecklistContext {
  readonly observed_evidence?: Partial<ObservedEvidence>;
  readonly declared_intent?: DeclaredIntent;
}

export interface ChecklistItem {
  readonly id: string;
  readonly control_id: string;
  readonly title: string;
  readonly applies: (ctx: ChecklistContext) => boolean;
  readonly suggested_tests: readonly string[];
  readonly rationale: string;
}

function dataKindIncludes(ctx: ChecklistContext, needle: string): boolean {
  const kinds = ctx.declared_intent?.data_kinds?.value ?? [];
  return kinds.some((k) => k.toLowerCase().includes(needle));
}

function userRolesInclude(ctx: ChecklistContext, needle: string): boolean {
  const roles = ctx.declared_intent?.user_roles?.value ?? [];
  return roles.some((r) => r.toLowerCase().includes(needle));
}

function routesInclude(ctx: ChecklistContext, needle: string): boolean {
  const routes = ctx.observed_evidence?.routes ?? [];
  return routes.some((r) => r.toLowerCase().includes(needle));
}

function depsInclude(ctx: ChecklistContext, dep: string): boolean {
  const deps = ctx.observed_evidence?.package_json_digest?.dependencies ?? {};
  return dep in deps;
}

export const CHECKLIST: readonly ChecklistItem[] = [
  {
    id: 'bl-self-approval',
    control_id: 'cc-11-11',
    title:
      'Self-approval of money / role / ownership changes',
    applies: (ctx) =>
      dataKindIncludes(ctx, 'order') ||
      dataKindIncludes(ctx, 'payment') ||
      dataKindIncludes(ctx, 'invoice') ||
      dataKindIncludes(ctx, 'subscription') ||
      routesInclude(ctx, 'payment') ||
      routesInclude(ctx, 'order'),
    suggested_tests: [
      'POST /api/<money-resource> as the owning user — assert it requires a non-self approver for self-modification of price/total/role',
      'POST /api/<role-change> as a non-admin — assert it is rejected',
    ],
    rationale:
      'Money / role / ownership transitions need a non-self approver to prevent privilege escalation and self-dealing.',
  },
  {
    id: 'bl-cross-tenant-invite',
    control_id: 'cc-11-11',
    title: 'Cross-tenant invitations or attachments',
    applies: (ctx) =>
      userRolesInclude(ctx, 'tenant') ||
      userRolesInclude(ctx, 'workspace') ||
      dataKindIncludes(ctx, 'tenant'),
    suggested_tests: [
      'POST /api/invite as user_a (tenant_a) targeting tenant_b — assert 403',
      'POST /api/attachment with attachment_id from tenant_b as user_a (tenant_a) — assert 403',
    ],
    rationale:
      'Tenant boundaries must be enforced server-side on invite and attachment flows; a frontend selector is not sufficient.',
  },
  {
    id: 'bl-admin-server-side',
    control_id: 'cc-11-11',
    title: 'Server-side admin enforcement (not frontend-only)',
    applies: (ctx) =>
      userRolesInclude(ctx, 'admin') || routesInclude(ctx, 'admin'),
    suggested_tests: [
      'GET /api/admin/* as a non-admin user — assert 403, not just a UI redirect',
      'POST /api/admin/* (e.g. promote-user) as a non-admin — assert 403',
    ],
    rationale:
      'A client-side route guard does not prevent direct API calls; admin endpoints must check role on the server.',
  },
  {
    id: 'bl-file-access',
    control_id: 'cc-11-11',
    title: 'File / attachment access scoped to owner or tenant',
    applies: (ctx) =>
      dataKindIncludes(ctx, 'file') ||
      dataKindIncludes(ctx, 'attachment') ||
      dataKindIncludes(ctx, 'document') ||
      (ctx.observed_evidence?.supabase_schema?.tables ?? []).some(
        (t) => /documents|files|attachments/.test(t),
      ),
    suggested_tests: [
      'GET /api/files/:id as a user not owning the file — assert 403 or 404',
      'GET signed-URL routes — assert the URL is tenant-scoped, not globally guessable',
    ],
    rationale:
      'File and attachment endpoints frequently leak across tenant boundaries when access is scoped only by primary key.',
  },
  {
    id: 'bl-tenant-membership-transitions',
    control_id: 'cc-11-11',
    title: 'Tenant-membership transitions (leave, invite, demote)',
    applies: (ctx) =>
      userRolesInclude(ctx, 'tenant') ||
      userRolesInclude(ctx, 'workspace') ||
      dataKindIncludes(ctx, 'tenant'),
    suggested_tests: [
      'POST /api/tenants/:id/members as a non-admin member — assert 403',
      'DELETE /api/tenants/:id/members/:userId as the targeted user — assert allowed only for self or admin',
    ],
    rationale:
      'Tenant-membership transitions are sensitive operations; demote/remove flows are common authorization gaps.',
  },
  {
    id: 'bl-refund-reversal',
    control_id: 'cc-11-11',
    title: 'Refund / reversal / cancel flows authorization',
    applies: (ctx) =>
      dataKindIncludes(ctx, 'refund') ||
      dataKindIncludes(ctx, 'payment') ||
      dataKindIncludes(ctx, 'subscription') ||
      depsInclude(ctx, 'stripe') ||
      depsInclude(ctx, '@stripe/stripe-js'),
    suggested_tests: [
      'POST /api/refund as a non-admin / non-owner — assert 403',
      'POST /api/orders/:id/cancel as a user who is not the order owner — assert 403',
    ],
    rationale:
      'Refund and cancel flows are high-value targets; authorization must check both ownership and policy.',
  },
];

export interface ChecklistResult {
  readonly applicable: readonly ChecklistItem[];
  readonly evaluated: number;
}

export function evaluateChecklist(ctx: ChecklistContext): ChecklistResult {
  const applicable = CHECKLIST.filter((item) => item.applies(ctx));
  return { applicable, evaluated: CHECKLIST.length };
}

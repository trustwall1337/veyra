import { describe, expect, it } from 'vitest';

import { Budget, DEFAULT_BUDGET_CAPS } from './loop-budget.js';

function clock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

describe('Budget caps', () => {
  it('trips max_tool_calls (denials/rejects/errors all count via countToolCall)', () => {
    const b = new Budget({ ...DEFAULT_BUDGET_CAPS, max_tool_calls: 2 }, clock().now);
    expect(b.exceeded()).toBeUndefined();
    b.countToolCall();
    expect(b.exceeded()).toBeUndefined();
    b.countToolCall();
    expect(b.exceeded()).toBe('max_tool_calls');
  });

  it('trips max_steps backstop', () => {
    const b = new Budget({ ...DEFAULT_BUDGET_CAPS, max_steps: 1 }, clock().now);
    expect(b.exceeded()).toBeUndefined();
    b.countStep();
    expect(b.exceeded()).toBe('max_steps');
  });

  it('trips max_ai_cost_units', () => {
    const b = new Budget({ ...DEFAULT_BUDGET_CAPS, max_ai_cost_units: 100 }, clock().now);
    b.addCost(60);
    expect(b.exceeded()).toBeUndefined();
    b.addCost(40);
    expect(b.exceeded()).toBe('max_ai_cost_units');
  });

  it('trips max_wall_clock_ms by the injected clock', () => {
    const c = clock();
    const b = new Budget({ ...DEFAULT_BUDGET_CAPS, max_wall_clock_ms: 1000 }, c.now);
    expect(b.exceeded()).toBeUndefined();
    c.advance(1000);
    expect(b.exceeded()).toBe('max_wall_clock_ms');
  });
});

describe('ChildBudget — D6 budget no-escape', () => {
  it('clamps the requested slice to the root remaining (cannot raise a cap)', () => {
    const root = new Budget({ ...DEFAULT_BUDGET_CAPS, max_tool_calls: 5 }, clock().now);
    root.countToolCall();
    root.countToolCall();
    root.countToolCall(); // 3 used, 2 remaining
    const child = root.reserveChild({ max_tool_calls: 100 }); // clamped to 2
    child.countToolCall();
    expect(child.exceeded()).toBeUndefined();
    child.countToolCall(); // root now 5 → exhausted, NOT 100
    expect(child.exceeded()).toBe('max_tool_calls');
  });

  it('trips on its own slice before the root cap', () => {
    const root = new Budget({ ...DEFAULT_BUDGET_CAPS, max_tool_calls: 100 }, clock().now);
    const child = root.reserveChild({ max_tool_calls: 2 });
    child.countToolCall();
    child.countToolCall();
    expect(child.exceeded()).toBe('max_tool_calls'); // slice
    expect(root.exceeded()).toBeUndefined(); // root has plenty left
  });

  it('debits the root across all dimensions (no independent counter)', () => {
    const root = new Budget({ ...DEFAULT_BUDGET_CAPS }, clock().now);
    const child = root.reserveChild({});
    child.countToolCall();
    child.countStep();
    child.addCost(123);
    expect(root.toolCallsSpent).toBe(1);
    expect(root.stepsSpent).toBe(1);
    expect(root.costSpent).toBe(123);
  });

  it('a second child sees the root already spent — no reset/forget', () => {
    const root = new Budget({ ...DEFAULT_BUDGET_CAPS, max_tool_calls: 2 }, clock().now);
    const first = root.reserveChild({ max_tool_calls: 2 });
    first.countToolCall();
    first.countToolCall(); // root exhausted
    const second = root.reserveChild({ max_tool_calls: 2 });
    expect(second.exceeded()).toBe('max_tool_calls'); // root already at cap
  });

  it('root cap wins first even when the slice has headroom', () => {
    const root = new Budget({ ...DEFAULT_BUDGET_CAPS, max_tool_calls: 1 }, clock().now);
    const child = root.reserveChild({ max_tool_calls: 50 });
    child.countToolCall();
    expect(child.exceeded()).toBe('max_tool_calls');
  });
});

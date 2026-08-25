import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTIVE_DAY_BONUS,
  XP_PER_CONTRIBUTION,
  WEEK_STREAK_BONUS,
  emptyState,
  levelFromXp,
  processState,
  settleCompletedDay,
  shieldDamage,
  shieldRegen,
} from "../game-profile.mjs";

function day(date, count) {
  return { date, contributionCount: count };
}

test("level progression never decreases with increasing XP", () => {
  const low = levelFromXp(0);
  const mid = levelFromXp(1_000_000);
  const high = levelFromXp(3_000_000);
  assert.equal(low.level, 1);
  assert.ok(mid.level > low.level);
  assert.ok(high.level > mid.level);
});

test("active days grow combo and regenerate shields", () => {
  const state = emptyState();
  state.shield = 40;
  settleCompletedDay(state, "2026-08-20", 4);
  assert.equal(state.combo, 1);
  assert.equal(state.shield, Math.min(100, 40 + shieldRegen(4)));
});

test("a missed day consumes shield and preserves combo when protected", () => {
  const state = emptyState();
  state.combo = 8;
  state.shield = 100;
  const damage = shieldDamage(state.combo);
  settleCompletedDay(state, "2026-08-20", 0);
  assert.equal(state.combo, 8);
  assert.equal(state.shield, 100 - damage);
  assert.equal(state.protectedMisses, 1);
});

test("a missed day breaks combo when shield cannot absorb damage", () => {
  const state = emptyState();
  state.combo = 12;
  state.shield = 3;
  settleCompletedDay(state, "2026-08-20", 0);
  assert.equal(state.combo, 0);
  assert.equal(state.shield, 0);
  assert.equal(state.comboBreaks, 1);
});

test("seven active completed days award a streak milestone bonus", () => {
  const state = emptyState();
  state.combo = 6;
  const before = state.xp;
  settleCompletedDay(state, "2026-08-20", 1);
  assert.equal(state.combo, 7);
  assert.equal(state.xp - before, WEEK_STREAK_BONUS);
});

test("reprocessing identical contribution counts does not duplicate XP", () => {
  const now = new Date("2026-08-22T12:00:00Z");
  const days = [day("2026-08-20", 2), day("2026-08-21", 3), day("2026-08-22", 1)];
  const first = processState(null, days, now);
  const second = processState(first, days, now);
  assert.equal(second.xp, first.xp);
  assert.equal(second.combo, first.combo);
  assert.equal(second.shield, first.shield);
});

test("additional contributions on an already-seen day award only the delta", () => {
  const now = new Date("2026-08-22T12:00:00Z");
  const first = processState(null, [day("2026-08-22", 2)], now);
  const second = processState(first, [day("2026-08-22", 5)], now);
  assert.equal(second.xp - first.xp, 3 * XP_PER_CONTRIBUTION);
});

test("first contribution on a day awards active-day bonus once", () => {
  const now = new Date("2026-08-22T12:00:00Z");
  const first = processState(null, [day("2026-08-22", 0)], now);
  const second = processState(first, [day("2026-08-22", 1)], now);
  assert.equal(second.xp - first.xp, XP_PER_CONTRIBUTION + ACTIVE_DAY_BONUS);
  const third = processState(second, [day("2026-08-22", 2)], now);
  assert.equal(third.xp - second.xp, XP_PER_CONTRIBUTION);
});

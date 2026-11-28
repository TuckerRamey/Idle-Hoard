// The caches that keep a tick (and the panels) cheap must never change an answer,
// and working a long absence through in slices must add up to the same as one go.
import { describe, expect, it } from 'vitest';
import { advanceTo, assign, cached, emptyAdvance, flows, mergeResult, production } from '../src/game/economy';
import { toolAllocation } from '../src/game/forge';
import { researchEffects } from '../src/game/research';
import { newGame, type GameState } from '../src/game/state';

const T0 = 1_700_000_000_000;

function game(): GameState {
  const s = newGame(T0);
  s.explore.found.push('grove', 'rubble-cave');
  s.chief = { name: 'Snik', cunning: 0, voice: 0, nerve: 0, quirk: 'none' };
  s.newcomerJob = 'idle';
  s.seed = 42;
  s.idle = 30;
  assign(s, 'scavenger', 10);
  assign(s, 'woodcutter', 10);
  assign(s, 'miner', 10);
  return s;
}

describe('caches', () => {
  it('research bonuses follow finished research, including a save swapped in', () => {
    const s = game();
    const before = researchEffects(s).length;
    s.research.done.push('ore-sniffing', 'smithing');
    const after = researchEffects(s).length;
    expect(after).toBeGreaterThanOrEqual(before);
    const fresh = game();
    expect(researchEffects(fresh).length).toBe(before);
    // same length, different research: still noticed
    const other = game();
    other.research.done.push('smithing', 'ore-sniffing');
    other.research.done.pop();
    other.research.done.push('crab-wrangling');
    expect(researchEffects(other)).not.toBe(researchEffects(s));
  });

  it('the panels see the same numbers with and without the cache', () => {
    const s = game();
    advanceTo(s, T0 + 3_600_000);
    const plain = { p: production(s), f: flows(s), a: JSON.stringify(toolAllocation(s)) };
    const inCache = cached(() => ({ p: production(s), f: flows(s), a: JSON.stringify(toolAllocation(s)) }));
    expect(inCache).toEqual(plain);
  });

  it("a caller changing production's answer doesn't change the cached one", () => {
    const s = game();
    cached(() => {
      const a = production(s);
      a.copper += 1000;
      expect(production(s).copper).toBe(a.copper - 1000);
    });
  });
});

describe('catching up in slices', () => {
  it('adds up to the same as crediting a long absence in one go', () => {
    const a = game();
    const b = game();
    const whole = advanceTo(a, T0 + 6 * 3_600_000);
    const total = emptyAdvance(6 * 3600, 6 * 3600);
    while (b.lastTick < T0 + 6 * 3_600_000) mergeResult(total, advanceTo(b, Math.min(T0 + 6 * 3_600_000, b.lastTick + 1_800_000)));
    expect(b.res).toEqual(a.res);
    expect(total.arrived).toBe(whole.arrived);
    expect(total.gained).toEqual(whole.gained);
    expect(total.events.length).toBe(whole.events.length);
  });
});

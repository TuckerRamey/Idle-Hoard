// The forge: smelting, order slots, tool tiers, wear, and who gets the best tools.
import { describe, expect, it } from 'vitest';
import type { Chief } from '../src/game/chief';
import { flows, jobDef, jobOutput, tick } from '../src/game/economy';
import {
  autoJob,
  bestTier,
  FORGE,
  forgeRate,
  forgeSlotCount,
  orderOptions,
  setOrder,
  syncSlots,
  toolMults,
  toolSummary,
  toolsInUse,
  TIERS,
  TOOL_NAMES,
} from '../src/game/forge';
import { nameKobold } from '../src/game/kobolds';
import { newGame, rng, type GameState } from '../src/game/state';
import { JOBS } from '../src/game/data';

const T0 = 1_700_000_000_000;
const chief: Chief = { name: 'Snik', cunning: 0, voice: 0, nerve: 0, quirk: 'none' };

function game(...learned: string[]): GameState {
  const s = newGame(T0);
  s.chief = { ...chief };
  s.newcomerJob = 'idle';
  s.seed = 12345;
  s.research.done.push('ore-sniffing', 'smithing', ...learned);
  return s;
}

describe('the forge', () => {
  it('is closed until smithing', () => {
    const s = newGame(T0);
    expect(orderOptions(s)).toEqual([]);
    expect(bestTier(s)).toBeUndefined();
  });

  it('every job has its own tool', () => {
    for (const j of JOBS) expect(TOOL_NAMES[j.id], j.id).toBeTruthy();
    expect(new Set(Object.values(TOOL_NAMES)).size).toBe(Object.keys(TOOL_NAMES).length);
  });

  it('smelts ore and wood into bars', () => {
    const s = game();
    s.crews.blacksmith = { n: 2 };
    syncSlots(s);
    expect(setOrder(s, 0, 'smelt')).toBe(true);
    s.res.ore = 20;
    s.res.wood = 10;
    tick(s, 50); // 2 smiths × 50 s = 100 work = 10 bars at most
    expect(s.res.bars).toBeGreaterThan(5);
    expect(s.res.ore).toBeCloseTo(20 - 2 * s.res.bars);
    expect(s.res.wood).toBeCloseTo(10 - s.res.bars);
  });

  it('splits its work between anvils', () => {
    const s = game('second-anvil');
    s.crews.blacksmith = { n: 2 };
    syncSlots(s);
    expect(forgeSlotCount(s)).toBe(2);
    setOrder(s, 0, 'smelt');
    setOrder(s, 1, 'tool:miner');
    s.res.ore = 100;
    s.res.wood = 100;
    s.res.stone = 100;
    tick(s, 40); // 80 work: 40 each = 4 bars and 2 stone picks
    expect(s.res.bars).toBe(4);
    expect(s.tools.miner.stone!.n).toBe(2);
  });

  it('only makes the best tier it knows', () => {
    const s = game();
    expect(bestTier(s)!.id).toBe('stone');
    s.research.done.push('ironworking');
    expect(bestTier(s)!.id).toBe('iron');
    expect(orderOptions(s).find((o) => o.id === 'tool:miner')!.name).toMatch(/^Iron picks/);
  });

  it('hands the best tools to named kobolds first, then the crew, and the rest work bare', () => {
    const s = game();
    s.crews.miner = { n: 4 };
    const k = nameKobold(s, 'miner', 'the Test', 'Was tested.', T0, rng(s))!;
    expect(k).toBeTruthy();
    s.tools.miner = { steel: { n: 1, wear: 0 }, iron: { n: 2, wear: 0 } };
    expect(toolsInUse(s, 'miner')).toEqual([
      { tier: 'steel', n: 1 },
      { tier: 'iron', n: 2 },
    ]);
    const m = toolMults(s, 'miner');
    expect(m.named).toEqual([TIERS[2].mult]);
    expect(m.crew).toBeCloseTo((2 * TIERS[1].mult + 1) / 3);
    expect(toolSummary(s, 'miner')).toBe('Picks: 1 steel, 2 iron, 1 bare');
    const bare = jobOutput({ ...s, tools: {} }, jobDef('miner')!);
    expect(jobOutput(s, jobDef('miner')!)).toBeGreaterThan(bare);
  });

  it('tools stay with their job when kobolds move', () => {
    const s = game();
    s.crews.woodcutter = { n: 3 };
    s.tools.woodcutter = { stone: { n: 3, wear: 0 } };
    s.crews.woodcutter.n = 0;
    s.idle = 3;
    expect(s.tools.woodcutter.stone!.n).toBe(3);
    expect(toolsInUse(s, 'woodcutter')).toEqual([]);
  });

  it('tools wear out with use, about once a week each, and unused ones do not', () => {
    const s = game();
    s.chief = null; // no talents or names pulling miners out of the crew mid-test
    s.crews.miner = { n: 2 };
    s.tools.miner = { stone: { n: 4, wear: 0 } };
    tick(s, FORGE.toolLifeSeconds / 2 + 10);
    expect(s.tools.miner.stone!.n).toBe(3);
    tick(s, FORGE.toolLifeSeconds / 2);
    expect(s.tools.miner.stone!.n).toBe(2);
  });

  it('the automatic order makes tools for whoever is shortest of the best kind', () => {
    const s = game();
    s.crews.scavenger = { n: 5 };
    s.crews.miner = { n: 2 };
    expect(autoJob(s)).toBe('scavenger');
    s.tools.scavenger = { stone: { n: 5, wear: 0 } };
    expect(autoJob(s)).toBe('miner');
    s.tools.miner = { stone: { n: 2, wear: 0 } };
    expect(autoJob(s)).toBeNull();
  });

  it('blacksmiths beyond what the forge fits do nothing', () => {
    const s = game();
    s.crews.blacksmith = { n: 3 };
    const three = forgeRate(s);
    s.crews.blacksmith = { n: 30 };
    expect(forgeRate(s)).toBeCloseTo(three);
  });
});

describe('the stores show forge use steadily', () => {
  it("tool orders' use is smoothed, so it doesn't blink as kobolds arrive and tools are made", () => {
    const s = newGame(0);
    s.chief = { name: 'A', cunning: 1, voice: 1, nerve: 1, quirk: 'none' };
    s.research.done.push('ore-sniffing', 'smithing', 'second-anvil');
    s.crews = { scavenger: { n: 6 }, miner: { n: 8 }, woodcutter: { n: 4 }, blacksmith: { n: 3 } };
    s.res.stone = 500;
    s.res.wood = 500;
    s.res.ore = 300;
    syncSlots(s);
    setOrder(s, 0, 'smelt');
    setOrder(s, 1, 'auto');
    let prev: { stone: number; ore: number } | null = null;
    for (let i = 0; i < 200; i++) {
      tick(s, 30);
      if (i % 20 === 0) s.crews.scavenger.n += 1; // a newcomer who needs a tool
      const f = flows(s);
      const now = { stone: f.stone.out, ore: f.ore.out };
      if (prev && i > 5) {
        expect(Math.abs(now.stone - prev.stone)).toBeLessThan(0.01);
        expect(Math.abs(now.ore - prev.ore) / prev.ore).toBeLessThan(0.05);
      }
      prev = now;
    }
  });
});

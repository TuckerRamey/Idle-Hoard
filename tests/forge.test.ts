// The forge: smelting, order slots, tool tiers, wear, and who gets the best tools.
import { describe, expect, it } from 'vitest';
import type { Chief } from '../src/game/chief';
import { flows, jobDef, jobOutput, tick } from '../src/game/economy';
import {
  bestTier,
  FORGE,
  forgeRate,
  forgeSlotCount,
  orderOptions,
  setOrder,
  setToolFirst,
  spareTools,
  syncSlots,
  toolAllocation,
  toolLine,
  toolMults,
  toolTag,
  toolsInUse,
  TIERS,
  unitFor,
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

  it('every job has a name for its tools, for the chronicle', () => {
    for (const j of JOBS) expect(TOOL_NAMES[j.id], j.id).toBeTruthy();
  });

  it('has a short anvil list: tools, bars and steel', () => {
    const s = game('ironworking', 'steelmaking');
    expect(orderOptions(s).map((o) => o.name)).toEqual(['Tools', 'Smelt iron bars', 'Make steel']);
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
    setOrder(s, 1, 'auto');
    s.res.ore = 100;
    s.res.wood = 100;
    s.res.stone = 100;
    tick(s, 40); // 80 work: 40 each = 4 bars and 2 stone tools
    expect(s.res.bars).toBe(4);
    expect(s.rack.stone!.n).toBe(2);
  });

  it('only makes the best tier it knows', () => {
    const s = game();
    expect(bestTier(s)!.id).toBe('stone');
    s.research.done.push('ironworking');
    expect(bestTier(s)!.id).toBe('iron');
    expect(unitFor(s, 'auto')!.label).toBe('iron tools');
  });

  it('hands the best tools to named kobolds first, then the crew, and the rest work bare', () => {
    const s = game();
    s.crews.miner = { n: 4 };
    const k = nameKobold(s, 'miner', 'the Test', 'Was tested.', T0, rng(s))!;
    expect(k).toBeTruthy();
    s.rack = { steel: { n: 1, wear: 0 }, iron: { n: 2, wear: 0 } };
    expect(toolsInUse(s, 'miner')).toEqual([
      { tier: 'steel', n: 1 },
      { tier: 'iron', n: 2 },
    ]);
    const m = toolMults(s, 'miner');
    expect(m.named).toEqual([TIERS[2].mult]);
    expect(m.crew).toBeCloseTo((2 * TIERS[1].mult + 1) / 3);
    expect(toolTag(s, 'miner')).toBe('steel tools, 1 without');
    expect(toolLine(s, 'miner')).toBe('Steel for 1 of 4; 2 on iron, 1 without.');
    const bare = jobOutput({ ...s, rack: {} }, jobDef('miner')!);
    expect(jobOutput(s, jobDef('miner')!)).toBeGreaterThan(bare);
  });

  it('one rack serves every job, and tools follow the kobolds who need them', () => {
    const s = game();
    s.crews.woodcutter = { n: 3 };
    s.rack = { stone: { n: 3, wear: 0 } };
    expect(toolsInUse(s, 'woodcutter')).toEqual([{ tier: 'stone', n: 3 }]);
    s.crews.woodcutter.n = 0;
    s.crews.miner = { n: 3 };
    expect(toolsInUse(s, 'woodcutter')).toEqual([]);
    expect(toolsInUse(s, 'miner')).toEqual([{ tier: 'stone', n: 3 }]);
  });

  it('shares scarce tools evenly, best first, and whole tools add up to the rack', () => {
    const s = game();
    s.crews.scavenger = { n: 6 };
    s.crews.miner = { n: 3 };
    s.crews.woodcutter = { n: 1 };
    s.rack = { iron: { n: 5, wear: 0 }, stone: { n: 20, wear: 0 } };
    const a = toolAllocation(s);
    const iron = (a.scavenger?.iron ?? 0) + (a.miner?.iron ?? 0) + (a.woodcutter?.iron ?? 0);
    expect(iron).toBe(5);
    expect(a.scavenger!.iron).toBe(3);
    // everyone is covered, with stone filling in, and the rest is spare
    for (const job of ['scavenger', 'miner', 'woodcutter']) expect(Object.values(a[job]!).reduce((x, y) => x + (y ?? 0), 0)).toBe(s.crews[job].n);
    expect(spareTools(s)).toEqual({ stone: 15 });
  });

  it('a starred job is first in line for the best tools', () => {
    const s = game();
    s.crews.scavenger = { n: 6 };
    s.crews.miner = { n: 3 };
    s.rack = { iron: { n: 4, wear: 0 } };
    expect(setToolFirst(s, 'miner')).toBe(true);
    expect(toolsInUse(s, 'miner')).toEqual([{ tier: 'iron', n: 3 }]);
    expect(toolsInUse(s, 'scavenger')).toEqual([{ tier: 'iron', n: 1 }]);
    expect(setToolFirst(s, 'nobody')).toBe(false);
    expect(setToolFirst(s, null)).toBe(true);
    expect(s.toolFirst).toBeNull();
  });

  it('tools wear out with use, about once a week each, and unused ones do not', () => {
    const s = game();
    s.chief = null; // no talents or names pulling miners out of the crew mid-test
    s.crews.miner = { n: 2 };
    s.rack = { stone: { n: 4, wear: 0 } };
    tick(s, FORGE.toolLifeSeconds / 2 + 10);
    expect(s.rack.stone!.n).toBe(3);
    tick(s, FORGE.toolLifeSeconds / 2);
    expect(s.rack.stone!.n).toBe(2);
    expect(toolsInUse(s, 'miner')).toEqual([{ tier: 'stone', n: 2 }]);
  });

  it('a Tools order keeps going after everyone is equipped, piling up spares', () => {
    const s = game();
    s.crews.blacksmith = { n: 2 };
    s.crews.miner = { n: 1 };
    syncSlots(s);
    setOrder(s, 0, 'auto');
    s.res.stone = 100;
    s.res.wood = 100;
    tick(s, 200); // 400 work = 20 stone tools
    expect(s.rack.stone!.n).toBeGreaterThanOrEqual(19);
    expect(spareTools(s).stone).toBe(s.rack.stone!.n - 3); // the miner and both smiths have one
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

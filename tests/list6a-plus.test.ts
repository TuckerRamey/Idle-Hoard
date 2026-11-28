// List 6, part A+: quarriers and miners are one Miner job. Miners cut stone,
// and a steady share comes out as iron ore, raised by research.
import { describe, expect, it } from 'vitest';
import type { Chief } from '../src/game/chief';
import { JOBS } from '../src/game/data';
import { capacity, FULL_YARD_ORE, jobDef, jobHints, jobOutput, minerSplit, oreShare, production } from '../src/game/economy';
import { findStep, WORK_FINDS } from '../src/game/finds';
import { canResearch, researchDef } from '../src/game/research';
import { normalize } from '../src/game/save';
import { newGame, rng, type GameState } from '../src/game/state';

const T0 = 1_700_000_000_000;
const chief: Chief = { name: 'Snik', cunning: 0, voice: 0, nerve: 0, quirk: 'none' };

function game(): GameState {
  const s = newGame(T0);
  s.chief = { ...chief };
  s.newcomerJob = 'idle';
  s.seed = 99;
  return s;
}

describe('one Miner job', () => {
  it('there is no quarrier, and miners are open from the start', () => {
    expect(JOBS.some((j) => j.id === 'quarrier')).toBe(false);
    expect(jobDef('miner')!.requires).toBeUndefined();
  });

  it('miners cut only stone until ore sniffing, then a steady share of ore that research raises', () => {
    const s = game();
    s.crews.miner = { n: 10 };
    const out = jobOutput(s, jobDef('miner')!);
    expect(production(s).stone).toBeCloseTo(out);
    expect(production(s).ore).toBe(0);
    for (const [id, share] of [['ore-sniffing', 0.2], ['seam-reading', 0.35], ['deep-seams', 0.5]] as const) {
      s.research.done.push(id);
      expect(oreShare(s)).toBe(share);
      expect(production(s).ore).toBeCloseTo(out * share);
      expect(production(s).stone).toBeCloseTo(out * (1 - share));
    }
  });

  it('a full stone yard sends the stone part to ore, at half pace, and says so', () => {
    const s = game();
    s.research.done.push('ore-sniffing');
    s.crews.miner = { n: 10 };
    s.res.stone = capacity(s, 'stone');
    const split = minerSplit(s);
    expect(split.yardFull).toBe(true);
    expect(split.stone).toBe(0);
    expect(split.ore).toBeCloseTo(0.2 + 0.8 * FULL_YARD_ORE);
    expect(jobHints(s).miner).toMatch(/stone yard is full/);
  });

  it('the new research sits in order', () => {
    const s = game();
    expect(canResearch(s, researchDef('seam-reading')!)).toBe(false);
    s.research.done.push('ore-sniffing', 'smithing');
    expect(canResearch(s, researchDef('seam-reading')!)).toBe(true);
    s.research.done.push('seam-reading');
    expect(canResearch(s, researchDef('deep-seams')!)).toBe(false);
    s.research.done.push('deep-delving');
    expect(canResearch(s, researchDef('deep-seams')!)).toBe(true);
    s.stage = 1;
    expect(canResearch(s, researchDef('gem-lore')!)).toBe(true);
  });

  it('gem lore makes rare finds likelier, and mithril waits for deep seams', () => {
    const run = (done: string[]) => {
      const s = game();
      s.research.done.push('ore-sniffing', 'smithing', ...done);
      s.crews.miner = { n: 40 };
      s.rooms.den.volume = WORK_FINDS.deepPaces;
      s.stage = 2;
      const rand = rng(s);
      let lines = 0;
      for (let i = 0; i < 2000; i++) lines += findStep(s, 600, T0, rand).length;
      return { lines, s };
    };
    const plain = run([]);
    const lore = run(['gem-lore']);
    expect(lore.lines).toBeGreaterThan(plain.lines * 1.2);
    expect(plain.s.discovered).not.toContain('mithril');
    expect(run(['deep-seams']).s.discovered).toContain('mithril');
  });
});

describe('old saves', () => {
  it('quarriers become miners: crews, named kobolds, talents, tools and orders', () => {
    const s = game();
    const raw = JSON.parse(JSON.stringify(s));
    raw.crews = { quarrier: { n: 6 }, miner: { n: 2 } };
    raw.newcomerJob = 'quarrier';
    raw.named = [{ id: 1, name: 'Grek', title: '', job: 'quarrier', loves: 'quarrier', hates: 'miner', look: 0, traits: [], gifts: [], history: [], lieutenant: false, talents: [{ job: 'quarrier', name: 'Rockjaw', mult: 1.25 }] }];
    raw.tools = { quarrier: { stone: { n: 4, wear: 0.5 } }, miner: { stone: { n: 4, wear: 0 }, iron: { n: 2, wear: 0 } } };
    raw.forge = { slots: [{ order: 'tool:quarrier', progress: 3 }], toolUse: {} };
    const back = normalize(raw, T0);
    expect(back.crews.quarrier).toBeUndefined();
    expect(back.crews.miner.n).toBe(8);
    expect(back.newcomerJob).toBe('miner');
    expect(back.named[0].job).toBe('miner');
    expect(back.named[0].loves).toBe('miner');
    expect(back.named[0].hates).toBe('digger');
    expect(back.named[0].talents![0].job).toBe('miner');
    expect(back.rack.stone).toEqual({ n: 8, wear: 0.25 });
    expect(back.rack.iron!.n).toBe(2);
    expect(back.forge.slots[0].order).toBe('auto');
    expect(back.toolFirst).toBe('miner');
  });
});

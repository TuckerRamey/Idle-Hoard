// List 8: personal gear for named kobolds (found, then upgraded at the forge)
// and founder traits that shape the colonies they start.
import { describe, expect, it } from 'vitest';
import type { Chief } from '../src/game/chief';
import { foundColony, colonyStep, COLONY, tributeRate } from '../src/game/colonies';
import { jobDef, jobOutput, tick } from '../src/game/economy';
import { setOrder, syncSlots, TIERS, toolAllocation, toolMults } from '../src/game/forge';
import { founder, founderLine, founderPreview, FOUNDER } from '../src/game/founders';
import {
  armorProtect,
  commission,
  commissionBlocked,
  GEAR,
  gearStep,
  givePiece,
  hangUpGear,
  luckyHat,
  nextUpgrade,
  pieceText,
  toolMult,
  trinketLuck,
} from '../src/game/gear';
import { addHistory, nameKobold, type NamedKobold } from '../src/game/kobolds';
import { lossStep } from '../src/game/losses';
import { normalize } from '../src/game/save';
import { newGame, rng, type GameState } from '../src/game/state';

const T0 = 1_700_000_000_000;
const chief: Chief = { name: 'Snik', cunning: 0, voice: 0, nerve: 0, quirk: 'none' };

function game(): GameState {
  const s = newGame(T0);
  s.explore.found.push('grove', 'rubble-cave');
  s.explore.target = null;
  s.chief = { ...chief };
  s.newcomerJob = 'idle';
  s.seed = 808;
  s.research.done.push('ore-sniffing', 'smithing');
  return s;
}

function named(s: GameState, job = 'miner'): NamedKobold {
  s.idle += 1;
  const k = nameKobold(s, 'idle', 'the Test', 'Was tested.', T0, rng(s))!;
  k.job = job;
  return k;
}

describe('personal gear', () => {
  it('starts empty and turns up as experiences: the first in a day or two, all three in about a week', () => {
    const found: number[] = [];
    const all: number[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      const s = game();
      s.seed = seed;
      const k = named(s);
      expect(k.gear).toBeUndefined();
      const rand = rng(s);
      let first = 0;
      let days = 0;
      for (let h = 1; h <= 24 * 30; h++) {
        gearStep(s, 3600, T0, rand);
        const n = Object.keys(k.gear ?? {}).length;
        if (n >= 1 && !first) first = h / 24;
        if (n === 3) {
          days = h / 24;
          break;
        }
      }
      found.push(first);
      all.push(days || 30);
    }
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(found)).toBeGreaterThan(0.3);
    expect(avg(found)).toBeLessThan(2.5);
    expect(avg(all)).toBeGreaterThan(3);
    expect(avg(all)).toBeLessThan(10);
  });

  it('a personal tool beats the rack, and its owner leaves the rack tool for the crew', () => {
    const s = game();
    s.crews.miner = { n: 3 };
    const k = named(s);
    s.rack = { stone: { n: 4, wear: 0 } };
    expect(toolAllocation(s).miner!.stone).toBe(4);
    givePiece(k, 'tool', { tier: 'steel', marks: 3, origin: 'test' }, 'Got a pick.', T0);
    expect(toolMult(k)).toBeCloseTo(TIERS[2].mult * 1.15);
    expect(toolMults(s, 'miner').named).toEqual([toolMult(k)]);
    expect(toolAllocation(s).miner!.stone).toBe(3);
    expect(pieceText(k, 'tool', k.gear!.tool!)).toBe('steel pick ✦✦✦');
    // it follows them to another job
    k.job = 'scout';
    expect(pieceText(k, 'tool', k.gear!.tool!)).toBe('steel lantern ✦✦✦');
  });

  it('is upgraded at the forge from the commissions queue: marks, then the next tier, and a masterwork gets a name', () => {
    const s = game();
    s.research.done.push('ironworking', 'steelmaking');
    const k = named(s);
    expect(commissionBlocked(s, k, 'armor')).toMatch(/turn up first/);
    givePiece(k, 'armor', { tier: 'iron', marks: 2, origin: 'test' }, 'Found a coat.', T0);
    expect(commission(s, k, 'armor')).toBe(true);
    expect(commission(s, k, 'armor')).toBe(false); // already waiting
    s.crews.blacksmith = { n: 3 };
    syncSlots(s);
    setOrder(s, 0, 'commissions');
    s.res.bars = 1000;
    s.res.steel = 1000;
    s.res.wood = 1000;
    tick(s, 600);
    expect(k.gear!.armor!.marks).toBe(3);
    commission(s, k, 'armor');
    expect(nextUpgrade(s, k.gear!.armor!)!.tier).toBe('steel');
    tick(s, 3600);
    expect(k.gear!.armor!.tier).toBe('steel');
    expect(k.gear!.armor!.marks).toBe(0);
    s.res.steel = 1e5;
    for (let i = 0; i < 3; i++) {
      expect(commission(s, k, 'armor')).toBe(true);
      tick(s, 3600);
    }
    expect(k.gear!.armor!.marks).toBe(3);
    expect(k.gear!.armor!.name).toBeTruthy();
    expect(k.history.some((h) => h.text.includes(k.gear!.armor!.name!))).toBe(true);
    expect(commissionBlocked(s, k, 'armor')).toMatch(/as good as/i);
  });

  it('with nothing commissioned, a Commissions anvil makes tools', () => {
    const s = game();
    s.crews.blacksmith = { n: 2 };
    syncSlots(s);
    setOrder(s, 0, 'commissions');
    s.res.stone = 100;
    s.res.wood = 100;
    tick(s, 200);
    expect(s.rack.stone?.n ?? 0).toBeGreaterThan(5);
  });

  it('armor turns blows aside, and a lucky hat saves a kobold with no trinket', () => {
    const s = game();
    const k = named(s, 'scout');
    expect(armorProtect(k)).toBe(0);
    let hat = 0;
    for (let i = 0; i < 50 && !hat; i++) if (luckyHat(k, T0, rng(s))) hat++;
    expect(hat).toBe(1);
    expect(k.gear!.trinket!.name).toBe('The Dented Hat');
    expect(trinketLuck(k)).toBeGreaterThan(1);
    givePiece(k, 'armor', { tier: 'adamant', marks: 3, origin: 'test' }, 'Armored.', T0);
    expect(armorProtect(k)).toBeCloseTo(0.75);
    // a big scout team, with the named scout now very well armored: hurts are rare
    s.crews.scout = { n: 0 };
    const rand = rng(s);
    let hurt = 0;
    for (let i = 0; i < 200; i++) {
      lossStep(s, 3600, T0, rand);
      if ((k.restLeft ?? 0) > 0) {
        hurt++;
        k.restLeft = 0;
      }
    }
    expect(hurt).toBeLessThan(10);
  });

  it('keeps through a save, with the commission queue', () => {
    const s = game();
    const k = named(s);
    givePiece(k, 'trinket', { tier: 'stone', marks: 1, look: 'hat', name: 'The Dented Hat', origin: 'took a blow' }, 'Hat.', T0);
    commission(s, k, 'trinket');
    const back = normalize(JSON.parse(JSON.stringify(s)), T0);
    expect(back.named[0].gear!.trinket).toEqual(k.gear!.trinket);
    expect(back.forge.commissions).toEqual([{ kobold: k.id, slot: 'trinket' }]);
  });

  it('named pieces go on the heirloom shelf when their owner puts them down', () => {
    const s = game();
    const k = named(s);
    givePiece(k, 'tool', { tier: 'steel', marks: 3, name: 'Old Biter', origin: 'test' }, 'Pick.', T0);
    givePiece(k, 'armor', { tier: 'stone', marks: 0, origin: 'test' }, 'Coat.', T0);
    hangUpGear(s, k, T0);
    expect(s.oddities.heirlooms.count).toBe(1);
    expect(k.gear!.tool).toBeUndefined();
    expect(k.gear!.armor).toBeTruthy();
  });

  it('a miner working without one makes about as much with their own steel tool as the rack would give', () => {
    const s = game();
    const k = named(s);
    const bare = jobOutput(s, jobDef('miner')!);
    givePiece(k, 'tool', { tier: 'iron', marks: 0, origin: 'test' }, 'Pick.', T0);
    expect(jobOutput(s, jobDef('miner')!)).toBeCloseTo(bare * GEAR.markBonus * 0 + bare * TIERS[1].mult);
  });
});

describe('founder traits', () => {
  it('are fixed for each kobold, mostly ordinary, and shown once they have a couple of experiences', () => {
    const s = game();
    const ks = Array.from({ length: 40 }, () => named(s));
    const fs = ks.map(founder);
    expect(founder(ks[0])).toEqual(fs[0]);
    for (const f of fs) for (const t of ['pull', 'green', 'trade'] as const) expect(Math.abs(f[t])).toBeLessThanOrEqual(2);
    expect(fs.filter((f) => f.pull === 0).length).toBeGreaterThan(5);
    expect(founderLine(ks[0])).toMatch(/\?/);
    addHistory(ks[0], T0, 'Did a thing.');
    expect(founderLine(ks[0])).toMatch(/Pull: /);
  });

  it('their story nudges them up: lieutenants pull more followers', () => {
    const s = game();
    const k = named(s);
    const before = founder(k).pull;
    k.lieutenant = true;
    expect(founder(k).pull).toBe(Math.min(2, before + 1));
  });

  it('shape the colony: settlers, growth and tribute', () => {
    const s = game();
    s.stage = 1;
    s.idle = 30;
    const ks = Array.from({ length: 30 }, () => named(s));
    for (const k of ks) for (let i = 0; i < 4; i++) addHistory(k, T0, `Story ${i}`);
    const plain = ks.filter((k) => !founder(k).knack);
    const score = (k: NamedKobold) => founder(k).pull * 10 + founder(k).trade;
    plain.sort((x, y) => score(y) - score(x));
    const strong = plain[0];
    const weak = plain.filter((k) => founder(k).trade < founder(strong).trade).pop()!;
    expect(founder(strong).pull).toBeGreaterThan(founder(weak).pull);
    expect(founderPreview(strong!, COLONY.settlers)).toMatch(new RegExp(`^${COLONY.settlers + founder(strong!).pull} settlers`));
    foundColony(s, strong!.id, T0, rng(s));
    foundColony(s, weak!.id, T0, rng(s));
    const [a, b] = s.colonies;
    expect(a.pop).toBe(COLONY.settlers + founder(strong!).pull * FOUNDER.settlersPerPull + 1);
    expect(b.pop).toBeLessThan(a.pop);
    // same size, the better trader sends more
    b.pop = a.pop;
    expect(tributeRate(s, a).copper).toBeGreaterThan(tributeRate(s, b).copper);
    colonyStep(s, 86_400, T0, rng(s));
    expect(a.founder).toEqual(founder(strong!));
  });
});

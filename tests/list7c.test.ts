// List 7, part C: fewer kobolds. Dangerous work loses the odd crowd kobold,
// named kobolds are only hurt, and idle kobolds with nothing to do wander off.
import { describe, expect, it } from 'vitest';
import type { Chief } from '../src/game/chief';
import { tick, workers } from '../src/game/economy';
import { dangerMult, exposed, LOSSES, lossesPerHour, lossStep } from '../src/game/losses';
import { nameKobold } from '../src/game/kobolds';
import { addArea, fills } from '../src/game/areas';
import { normalize } from '../src/game/save';
import { newGame, rng, type GameState } from '../src/game/state';

const T0 = 1_700_000_000_000;
const chief: Chief = { name: 'Snik', cunning: 0, voice: 0, nerve: 0, quirk: 'none' };

function game(): GameState {
  const s = newGame(T0);
  s.chief = { ...chief };
  s.newcomerJob = 'idle';
  s.seed = 31337;
  s.explore.target = null;
  return s;
}

/** A game with every hunting ground found, so a crew of hundreds is all out on the hunt. */
function huntingGame(): GameState {
  const s = game();
  s.stage = 5;
  s.research.done.push('monster-tracking');
  s.rooms.den.volume = 2000; // a deep room, for the deep grounds
  for (const id of ['bear-caves', 'ember-pits', 'glow-pools', 'deep-warrens', 'basilisk-maze', 'wyvern-cliffs', 'elder-deeps']) addArea(s, id);
  return s;
}

function run(s: GameState, hours: number) {
  const rand = rng(s);
  const died: Record<string, number> = {};
  const lines: string[] = [];
  for (let i = 0; i < hours * 6; i++) {
    const r = lossStep(s, 600, T0, rand);
    lines.push(...r.lines);
    for (const [j, n] of Object.entries(r.died)) died[j] = (died[j] ?? 0) + n;
  }
  return { died, lines };
}

describe('dangerous work', () => {
  it('loses about one hunter for every 40 hours out on the hunt', () => {
    const s = huntingGame();
    s.crews.hunter = { n: 100 };
    expect(exposed(s, 'hunter')).toBeCloseTo(100);
    expect(lossesPerHour(s, 'hunter')).toBeCloseTo(2.5);
    const { died, lines } = run(s, 10);
    // fewer hunters as they're lost: about 100 × (1 − e^−0.25) ≈ 22
    expect(died.hunter).toBeGreaterThan(12);
    expect(died.hunter).toBeLessThan(32);
    expect(s.crews.hunter.n).toBe(100 - died.hunter);
    expect(s.oddities['memorial-wall'].count).toBe(died.hunter);
    expect(s.losses.died).toBe(died.hunter);
    expect(lines[0]).toMatch(/hunt|kill|ledge/i);
  });

  it('hunters are lost far less often, and miners only in the deep workings', () => {
    const s = game();
    s.stage = 3;
    s.research.done.push('monster-tracking');
    addArea(s, 'bear-caves');
    s.crews.hunter = { n: 10 };
    // one in 40 working hours for each hunter actually out on the grounds
    expect(exposed(s, 'hunter')).toBeGreaterThan(0);
    expect(lossesPerHour(s, 'hunter')).toBeCloseTo((exposed(s, 'hunter') / 40) * dangerMult(s, 'hunter'));
    addArea(s, 'rubble-cave');
    s.crews.miner = { n: 10 };
    expect(lossesPerHour(s, 'miner')).toBe(0);
    addArea(s, 'deep-vein');
    expect(lossesPerHour(s, 'miner')).toBeGreaterThan(0);
  });

  it('only the kobolds out working are at risk: hunters with no room on the grounds are safe', () => {
    const s = game();
    s.stage = 3;
    s.research.done.push('monster-tracking');
    addArea(s, 'bear-caves');
    s.crews.hunter = { n: 10 };
    const few = lossesPerHour(s, 'hunter');
    // a hundred times the hunters, but the grounds only take so much: the extra ones go looking for more, safely
    s.crews.hunter = { n: 1000 };
    const f = fills(s, 'monsters');
    const working = f.fills.reduce((a, x) => a + x.used, 0) / f.raw;
    expect(working).toBeLessThan(1);
    expect(lossesPerHour(s, 'hunter')).toBeLessThan(few * 100);
    expect(exposed(s, 'hunter')).toBeCloseTo(1000 * working);
  });

  it('research and better tools make it safer', () => {
    const s = game();
    s.crews.miner = { n: 10 };
    const bare = dangerMult(s, 'miner');
    s.research.done.push('ropes-and-lanterns');
    expect(dangerMult(s, 'miner')).toBeCloseTo(bare * 0.5);
    s.rack = { steel: { n: 10, wear: 0 } };
    expect(dangerMult(s, 'miner')).toBeCloseTo((bare * 0.5) / 1.5);
  });

  it('named kobolds are only hurt, and rest by the hoard for a few hours', () => {
    const s = huntingGame();
    s.idle = 1;
    const k = nameKobold(s, 'idle', 'the Bold', 'Was bold.', T0, rng(s))!;
    k.job = 'hunter';
    s.crews.hunter = { n: 0 };
    const { died, lines } = run(s, 400);
    expect(died.hunter ?? 0).toBe(0);
    expect(s.named).toHaveLength(1);
    expect(lines.some((l) => l.includes('resting by the hoard'))).toBe(true);
    expect(k.history.some((h) => h.text.startsWith('Was mauled'))).toBe(true);
    k.restLeft = LOSSES.restSeconds;
    s.losses.acc = {};
    expect(workers(s, 'hunter')).toBe(0);
    // resting, they aren't out hunting, so nothing can happen to them meanwhile
    lossStep(s, LOSSES.restSeconds - 1, T0, rng(s));
    lossStep(s, 1, T0, rng(s));
    expect(workers(s, 'hunter')).toBe(1);
  });

  it('nobody is ever hurt in the lab', () => {
    const s = game();
    s.crews.researcher = { n: 50 };
    tick(s, 86_400);
    expect(workers(s, 'researcher')).toBe(50); // some may have been named, but nobody was lost
    expect(s.losses.died).toBe(0);
  });
});

describe('idle kobolds', () => {
  it('wait a day, then start to wander off, slowly', () => {
    const s = game();
    s.idle = 20;
    run(s, 23);
    expect(s.idle).toBe(20);
    run(s, 25);
    expect(s.idle).toBeLessThan(20);
    expect(s.idle).toBeGreaterThan(5);
    expect(s.losses.wandered).toBe(20 - s.idle);
  });

  it('the clock starts again once everyone has work', () => {
    const s = game();
    s.idle = 5;
    run(s, 20);
    s.crews.scavenger = { n: 5 };
    s.idle = 0;
    run(s, 1);
    s.idle = 5;
    run(s, 20);
    expect(s.idle).toBe(5);
  });

  it("old saves' scouts come home: crowd and named go back to idle", () => {
    const s = game();
    s.idle = 3;
    const k = nameKobold(s, 'idle', 'the Bold', 'Was bold.', T0, rng(s))!;
    const raw = JSON.parse(JSON.stringify(s));
    raw.crews.scout = { n: 7 };
    raw.newcomerJob = 'scout';
    raw.named[0].job = 'scout';
    const back = normalize(raw, T0);
    expect(back.crews.scout).toBeUndefined();
    expect(back.idle).toBe(s.idle + 7);
    expect(back.newcomerJob).toBe('idle');
    expect(back.named.find((x) => x.id === k.id)!.job).toBe('idle');
  });
});

describe('saves', () => {
  it('keep the losses, and a hurt kobold keeps resting', () => {
    const s = game();
    s.idle = 1;
    const k = nameKobold(s, 'idle', 'the Bold', 'Was bold.', T0, rng(s))!;
    k.restLeft = 100;
    s.losses.died = 7;
    s.losses.idleFor = 500;
    const back = normalize(JSON.parse(JSON.stringify(s)), T0);
    expect(back.losses.died).toBe(7);
    expect(back.losses.idleFor).toBe(500);
    expect(back.named[0].restLeft).toBe(100);
  });
});

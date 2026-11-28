// List 7, part C: fewer kobolds. Dangerous work loses the odd crowd kobold,
// named kobolds are only hurt, and idle kobolds with nothing to do wander off.
import { describe, expect, it } from 'vitest';
import type { Chief } from '../src/game/chief';
import { arrive, beds, tick, workers } from '../src/game/economy';
import { dangerMult, LOSSES, lossesPerHour, lossStep } from '../src/game/losses';
import { nameKobold } from '../src/game/kobolds';
import { addArea } from '../src/game/areas';
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
  it('loses about one scout for every 10 hours of scouting each', () => {
    const s = game();
    s.crews.scout = { n: 100 };
    expect(lossesPerHour(s, 'scout')).toBeCloseTo(10);
    const { died, lines } = run(s, 5);
    // fewer scouts as they're lost, so a little under 50
    expect(died.scout).toBeGreaterThan(30);
    expect(died.scout).toBeLessThan(55);
    expect(s.crews.scout.n).toBe(100 - died.scout);
    expect(s.oddities['memorial-wall'].count).toBe(died.scout);
    expect(s.losses.died).toBe(died.scout);
    expect(lines[0]).toMatch(/scout/i);
  });

  it('hunters are lost far less often, and miners only in the deep workings', () => {
    const s = game();
    s.stage = 3;
    s.research.done.push('monster-tracking');
    addArea(s, 'bear-caves');
    s.crews.hunter = { n: 10 };
    expect(lossesPerHour(s, 'hunter')).toBeCloseTo(0.1);
    addArea(s, 'rubble-cave');
    s.crews.miner = { n: 10 };
    expect(lossesPerHour(s, 'miner')).toBe(0);
    addArea(s, 'deep-vein');
    expect(lossesPerHour(s, 'miner')).toBeGreaterThan(0);
  });

  it('research and better tools make it safer', () => {
    const s = game();
    s.crews.scout = { n: 10 };
    const bare = dangerMult(s, 'scout');
    s.research.done.push('ropes-and-lanterns');
    expect(dangerMult(s, 'scout')).toBeCloseTo(bare * 0.5);
    s.rack = { steel: { n: 10, wear: 0 } };
    expect(dangerMult(s, 'scout')).toBeCloseTo((bare * 0.5) / 1.5);
  });

  it('named kobolds are only hurt, and rest by the hoard for a few hours', () => {
    const s = game();
    s.idle = 1;
    const k = nameKobold(s, 'idle', 'the Bold', 'Was bold.', T0, rng(s))!;
    k.job = 'scout';
    s.crews.scout = { n: 0 };
    const { died, lines } = run(s, 40);
    expect(died.scout ?? 0).toBe(0);
    expect(s.named).toHaveLength(1);
    expect(lines.some((l) => l.includes('resting by the hoard'))).toBe(true);
    expect(k.history.some((h) => h.text.startsWith('Was badly hurt'))).toBe(true);
    k.restLeft = LOSSES.restSeconds;
    s.losses.acc = {};
    expect(workers(s, 'scout')).toBe(0);
    lossStep(s, LOSSES.restSeconds, T0, rng(s));
    expect(workers(s, 'scout')).toBe(1);
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

  it('newcomers are never sent scouting on their own', () => {
    const s = game();
    s.newcomerJob = 'scout';
    s.arrivalProgress = 1e9;
    const n = arrive(s, 1);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(beds(s));
    expect(s.crews.scout?.n ?? 0).toBe(0);
    expect(s.idle).toBe(n);
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

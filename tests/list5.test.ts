// List 5: slower digging, no crew experience, fewer and richer named kobolds,
// total modifiers.
import { describe, expect, it } from 'vitest';
import type { Chief } from '../src/game/chief';
import { DIG } from '../src/game/data';
import { grantRequest } from '../src/game/dragon';
import { assignDig, digRate, tick, workPerPace } from '../src/game/economy';
import { digFinds, talentStep } from '../src/game/events';
import { canName, nameKobold, nameOrCredit, NAMED, namedCap, personalMult, personalParts, LOVE_MULT, HATE_MULT } from '../src/game/kobolds';
import { deserialize, serialize } from '../src/game/save';
import { newGame, rng, type GameState } from '../src/game/state';
import { ROOMS } from '../src/game/data';

const T0 = 1_700_000_000_000;
const chief: Chief = { name: 'Snik', cunning: 0, voice: 0, nerve: 0, quirk: 'none' };

function game(): GameState {
  const s = newGame(T0);
  s.chief = { ...chief };
  s.newcomerJob = 'idle';
  s.seed = 4242;
  return s;
}

describe('slower digging', () => {
  it('a pace costs more work the bigger the room already is', () => {
    expect(workPerPace(0)).toBe(DIG.workPerPace);
    expect(workPerPace(DIG.growPaces)).toBe(DIG.workPerPace * 2);
    expect(workPerPace(3000)).toBeGreaterThan(workPerPace(500) * 3);
  });

  it('a small room grows much faster than a big one with the same diggers', () => {
    const a = game();
    const b = game();
    for (const s of [a, b]) {
      s.idle = 10;
      assignDig(s, 'hoard', 10);
      s.res.wood = s.res.stone = s.res.bars = 1e9;
    }
    b.rooms.hoard.volume = 3000;
    expect(digRate(a, 'hoard')).toBeCloseTo(digRate(b, 'hoard'));
    a.chief = b.chief = null;
    const a0 = a.rooms.hoard.volume;
    tick(a, 600);
    tick(b, 600);
    expect(a.rooms.hoard.volume - a0).toBeGreaterThan((b.rooms.hoard.volume - 3000) * 3);
  });
});

describe('no crew experience', () => {
  it('old saves with crew experience load without it', () => {
    const s = game();
    s.crews.scavenger = { n: 4 };
    const raw = JSON.parse(serialize(s, T0));
    raw.state.crews.scavenger.exp = 12;
    const back = deserialize(JSON.stringify(raw), T0);
    expect(back.crews.scavenger).toEqual({ n: 4 });
  });
});

describe('fewer, richer named kobolds', () => {
  it('the warren keeps about one named kobold in ten, at least a few', () => {
    const s = game();
    s.idle = 5;
    expect(namedCap(s)).toBe(NAMED.min);
    s.idle = 95;
    expect(namedCap(s)).toBe(9);
  });

  it('past the cap, an event credits a named kobold on the job instead of naming someone new', () => {
    const s = game();
    s.crews.miner = { n: 20 };
    s.crews.scavenger = { n: 9 };
    const rand = rng(s);
    const q = nameKobold(s, 'miner', 'the First', 'Was first.', T0, rand)!;
    nameKobold(s, 'scavenger', 'the Second', 'Was second.', T0, rand);
    expect(canName(s)).toBe(true);
    nameKobold(s, 'scavenger', 'the Third', 'Was third.', T0, rand);
    expect(canName(s)).toBe(false);
    const got = nameOrCredit(s, 'miner', 'the Fourth', T0, rand)!;
    expect(got.fresh).toBe(false);
    expect(got.k).toBe(q);
    expect(s.named.length).toBe(3);
  });

  it('talents found past the cap go to named kobolds on the job', () => {
    const s = game();
    s.crews.digger = { n: 40 };
    s.dig = { den: 40 };
    const rand = rng(s);
    for (let i = 0; i < 4; i++) nameKobold(s, 'digger', 'the Digger', 'Dug.', T0, rand);
    expect(canName(s)).toBe(false);
    const before = s.named.length;
    for (let i = 0; i < 200; i++) talentStep(s, 3600, T0, rand);
    expect(s.named.length).toBe(before);
    expect(s.named.some((k) => (k.talents ?? []).length > 0)).toBe(true);
  });

  it('digging finds past the cap credit a named digger', () => {
    const s = game();
    s.crews.digger = { n: 30 };
    s.dig = { den: 30 };
    const rand = rng(s);
    for (let i = 0; i < 3; i++) nameKobold(s, 'digger', 'the Digger', 'Dug.', T0, rand);
    const before = s.named.length;
    const den = ROOMS.find((r) => r.id === 'den')!;
    let lines = 0;
    for (let i = 0; i < 300; i++) if (digFinds(s, den, 1e6, rand, T0)) lines++;
    expect(lines).toBeGreaterThan(0);
    // lost kobolds found in the walls can make room for a name or two more, never past the cap
    expect(s.named.length).toBeLessThanOrEqual(Math.max(before, namedCap(s)));
    expect(s.named.some((k) => k.history.length > 1)).toBe(true);
  });

  it('a dragon audience past the cap goes to someone already named', () => {
    const s = game();
    s.stage = 1;
    s.crews.scavenger = { n: 20 };
    const rand = rng(s);
    for (let i = 0; i < 3; i++) nameKobold(s, 'scavenger', 'the Scav', 'Scavved.', T0, rand);
    s.dragon.request = { kind: 'audience', namedId: null, job: 'scavenger', name: 'one of the scavengers', until: 1e12 };
    expect(grantRequest(s, T0, rand)).toBeTruthy();
    expect(s.named.length).toBe(3);
    expect(s.named.some((k) => k.gifts.length === 1)).toBe(true);
  });
});

describe('total modifiers', () => {
  it('lists what makes a kobold better at each job, and multiplies them up', () => {
    const s = game();
    s.crews.digger = { n: 1 };
    s.dig = { den: 1 };
    const k = nameKobold(s, 'digger', 't', 'x', T0, rng(s))!;
    k.loves = 'digger';
    k.hates = 'miner';
    k.gifts = ['blessed-pick'];
    k.talents = [{ job: 'digger', mult: 1.25, name: 'Shovel-hands' }];
    expect(personalParts(k).map((p) => p.label)).toEqual(['loves it', 'a dragon-blessed pick', 'Shovel-hands']);
    expect(personalMult(k)).toBeCloseTo(LOVE_MULT * 1.5 * 1.25);
    expect(personalMult(k, 'miner')).toBeCloseTo(HATE_MULT * 1.5);
    expect(personalMult(k, 'scavenger')).toBeCloseTo(1.5);
  });
});

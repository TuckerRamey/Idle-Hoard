import { describe, expect, it } from 'vitest';
import { ATTRACTION, CONFIG, CREW, DIG, DRAGON_STAGES, HOARD_SIZE_THRESHOLDS, ROOMS } from '../src/game/data';
import {
  advanceTo,
  appeal,
  arrivalSeconds,
  arrive,
  assign,
  beds,
  capacity,
  digBlocked,
  flows,
  hoardSize,
  incomePerSecond,
  jobHints,
  population,
  production,
  storeGoods,
  stageFor,
  tick,
  workPerPace,
  veteranBonus,
} from '../src/game/economy';
import { newGame, type GameState } from '../src/game/state';
import type { Chief } from '../src/game/chief';

const T0 = 1_700_000_000_000;
const chief: Chief = { name: 'Snik', cunning: 0, voice: 0, nerve: 0, quirk: 'none' };
const room = (id: string) => ROOMS.find((r) => r.id === id)!;

/** A game with a Chief whose stats do nothing, so the numbers are easy to check. */
function game(): GameState {
  const s = newGame(T0);
  s.chief = { ...chief };
  s.newcomerJob = 'idle';
  return s;
}

describe('new game', () => {
  it('starts as an egg with no kobolds, no Chief, and size 1 rooms', () => {
    const s = newGame(T0);
    expect(s.stage).toBe(0);
    expect(DRAGON_STAGES[0].id).toBe('egg');
    expect(s.chief).toBeNull();
    expect(population(s)).toBe(0);
    expect(incomePerSecond(s)).toBe(0);
    for (const r of ROOMS) expect(s.rooms[r.id].volume).toBe(r.start);
  });
});

describe('crews', () => {
  it('moves kobolds between idle and a job, never more than there are', () => {
    const s = game();
    s.idle = 10;
    expect(assign(s, 'scavenger', 4)).toBe(4);
    expect(assign(s, 'woodcutter', 20)).toBe(6);
    expect(s.idle).toBe(0);
    expect(assign(s, 'quarrier', 1)).toBe(0);
    expect(assign(s, 'scavenger', -100)).toBe(-4);
    expect(s.idle).toBe(4);
    expect(population(s)).toBe(10);
    expect(assign(s, 'no-such-job', 1)).toBe(0);
  });

  it('a crew gets better the longer it works together', () => {
    const s = game();
    s.idle = 1;
    assign(s, 'scavenger', 1);
    const fresh = production(s).copper;
    tick(s, CREW.halfHours * 3600);
    expect(veteranBonus(s.crews.scavenger.exp)).toBeCloseTo(CREW.maxBonus / 2, 2);
    expect(production(s).copper).toBeGreaterThan(fresh);
  });

  it('newcomers water down a veteran crew, so bulk moves cost some experience', () => {
    const s = game();
    s.crews.scavenger = { n: 10, exp: 12 };
    s.idle = 10;
    assign(s, 'scavenger', 10);
    expect(s.crews.scavenger.exp).toBeCloseTo(6);
    // leaving doesn't change the experience of those who stay
    assign(s, 'scavenger', -5);
    expect(s.crews.scavenger.exp).toBeCloseTo(6);
  });

  it('Cunning makes crews learn faster', () => {
    const a = game();
    const b = game();
    b.chief!.cunning = 3;
    a.crews.scavenger = { n: 1, exp: 0 };
    b.crews.scavenger = { n: 1, exp: 0 };
    tick(a, 3600);
    tick(b, 3600);
    expect(b.crews.scavenger.exp).toBeCloseTo(a.crews.scavenger.exp * 1.3);
  });
});

describe('tick', () => {
  it('makes each resource from its job, and the Chief hauls copper', () => {
    const s = game();
    s.crews = { scavenger: { n: 3, exp: 0 }, woodcutter: { n: 2, exp: 0 }, quarrier: { n: 4, exp: 0 } };
    tick(s, 10);
    // experience grows a hair over 10 seconds, so allow a little
    expect(s.res.copper).toBeCloseTo((3 * 0.5 + CONFIG.chiefRate) * 10, 0);
    expect(s.res.wood).toBeCloseTo(2 * 0.5 * 10, 0);
    expect(s.res.stone).toBeCloseTo(4 * 0.5 * 10, 0);
    expect(s.totalEarned).toBe(s.res.copper);
  });

  it('gives about the same result for one long tick or many short ones', () => {
    const a = game();
    const b = game();
    a.crews.scavenger = { n: 7, exp: 0 };
    b.crews.scavenger = { n: 7, exp: 0 };
    tick(a, 600);
    for (let i = 0; i < 600; i++) tick(b, 1);
    expect(a.res.copper / b.res.copper).toBeCloseTo(1, 3);
  });

  it('ignores zero, negative and NaN time', () => {
    const s = game();
    for (const t of [0, -5, NaN]) tick(s, t);
    expect(s.res.copper).toBe(0);
  });

  it('stops at what the rooms can hold, and counts the rest as lost', () => {
    const s = game();
    s.crews.woodcutter = { n: 10, exp: 0 };
    const cap = capacity(s, 'wood');
    const r = tick(s, 3600);
    expect(s.res.wood).toBe(cap);
    expect(r.lost.wood).toBeGreaterThan(0);
  });

  it('keeps each good in its own store, so stone can never crowd out wood', () => {
    const s = game();
    s.crews.quarrier = { n: 50, exp: 0 };
    tick(s, 86_400);
    expect(s.res.stone).toBe(capacity(s, 'stone'));
    s.crews = { woodcutter: { n: 1, exp: 0 } };
    tick(s, 10);
    expect(s.res.wood).toBeGreaterThan(0);
  });

  it('hatches the egg once enough copper is buried', () => {
    const s = game();
    const r = tick(s, DRAGON_STAGES[1].threshold! / CONFIG.chiefRate + 1);
    expect(r.newStage).toBe(1);
    expect(s.stage).toBe(1);
  });

  it('never moves the dragon backwards when copper is spent', () => {
    const s = game();
    tick(s, 2000);
    s.res.copper = 0;
    tick(s, 1);
    expect(s.stage).toBe(stageFor(s.totalEarned));
    expect(s.stage).toBeGreaterThan(0);
  });
});

describe('digging rooms', () => {
  it('small rooms need only diggers, and grow with every bit of digging', () => {
    const s = game();
    s.crews.digger = { n: 1, exp: 0 };
    s.dig = { den: s.crews.digger?.n ?? 0 };
    const before = beds(s);
    tick(s, 1000);
    expect(s.rooms.den.volume).toBeGreaterThan(room('den').start + 1000 / workPerPace(room('den').start + 200));
    expect(beds(s)).toBeGreaterThan(before);
  });

  it('big rooms use wood to hold the ceiling up, and stall without it', () => {
    const wood = DIG.supports.find((x) => x.resource === 'wood')!;
    const s = game();
    s.rooms.den.volume = wood.fromPaces;
    s.crews.digger = { n: 1, exp: 0 };
    s.dig = { den: s.crews.digger?.n ?? 0 };
    s.res.wood = 10;
    tick(s, 4);
    expect(s.res.wood).toBeCloseTo(10 - (4 / workPerPace(wood.fromPaces)) * wood.perPace, 3);
    tick(s, 1000);
    expect(s.res.wood).toBe(0);
    expect(digBlocked(s, 'den')).toBe('wood');
    const vol = s.rooms.den.volume;
    tick(s, 100);
    expect(s.rooms.den.volume).toBe(vol);
  });

  it('a stalled dig points at the job that fixes it', () => {
    const s = game();
    s.rooms.woodpile.volume = 200;
    s.crews.digger = { n: 4, exp: 0 };
    s.dig = { woodpile: s.crews.digger?.n ?? 0 };
    const hints = jobHints(s);
    expect(hints.woodcutter).toMatch(/run out of mushroom wood.*About \d+ more woodcutters?/);
    expect(flows(s).wood.out).toBeGreaterThan(0);
  });

  it('a long absence digs a long way and notes round sizes', () => {
    const s = game();
    s.crews.digger = { n: 5, exp: 0 };
    s.crews.woodcutter = { n: 10, exp: 0 };
    s.crews.quarrier = { n: 10, exp: 0 };
    s.dig = { hoard: s.crews.digger?.n ?? 0 };
    const r = advanceTo(s, T0 + 3 * 3600 * 1000);
    expect(r.dug.length).toBeGreaterThan(1);
    expect(s.rooms.hoard.volume).toBeGreaterThan(1000);
  });

  it('stops at the size limit until deep delving', () => {
    const s = game();
    s.rooms.den.volume = DIG.maxPaces;
    s.dig = { den: s.crews.digger?.n ?? 0 };
    expect(digBlocked(s, 'den')).toBe('full');
    s.research.done.push('deep-delving');
    expect(digBlocked(s, 'den')).not.toBe('full');
  });

  it('room capacity grows with volume', () => {
    const s = game();
    expect(capacity(s, 'copper')).toBe(room('hoard').start * 1000);
    s.rooms.hoard.volume *= 3;
    expect(capacity(s, 'copper')).toBe(room('hoard').start * 3000);
  });

  it('each store holds its own goods, and the metal store splits evenly', () => {
    const s = game();
    expect(capacity(s, 'wood')).toBe(room('woodpile').start * 40);
    s.rooms.stoneyard.volume = 1000;
    expect(capacity(s, 'wood')).toBe(room('woodpile').start * 40);
    s.research.done.push('ore-sniffing', 'smithing');
    expect(storeGoods(s, 'metals').map((g) => g.id)).toEqual(['ore', 'bars']);
    expect(capacity(s, 'ore')).toBe((room('metals').start / 2) * 40);
  });
});

describe('advanceTo (offline progress)', () => {
  it('credits the time since the last tick', () => {
    const s = game();
    const r = advanceTo(s, T0 + 90_000);
    expect(r.credited).toBe(90);
    expect(s.res.copper).toBeCloseTo(90);
    expect(s.lastTick).toBe(T0 + 90_000);
  });

  it('caps long absences', () => {
    const s = game();
    const r = advanceTo(s, T0 + (CONFIG.offlineCapSeconds + 3600) * 1000);
    expect(r.credited).toBe(CONFIG.offlineCapSeconds);
  });

  it('credits nothing if the clock went backwards', () => {
    const s = game();
    advanceTo(s, T0 - 60_000);
    expect(s.res.copper).toBe(0);
    expect(s.lastTick).toBe(T0);
  });
});

describe('kobolds coming to the hoard', () => {
  it('nobody comes before there is a Chief', () => {
    const s = newGame(T0);
    expect(arrive(s, 3600)).toBe(0);
  });

  it('newcomers fill the free beds, then stop', () => {
    const s = game();
    const every = arrivalSeconds(s);
    expect(arrive(s, every - 1)).toBe(0);
    expect(arrive(s, 1)).toBe(1);
    expect(arrive(s, 1e6)).toBe(beds(s) - 1);
    expect(arrive(s, 1e6)).toBe(0);
    expect(population(s)).toBe(beds(s));
  });

  it('newcomers go to the chosen job, or wait idle', () => {
    const s = game();
    s.newcomerJob = 'woodcutter';
    arrive(s, 1e6);
    expect(s.crews.woodcutter.n).toBe(beds(s));
    const t = game();
    t.newcomerJob = 'idle';
    arrive(t, 1e6);
    expect(t.idle).toBe(beds(t));
  });

  it('the dragon, the hoard worth (each tenfold the same), oddities and art draw kobolds', () => {
    const s = game();
    const base = appeal(s);
    s.res.copper = 999;
    expect(appeal(s)).toBeCloseTo(base + 3 * ATTRACTION.perValueDecade);
    s.res.copper = 9_999;
    expect(appeal(s)).toBeCloseTo(base + 4 * ATTRACTION.perValueDecade);
    const before = appeal(s);
    s.stage = 2;
    expect(appeal(s)).toBeCloseTo(before - DRAGON_STAGES[0].appeal + DRAGON_STAGES[2].appeal);
    const staged = appeal(s);
    s.oddities.kogoat = { count: 1, firstAt: T0 };
    expect(appeal(s)).toBeCloseTo(staged + ATTRACTION.perOddity);
    s.art.pieces.push({ id: 1, title: 'a test', by: '', material: 'carving', appeal: 6, t: T0 });
    expect(appeal(s)).toBeCloseTo(staged + ATTRACTION.perOddity + 6);
  });

  it('Voice draws kobolds faster', () => {
    const s = game();
    const slow = arrivalSeconds(s);
    s.chief!.voice = 3;
    expect(arrivalSeconds(s)).toBeCloseTo(slow / 1.3);
  });
});

describe('the coin pile', () => {
  it('follows the copper you hold, not the lifetime total', () => {
    expect(hoardSize(0)).toBe(0);
    expect(hoardSize(1e9)).toBe(HOARD_SIZE_THRESHOLDS.length - 1);
    const s = game();
    s.totalEarned = 1e9;
    s.res.copper = 10;
    expect(hoardSize(s.res.copper)).toBe(0);
  });
});

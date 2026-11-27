import { describe, expect, it } from 'vitest';
import { ATTRACTION, CONFIG, DRAGON_STAGES, HOARD_SIZE_THRESHOLDS, WORKERS } from '../src/game/data';
import {
  advanceTo,
  arrive,
  attractionTarget,
  buyUpgrade,
  hoardSize,
  population,
  workerBaseCost,
  demote,
  promote,
  promotionCost,
  incomePerSecond,
  stageFor,
  tick,
  workerCost,
} from '../src/game/economy';
import { newGame } from '../src/game/state';

const T0 = 1_700_000_000_000;
const scavenger = WORKERS.find((w) => w.id === 'scavenger')!;

describe('new game', () => {
  it('starts as an egg with no kobolds and no Chief yet', () => {
    const s = newGame(T0);
    expect(s.stage).toBe(0);
    expect(DRAGON_STAGES[0].id).toBe('egg');
    expect(s.chief).toBeNull();
    expect(incomePerSecond(s)).toBe(0);
  });
});

describe('tick', () => {
  it('adds rate × seconds of copper', () => {
    const s = newGame(T0);
    s.workers.scavenger = 3;
    tick(s, 10);
    expect(s.copper).toBeCloseTo(30);
    expect(s.totalEarned).toBeCloseTo(30);
  });

  it('gives the same result for one long tick or many short ones', () => {
    const a = newGame(T0);
    const b = newGame(T0);
    a.workers.scavenger = b.workers.scavenger = 7;
    tick(a, 600);
    for (let i = 0; i < 600; i++) tick(b, 1);
    expect(a.copper).toBeCloseTo(b.copper, 6);
  });

  it('ignores zero, negative and NaN time', () => {
    const s = newGame(T0);
    for (const t of [0, -5, NaN]) tick(s, t);
    expect(s.copper).toBe(0);
  });

  it('hatches the egg once enough copper is buried', () => {
    const s = newGame(T0);
    s.workers.scavenger = 1;
    const r = tick(s, DRAGON_STAGES[1].threshold); // 1 copper/s
    expect(r.newStage).toBe(1);
    expect(s.stage).toBe(1);
  });

  it('credits time after a stage change at the new income multiplier', () => {
    const s = newGame(T0);
    s.stage = 1;
    s.totalEarned = DRAGON_STAGES[2].threshold - 10;
    s.workers.scavenger = 1; // 1/s, young dragon gives 1.25x
    tick(s, 20);
    expect(s.stage).toBe(2);
    expect(s.copper).toBeCloseTo(10 + 10 * DRAGON_STAGES[2].incomeMult);
  });

  it('never moves the dragon backwards when copper is spent', () => {
    const s = newGame(T0);
    s.workers.scavenger = 1;
    tick(s, 2000);
    s.copper = 0;
    tick(s, 1);
    expect(s.stage).toBe(stageFor(s.totalEarned));
    expect(s.stage).toBeGreaterThan(0);
  });
});

describe('advanceTo (offline progress)', () => {
  it('credits the time since the last tick', () => {
    const s = newGame(T0);
    s.workers.scavenger = 1;
    const r = advanceTo(s, T0 + 90_000);
    expect(r.credited).toBe(90);
    expect(s.copper).toBeCloseTo(90);
    expect(s.lastTick).toBe(T0 + 90_000);
  });

  it('caps long absences', () => {
    const s = newGame(T0);
    s.stage = DRAGON_STAGES.length - 1; // avoid stage multipliers changing the math
    s.totalEarned = 1e12;
    const before = incomePerSecond(s);
    const r = advanceTo(s, T0 + (CONFIG.offlineCapSeconds + 3600) * 1000);
    expect(r.credited).toBe(CONFIG.offlineCapSeconds);
    expect(s.copper).toBeCloseTo(before * CONFIG.offlineCapSeconds);
  });

  it('credits nothing if the clock went backwards', () => {
    const s = newGame(T0);
    advanceTo(s, T0 - 60_000);
    expect(s.copper).toBe(0);
    expect(s.lastTick).toBe(T0);
  });
});

describe('hiring and upgrades', () => {
  it('costs grow with each one owned', () => {
    expect(workerBaseCost(scavenger, 0)).toBe(scavenger.baseCost);
    expect(workerBaseCost(scavenger, 10)).toBeGreaterThan(workerBaseCost(scavenger, 9));
  });

  it('promotes a scavenger into a better job for copper', () => {
    const s = newGame(T0);
    s.stage = 1;
    s.workers.scavenger = 2;
    s.copper = 1000;
    const digger = WORKERS[1];
    const cost = promotionCost(s, 'digger')!;
    expect(cost).toBe(workerCost(s, digger));
    expect(promote(s, 'digger')).toBe(true);
    expect(s.workers).toEqual({ scavenger: 1, digger: 1 });
    expect(s.copper).toBe(1000 - cost);
  });

  it('refuses promotion when too poor, the job is closed, or nobody is below', () => {
    const s = newGame(T0);
    s.copper = 1e9;
    s.workers.scavenger = 1;
    expect(promote(s, 'digger')).toBe(false); // needs a hatched dragon
    s.stage = 1;
    expect(promote(s, 'digger')).toBe(true);
    expect(promote(s, 'digger')).toBe(false); // no scavengers left
    expect(promote(s, 'scavenger')).toBe(false); // the first job is entry only
    s.workers.scavenger = 1;
    s.copper = 0;
    expect(promote(s, 'digger')).toBe(false);
  });

  it('demotes for free, one rung down', () => {
    const s = newGame(T0);
    s.workers = { scavenger: 0, digger: 2 };
    expect(demote(s, 'digger')).toBe(true);
    expect(s.workers).toEqual({ scavenger: 1, digger: 1 });
    expect(demote(s, 'scavenger')).toBe(false);
  });

  it('upgrade multiplies its worker', () => {
    const s = newGame(T0);
    s.workers.scavenger = 5;
    s.copper = 1000;
    const before = incomePerSecond(s);
    expect(buyUpgrade(s, 'bigger-pockets')).toBe(true);
    expect(incomePerSecond(s)).toBeCloseTo(before * 2);
    expect(buyUpgrade(s, 'bigger-pockets')).toBe(false); // only once
  });
});

describe('kobolds coming to the hoard', () => {
  const chief = { name: 'Snik', cunning: 2, voice: 2, nerve: 2, quirk: 'packmule' };

  it('nobody comes before there is a Chief', () => {
    const s = newGame(T0);
    expect(arrive(s, 3600)).toBe(0);
  });

  it('the egg alone draws one kobold, who starts as a scavenger', () => {
    const s = newGame(T0);
    s.chief = chief;
    expect(attractionTarget(s)).toBe(ATTRACTION.baseByStage[0]);
    expect(arrive(s, ATTRACTION.arrivalSecondsByStage[0] - 1)).toBe(0);
    expect(arrive(s, 1)).toBe(1);
    expect(s.workers.scavenger).toBe(1);
    expect(arrive(s, 3600)).toBe(0); // full
  });

  it('more copper held and a bigger dragon draw more kobolds', () => {
    const s = newGame(T0);
    s.chief = chief;
    const egg = attractionTarget(s);
    s.copper = 50 * 15; // four doublings past 50
    expect(attractionTarget(s)).toBe(egg + 4 * ATTRACTION.perDoubling);
    s.stage = 2;
    expect(attractionTarget(s)).toBe(ATTRACTION.baseByStage[2] + 4 * ATTRACTION.perDoubling);
  });

  it('spending copper lowers the target but nobody leaves', () => {
    const s = newGame(T0);
    s.chief = chief;
    s.copper = 10_000;
    arrive(s, 1e6);
    const pop = population(s);
    s.copper = 0;
    expect(arrive(s, 1e6)).toBe(0);
    expect(population(s)).toBe(pop);
  });

  it('a long absence keeps drawing kobolds as the hoard grows', () => {
    const s = newGame(T0);
    s.chief = chief;
    const r = advanceTo(s, T0 + 6 * 3600 * 1000);
    expect(r.arrived).toBeGreaterThan(1);
    expect(population(s)).toBe(r.arrived);
    expect(population(s)).toBeLessThanOrEqual(attractionTarget(s));
  });
});

describe('the coin pile', () => {
  it('follows the copper you hold, not the lifetime total', () => {
    expect(hoardSize(0)).toBe(0);
    expect(hoardSize(1e9)).toBe(HOARD_SIZE_THRESHOLDS.length - 1);
    const s = newGame(T0);
    s.totalEarned = 1e9;
    s.copper = 10;
    expect(hoardSize(s.copper)).toBe(0);
  });
});

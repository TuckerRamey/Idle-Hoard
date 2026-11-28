// Kobolds eat: farmers grow food in the farm caverns. A warren that can't
// feed itself takes in nobody new, and if it lasts, hungry kobolds leave.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { arrive, flows, production, roomDef, roomOpen, tick } from '../src/game/economy';
import { eatStep, FOOD, foodNeed, hungry } from '../src/game/losses';
import { newGame, type GameState } from '../src/game/state';

const T0 = 1_700_000_000_000;
let saved = 0;
beforeAll(() => {
  saved = FOOD.perKobold;
  FOOD.perKobold = 0.05;
});
afterAll(() => {
  FOOD.perKobold = saved;
});

function game(): GameState {
  const s = newGame(T0);
  s.chief = { name: 'Snik', cunning: 0, voice: 0, nerve: 0, quirk: 'none' } as never;
  s.newcomerJob = 'idle';
  return s;
}

describe('food', () => {
  it('a new warren has the mushroom beds and a little food put by', () => {
    const s = game();
    expect(roomOpen(s, roomDef('farm-1')!)).toBe(true);
    expect(s.res.food).toBeGreaterThan(0);
  });

  it('every kobold eats, and farmers grow it, as many as the caverns fit', () => {
    const s = game();
    s.idle = 20;
    expect(foodNeed(s)).toBeCloseTo(20 * 0.05);
    s.crews.farmer = { n: 2 };
    expect(production(s).food).toBeCloseTo(1);
    s.crews.farmer = { n: 100 };
    expect(production(s).food).toBeCloseTo(2); // the mushroom beds fit 4 farmers to start
    expect(flows(s).food.out).toBeCloseTo(foodNeed(s));
  });

  it('short of food, nobody moves in', () => {
    const s = game();
    s.idle = 10;
    s.rooms.den.volume = 1000; // beds to spare
    s.res.food = 0;
    s.arrivalProgress = 1e9;
    expect(hungry(s)).toBe(10);
    expect(arrive(s, 1)).toBe(0);
    s.crews.farmer = { n: 2 }; // 1 food a second feeds 20
    s.idle -= 2;
    expect(hungry(s)).toBe(0);
    s.arrivalProgress = 1e9;
    expect(arrive(s, 1)).toBeGreaterThan(0);
  });

  it('after an hour hungry, hungry kobolds start to leave, idle ones first', () => {
    const s = game();
    s.idle = 30;
    s.crews.miner = { n: 30 };
    s.res.food = 0;
    let left = 0;
    for (let i = 0; i < 5; i++) left += eatStep(s, 600).left; // most of the first hour: a grace period
    expect(left).toBe(0);
    for (let i = 0; i < 37; i++) left += eatStep(s, 600).left; // six hours more
    // 60 hungry kobolds, each leaving after about six hours, fewer as they go
    expect(left).toBeGreaterThan(25);
    expect(left).toBeLessThan(45);
    expect(s.idle).toBe(Math.max(0, 30 - left));
    expect(s.losses.starved).toBe(left);
  });

  it('a fed warren loses nobody', () => {
    const s = game();
    s.idle = 10;
    s.crews.farmer = { n: 4 };
    const r = tick(s, 86_400);
    expect(r.starved).toBe(0);
    expect(s.res.food).toBeGreaterThan(0);
  });
});

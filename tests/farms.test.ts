// Farm caverns are rooms the kobolds dig, one after another. Each is planted
// with a crop; crops are found in different ways and grow different amounts.
import { describe, expect, it } from 'vitest';
import { addArea, exploreStep } from '../src/game/areas';
import { appeal, assignDig, capacity, digRate, production, researchRate, roomDef, roomOpen, tick } from '../src/game/economy';
import { cropKnown, cropOf, farmDigRoom, fields, plant, spareFarmers } from '../src/game/farms';
import { huntStep } from '../src/game/hunting';
import { raidStep } from '../src/game/raids';
import { normalize } from '../src/game/save';
import { newGame, rng, type GameState } from '../src/game/state';

const T0 = 1_700_000_000_000;

function game(): GameState {
  const s = newGame(T0);
  s.chief = { name: 'Snik', cunning: 0, voice: 0, nerve: 0, quirk: 'none' } as never;
  s.newcomerJob = 'idle';
  s.seed = 77;
  return s;
}

const open = (s: GameState, id: string) => roomOpen(s, roomDef(id)!);

describe('farm caverns', () => {
  it('open one after another as the one before is dug out', () => {
    const s = game();
    expect(open(s, 'farm-1')).toBe(true);
    expect(open(s, 'farm-2')).toBe(false);
    s.rooms['farm-1'].volume = 100;
    expect(open(s, 'farm-2')).toBe(true);
    expect(fields(s).map((f) => f.fit)).toEqual([10, 1]);
    s.rooms['farm-2'].volume = 200;
    expect(open(s, 'farm-3')).toBe(true);
    s.rooms['farm-3'].volume = 400;
    expect(open(s, 'farm-4')).toBe(false); // waits for the dragon to hatch
    s.stage = 1;
    expect(open(s, 'farm-4')).toBe(true);
  });

  it('farmers with no room dig the newest cavern bigger', () => {
    const s = game();
    s.crews.farmer = { n: 10 };
    expect(spareFarmers(s)).toBe(6);
    expect(farmDigRoom(s)).toBe('farm-1');
    expect(digRate(s, 'farm-1')).toBeGreaterThan(0);
    const before = s.rooms['farm-1'].volume;
    s.res.food = 1e6;
    tick(s, 3600);
    expect(s.rooms['farm-1'].volume).toBeGreaterThan(before);
  });

  it('diggers can dig them too', () => {
    const s = game();
    s.idle = 5;
    expect(assignDig(s, 'farm-1', 5)).toBe(5);
    expect(digRate(s, 'farm-1')).toBeGreaterThan(0);
  });
});

describe('crops', () => {
  it('start with cave moss; better crops grow more, and farmers take the best caverns first', () => {
    const s = game();
    s.rooms['farm-1'].volume = 100;
    expect(cropOf(s, 'farm-1').id).toBe('cave-moss');
    expect(plant(s, 'farm-2', 'blindroot')).toBe(false); // not known yet
    s.research.done.push('root-farming');
    expect(plant(s, 'farm-2', 'blindroot')).toBe(true);
    s.crews.farmer = { n: 1 };
    // the one farmer works the blindroot cavern
    expect(production(s).food).toBeCloseTo(0.5 * 1.3);
    s.crews.farmer = { n: 11 };
    expect(production(s).food).toBeCloseTo(0.5 * (1.3 + 10));
  });

  it('diggers turn up glowcaps, and glowcaps help the researchers', () => {
    const s = game();
    s.idle = 200;
    s.rooms.den.volume = 300;
    s.res.wood = s.res.stone = 1e6;
    s.res.food = 1e6;
    assignDig(s, 'den', 200);
    for (let i = 0; i < 48 && !cropKnown(s, 'glowcaps'); i++) tick(s, 3600);
    expect(cropKnown(s, 'glowcaps')).toBe(true);
    s.crews.researcher = { n: 10 };
    const r = researchRate(s);
    plant(s, 'farm-1', 'glowcaps');
    expect(researchRate(s)).toBeCloseTo(r); // nobody farming it yet
    s.crews.farmer = { n: 1 };
    expect(researchRate(s)).toBeCloseTo(r * 1.05);
  });

  it('woodcutters find puffballs in new woodland; they make the granary hold more', () => {
    const s = game();
    addArea(s, 'grove');
    s.crews.woodcutter = { n: 500 };
    const rand = rng(s);
    for (let i = 0; i < 200_000 && !cropKnown(s, 'puffballs'); i++) exploreStep(s, 60, T0, rand);
    expect(cropKnown(s, 'puffballs')).toBe(true);
    const cap = capacity(s, 'food');
    plant(s, 'farm-1', 'puffballs');
    s.crews.farmer = { n: 1 };
    expect(capacity(s, 'food')).toBeGreaterThan(cap * 1.2);
  });

  it('hunters bring back fire peppers from salamander grounds', () => {
    const s = game();
    s.stage = 2;
    s.research.done.push('crab-wrangling', 'monster-tracking');
    addArea(s, 'ember-pits');
    s.crews.hunter = { n: 200 };
    const rand = rng(s);
    for (let i = 0; i < 2000 && !cropKnown(s, 'fire-peppers'); i++) huntStep(s, 600, T0, rand);
    expect(cropKnown(s, 'fire-peppers')).toBe(true);
  });

  it('the dragon brings sweet tubers home from a farmstead; they draw kobolds in', () => {
    const s = game();
    s.stage = 2;
    s.dragon.raid = { target: 'farmstead', until: 0, rider: null };
    const lines = raidStep(s, T0, rng(s));
    expect(lines.join(' ')).toMatch(/sweet tubers/);
    expect(cropKnown(s, 'sweet-tubers')).toBe(true);
    const a = appeal(s);
    plant(s, 'farm-1', 'sweet-tubers');
    s.crews.farmer = { n: 1 };
    expect(appeal(s)).toBeCloseTo(a * 1.1);
  });
});

describe('old saves', () => {
  it('get mushroom beds big enough for every farmer, and keep crops on a round trip', () => {
    const s = game();
    s.crews.farmer = { n: 30 };
    const raw = JSON.parse(JSON.stringify(s));
    delete raw.farms;
    const back = normalize(raw, T0);
    expect(spareFarmers(back)).toBe(0);
    back.research.done.push('root-farming');
    plant(back, 'farm-1', 'blindroot');
    const again = normalize(JSON.parse(JSON.stringify(back)), T0);
    expect(again.farms.crops['farm-1']).toBe('blindroot');
    expect(again.rooms['farm-1'].volume).toBe(back.rooms['farm-1'].volume);
  });
});

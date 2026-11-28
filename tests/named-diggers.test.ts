// Named diggers each dig a room of their own.
import { describe, expect, it } from 'vitest';
import type { Chief } from '../src/game/chief';
import { assignDig, digRates, namedDigRoom, namedDiggersIn } from '../src/game/economy';
import { nameKobold, setNamedRoom } from '../src/game/kobolds';
import { normalize } from '../src/game/save';
import { newGame, rng, type GameState } from '../src/game/state';

const T0 = 1_700_000_000_000;
const chief: Chief = { name: 'Snik', cunning: 0, voice: 0, nerve: 0, quirk: 'none' };

function game(): GameState {
  const s = newGame(T0);
  s.chief = { ...chief };
  s.newcomerJob = 'idle';
  s.seed = 5;
  return s;
}

describe('named diggers', () => {
  it('dig even when no crowd diggers are out, the den by default', () => {
    const s = game();
    s.idle = 1;
    const k = nameKobold(s, 'idle', 't', 'x', T0, rng(s))!;
    k.job = 'digger';
    expect(namedDigRoom(s, k)).toBe('den');
    expect(digRates(s).den).toBeGreaterThan(0);
    expect(namedDiggersIn(s, 'den')).toEqual([k]);
  });

  it('follow the crowd until given a room, then dig it alone', () => {
    const s = game();
    s.idle = 5;
    assignDig(s, 'woodpile', 4);
    const k = nameKobold(s, 'idle', 't', 'x', T0, rng(s))!;
    k.job = 'digger';
    expect(namedDigRoom(s, k)).toBe('woodpile');
    const crowdOnly = digRates(s).woodpile;
    expect(setNamedRoom(s, k.id, 'hoard')).toBe(true);
    expect(digRates(s).hoard).toBeGreaterThan(0);
    expect(digRates(s).woodpile).toBeLessThan(crowdOnly);
    expect(setNamedRoom(s, k.id, 'nowhere')).toBe(false);
  });

  it('with no room picked, spread over the rooms being dug in step with the crowd', () => {
    const s = game();
    s.idle = 90;
    assignDig(s, 'hoard', 20);
    assignDig(s, 'den', 20);
    assignDig(s, 'pasture', 0);
    assignDig(s, 'woodpile', 40);
    const rand = rng(s);
    for (let i = 0; i < 10; i++) nameKobold(s, 'idle', `t${i}`, 'x', T0, rand)!.job = 'digger';
    expect(namedDiggersIn(s, 'hoard').length).toBe(2);
    expect(namedDiggersIn(s, 'den').length).toBe(3);
    expect(namedDiggersIn(s, 'woodpile').length).toBe(5);
  });

  it('keep their room through a save', () => {
    const s = game();
    s.idle = 1;
    const k = nameKobold(s, 'idle', 't', 'x', T0, rng(s))!;
    k.job = 'digger';
    setNamedRoom(s, k.id, 'stoneyard');
    const back = normalize(JSON.parse(JSON.stringify(s)), T0);
    expect(back.named[0].room).toBe('stoneyard');
  });
});

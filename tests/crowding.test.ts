// A crowded warren puts newcomers off: arrivals rise with appeal and fall,
// more and more steeply, with the kobolds already living here.
import { describe, expect, it } from 'vitest';
import { ATTRACTION } from '../src/game/data';
import { arrivalSeconds } from '../src/game/economy';
import { newGame } from '../src/game/state';

const T0 = 1_700_000_000_000;

describe('crowding', () => {
  it('slows arrivals as the warren fills: half as fast at 50 kobolds, a fifth at 100', () => {
    const s = newGame(T0);
    s.chief = { name: 'Snik', cunning: 0, voice: 0, nerve: 0, quirk: 'none' } as never;
    s.idle = 0;
    const empty = arrivalSeconds(s);
    s.idle = ATTRACTION.crowdScale;
    expect(arrivalSeconds(s)).toBeCloseTo(empty * 2);
    s.idle = ATTRACTION.crowdScale * 2;
    expect(arrivalSeconds(s)).toBeCloseTo(empty * 5);
  });
});

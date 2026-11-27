// Happenings: small, unlikely, silly things that happen to the warren now and
// then. Kobolds always come out unscathed. Some bring a little copper.

import { KOBOLD_NAMES } from './chief';
import { incomePerSecond, owned } from './economy';
import { addChronicle, type GameState } from './state';

export interface HappeningDef {
  id: string;
  /** {chief} and {kobold} are filled in. */
  text: string;
  /** Copper reward, as this many seconds of current income. 0 for none. */
  rewardSeconds: number;
  minStage?: number;
  maxStage?: number;
  needsWorker?: string;
}

export const HAPPENINGS: HappeningDef[] = [
  { id: 'egg-apology', text: '{chief} tripped over the egg, apologized to it for an hour, and found three coins underneath.', rewardSeconds: 20, maxStage: 0 },
  { id: 'egg-warm', text: 'The egg felt warm today. {chief} told everyone it purred. Nobody believes this.', rewardSeconds: 0, maxStage: 0 },
  { id: 'well', text: '{kobold} fell down a well and climbed out holding a bucket of copper.', rewardSeconds: 60, needsWorker: 'scavenger' },
  { id: 'cave-in', text: 'A small cave-in buried {kobold}. They dug out the other side, straight into a copper seam.', rewardSeconds: 90, needsWorker: 'digger' },
  { id: 'sneeze', text: '{kobold} sneezed so hard a loose stone fell out of the wall, along with a forgotten coin purse.', rewardSeconds: 45, needsWorker: 'scavenger' },
  { id: 'goat', text: 'A lost goat wandered into the warren. It is now an honorary kobold.', rewardSeconds: 0 },
  { id: 'bat', text: 'A bat stole a coin from the hoard. {kobold} stole three back from the bat.', rewardSeconds: 30, needsWorker: 'scavenger' },
  { id: 'singed', text: "The dragon sneezed a tiny flame and singed {kobold}'s tail. {kobold} says it was on purpose.", rewardSeconds: 0, minStage: 1 },
  { id: 'lunch', text: "{kobold} got lost for a whole afternoon and came back with someone else's lunch and a silver spoon.", rewardSeconds: 60, minStage: 1 },
  { id: 'mine-cart', text: '{kobold} tried riding a mine cart. It went well, then very badly, then well again. They found ore at the bottom.', rewardSeconds: 90, needsWorker: 'digger' },
  { id: 'hat', text: '{kobold} found a hat. It is far too big. They are wearing it anyway and refuse to discuss it.', rewardSeconds: 0 },
  { id: 'tip', text: 'An adventurer peeked into the cave, saw the dragon snoring, and quietly left a tip.', rewardSeconds: 120, minStage: 2 },
  { id: 'wrong-sack', text: '{kobold} hauled home the wrong sack. It was full of silver. Nobody is giving it back.', rewardSeconds: 120, needsWorker: 'hauler' },
];

/** Average seconds between happenings while the game is open. */
export const HAPPENING_EVERY_SECONDS = 10 * 60;

export function eligible(state: GameState): HappeningDef[] {
  return HAPPENINGS.filter(
    (h) =>
      (h.minStage === undefined || state.stage >= h.minStage) &&
      (h.maxStage === undefined || state.stage <= h.maxStage) &&
      (!h.needsWorker || owned(state, h.needsWorker) > 0) &&
      (h.text.includes('{kobold}') ? Object.values(state.workers).some((n) => n > 0) : true),
  );
}

let lastId = '';

/**
 * Make one happening occur: add its line to the chronicle and its copper to
 * the hoard. Returns it, or null if nothing fits yet (e.g. no Chief).
 */
export function happen(state: GameState, now: number, rand: () => number): HappeningDef | null {
  if (!state.chief) return null;
  const pool = eligible(state);
  if (pool.length === 0) return null;
  let h = pool[Math.floor(rand() * pool.length) % pool.length];
  // avoid the same happening twice in a row when there's a choice
  if (pool.length > 1 && h.id === lastId) h = pool[(pool.indexOf(h) + 1) % pool.length];
  lastId = h.id;
  const names = KOBOLD_NAMES.filter((n) => n !== state.chief!.name);
  const kobold = names[Math.floor(rand() * names.length) % names.length];
  const gain = h.rewardSeconds * incomePerSecond(state);
  state.copper += gain;
  state.totalEarned += gain;
  let text = h.text.replaceAll('{chief}', state.chief.name).replaceAll('{kobold}', kobold);
  if (gain >= 1) text += ` (+${Math.floor(gain).toLocaleString('en-US')} copper)`;
  addChronicle(state, now, text);
  return h;
}

/** Chance of a happening on one tick of `seconds`. */
export function happeningChance(seconds: number): number {
  return 1 - Math.exp(-seconds / HAPPENING_EVERY_SECONDS);
}

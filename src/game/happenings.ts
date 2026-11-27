// Happenings: small, unlikely, silly things that happen to the warren now and
// then. Kobolds always come out unscathed. Some bring a little copper.

import { KOBOLD_NAMES } from './chief';
import { ODDITIES } from './oddities';
import { incomePerSecond, population, store, workers } from './economy';
import { addChronicle, type GameState } from './state';

export interface HappeningDef {
  id: string;
  /** {chief} and {kobold} are filled in. */
  text: string;
  /** Copper reward, as this many seconds of current income. 0 for none. */
  rewardSeconds: number;
  minStage?: number;
  maxStage?: number;
  needsJob?: string;
  /** Oddity left behind for the shelf. One-off oddities make this happening once-only. */
  oddity?: string;
  /** For stacking oddities: how many arrive, [min, max]. */
  oddityCount?: [number, number];
}

export const HAPPENINGS: HappeningDef[] = [
  { id: 'egg-apology', text: '{chief} tripped over the egg, apologized to it for an hour, and found three coins underneath.', rewardSeconds: 20, maxStage: 0 },
  { id: 'egg-warm', text: 'The egg felt warm today. {chief} told everyone it purred. Nobody believes this.', rewardSeconds: 0, maxStage: 0 },
  { id: 'well', text: '{kobold} fell down a well and climbed out holding a bucket of copper.', rewardSeconds: 60, needsJob: 'scavenger' },
  { id: 'cave-in', text: 'A small cave-in buried {kobold}. They dug out the other side, straight into a copper seam.', rewardSeconds: 90, needsJob: 'quarrier' },
  { id: 'sneeze', text: '{kobold} sneezed so hard a loose stone fell out of the wall, along with a forgotten coin purse.', rewardSeconds: 45, needsJob: 'scavenger' },
  { id: 'goat', text: 'A lost goat wandered into the warren. It is now an honorary kobold: the Kogoat.', rewardSeconds: 0, oddity: 'kogoat' },
  { id: 'lantern', text: '{chief} came back with {n} more broken lanterns and would not explain.', rewardSeconds: 0, oddity: 'lanterns', oddityCount: [2, 25] },
  { id: 'crab-rock', text: '{kobold} found a rock shaped exactly like a crab. It is not a crab. They checked several times.', rewardSeconds: 0, oddity: 'crab-rock' },
  { id: 'tiny-sword', text: '{kobold} pulled a tiny sword out of a stone. Nobody knows who left it there.', rewardSeconds: 0, oddity: 'tiny-sword' },
  { id: 'first-scale', text: 'The dragon shed its first scale in its sleep. {chief} polished it for an hour.', rewardSeconds: 0, minStage: 1, oddity: 'first-scale' },
  { id: 'bat', text: 'A bat stole a coin from the hoard. {kobold} stole three back from the bat.', rewardSeconds: 30, needsJob: 'scavenger' },
  { id: 'singed', text: "The dragon sneezed a tiny flame and singed {kobold}'s tail. {kobold} says it was on purpose.", rewardSeconds: 0, minStage: 1 },
  { id: 'lunch', text: "{kobold} got lost for a whole afternoon and came back with someone else's lunch and a silver spoon.", rewardSeconds: 60, minStage: 1, oddity: 'silver-spoon' },
  { id: 'mine-cart', text: '{kobold} tried riding a mine cart. It went well, then very badly, then well again. They found ore at the bottom.', rewardSeconds: 90, needsJob: 'quarrier' },
  { id: 'hat', text: '{kobold} found a hat. It is far too big. They are wearing it anyway and refuse to discuss it.', rewardSeconds: 0, oddity: 'big-hat' },
  { id: 'tip', text: 'An adventurer peeked into the cave, saw the dragon snoring, and quietly left a tip.', rewardSeconds: 120, minStage: 2 },
  { id: 'toad', text: '{kobold} chopped at a giant mushroom. It was a very surprised toad. They apologized and it moved out of the way.', rewardSeconds: 0, needsJob: 'woodcutter' },
  { id: 'spores', text: '{kobold} sneezed in a cloud of mushroom spores and glowed faintly green for a day. Night shifts were never easier.', rewardSeconds: 30, needsJob: 'woodcutter' },
  { id: 'window', text: '{kobold} dug into the den from the wrong side. The hole is now called a window, and everyone agrees it was the plan.', rewardSeconds: 0, needsJob: 'digger' },
  { id: 'old-coins', text: '{kobold} dug into a forgotten stash of somebody else\'s coins. Finders keepers.', rewardSeconds: 120, needsJob: 'digger' },
  { id: 'wrong-sack', text: '{kobold} hauled home the wrong sack. It was full of silver. Nobody is giving it back.', rewardSeconds: 120, needsJob: 'scavenger' },
];

/** Average seconds between happenings while the game is open. */
export const HAPPENING_EVERY_SECONDS = 10 * 60;

export function eligible(state: GameState): HappeningDef[] {
  return HAPPENINGS.filter(
    (h) =>
      (h.minStage === undefined || state.stage >= h.minStage) &&
      (h.maxStage === undefined || state.stage <= h.maxStage) &&
      (!h.needsJob || workers(state, h.needsJob) > 0) &&
      // a one-off oddity can only be found once
      !(h.oddity && state.oddities[h.oddity] && !ODDITIES.find((o) => o.id === h.oddity)?.stacks) &&
      (h.text.includes('{kobold}') ? population(state) > 0 : true),
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
  const gain = store(state, 'copper', h.rewardSeconds * incomePerSecond(state));
  let found = 0;
  if (h.oddity) {
    const [lo, hi] = h.oddityCount ?? [1, 1];
    found = lo + Math.floor(rand() * (hi - lo + 1));
    const rec = state.oddities[h.oddity];
    if (rec) rec.count += found;
    else state.oddities[h.oddity] = { count: found, firstAt: now };
  }
  let text = h.text.replaceAll('{chief}', state.chief.name).replaceAll('{kobold}', kobold).replaceAll('{n}', String(found));
  if (gain >= 1) text += ` (+${Math.floor(gain).toLocaleString('en-US')} copper)`;
  addChronicle(state, now, text);
  return h;
}

/** Chance of a happening on one tick of `seconds`. */
export function happeningChance(seconds: number): number {
  return 1 - Math.exp(-seconds / HAPPENING_EVERY_SECONDS);
}

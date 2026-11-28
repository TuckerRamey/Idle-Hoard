// Happenings: small, unlikely, silly things that happen to the warren now and
// then. Kobolds always come out unscathed. Some bring a little copper.

import { KOBOLD_NAMES, MAX_PIPS, raiseStat, statName, type StatId } from './chief';
import { ODDITIES } from './oddities';
import { IDLE, JOBS } from './data';
import { incomePerSecond, population, store, workers } from './economy';
import { addHistory, fullName, nameKobold, namedIn, type NamedKobold } from './kobolds';
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
  /** A rare, once-only happening that teaches the Chief something: a pip in this stat. */
  chiefPip?: StatId;
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
  { id: 'rival-band', text: 'A rival band of kobolds crept in to steal the egg. {chief} talked them out of it, and then into staying.', rewardSeconds: 0, chiefPip: 'voice' },
  { id: 'old-trap', text: '{chief} found an old dwarf trap in a side tunnel, worked out how it ticked, and turned it round to guard the hoard.', rewardSeconds: 0, chiefPip: 'cunning' },
  { id: 'big-cave-in', text: 'A big cave-in shook the warren. {chief} held a beam up while everyone scrambled out. Nobody was hurt, but it was close.', rewardSeconds: 0, minStage: 1, chiefPip: 'nerve' },
  { id: 'wrong-sack', text: '{kobold} hauled home the wrong sack. It was full of silver. Nobody is giving it back.', rewardSeconds: 120, needsJob: 'scavenger' },
];

/** Average seconds between happenings while the game is open, with 10 kobolds. More kobolds, more happens. */
export const HAPPENING_EVERY_SECONDS = 10 * 60;
/** Never more often than this, however big the warren. */
export const HAPPENING_MIN_SECONDS = 3 * 60;
/** After an absence: one happening per this many seconds away, up to `HAPPENING_AWAY_MAX`. */
export const HAPPENING_AWAY_SECONDS = 2 * 3600;
export const HAPPENING_AWAY_MAX = 4;

/** Average seconds between happenings for a warren this size. */
export function happeningEvery(state: GameState): number {
  const scale = Math.sqrt(Math.max(1, population(state) / 10));
  return Math.max(HAPPENING_MIN_SECONDS, HAPPENING_EVERY_SECONDS / scale);
}

/** How many happenings to roll after being away this long. */
export function awayHappenings(seconds: number): number {
  if (seconds < 30 * 60) return 0;
  return Math.min(HAPPENING_AWAY_MAX, Math.max(1, Math.floor(seconds / HAPPENING_AWAY_SECONDS)));
}

export function eligible(state: GameState): HappeningDef[] {
  return HAPPENINGS.filter(
    (h) =>
      (h.minStage === undefined || state.stage >= h.minStage) &&
      (h.maxStage === undefined || state.stage <= h.maxStage) &&
      (!h.needsJob || workers(state, h.needsJob) > 0) &&
      // a one-off oddity can only be found once
      !(h.oddity && state.oddities[h.oddity] && !ODDITIES.find((o) => o.id === h.oddity)?.stacks) &&
      (h.text.includes('{kobold}') ? population(state) > 0 : true) &&
      // lessons for the Chief happen once, and not when the stat is already full
      !(h.chiefPip && (state.chiefMarks.events.includes(h.id) || !state.chief || state.chief[h.chiefPip] >= MAX_PIPS)),
  );
}

/**
 * Happenings memorable enough to give a crowd kobold a name: [title, trait].
 * About half the time the kobold involved becomes named; a named kobold who
 * is picked adds it to their story instead.
 */
export const NAMING: Record<string, [string, string]> = {
  well: ['Wellborn', 'Can hold their breath for ages'],
  'cave-in': ['the Unburied', 'Digs out of anything'],
  sneeze: ['Sneezer', 'Sneezes at the worst moments'],
  'crab-rock': ['Crabwise', 'Checks every rock twice'],
  'tiny-sword': ['Swordpuller', 'Carries a sword one kobold tall'],
  bat: ['Batbane', 'Holds grudges against bats'],
  singed: ['the Singed', 'Singed tail'],
  lunch: ['the Lost', 'No sense of direction at all'],
  'mine-cart': ['Cartrider', 'Rides anything with wheels'],
  hat: ['Big-hat', 'Wears a hat far too big'],
  toad: ['Toadfriend', 'Friends with a very large toad'],
  spores: ['the Glowing', 'Glows faintly in the dark'],
  window: ['Windowmaker', 'Thinks every wall needs a window'],
  'old-coins': ['Finderkeeper', 'Always finds the coins'],
  'wrong-sack': ['Wrongsack', 'Never checks the sack'],
};

let lastId = '';

/**
 * Make one happening occur: add its line to the chronicle and its copper to
 * the hoard. Returns it, or null if nothing fits yet (e.g. no Chief).
 */
export function happen(state: GameState, now: number, rand: () => number): HappeningDef | null {
  if (!state.chief) return null;
  // lessons for the Chief are rare: each is in the running about one time in twenty
  const pool = eligible(state).filter((x) => !x.chiefPip || rand() < 0.05);
  if (pool.length === 0) return null;
  let h = pool[Math.floor(rand() * pool.length) % pool.length];
  // avoid the same happening twice in a row when there's a choice
  if (pool.length > 1 && h.id === lastId) h = pool[(pool.indexOf(h) + 1) % pool.length];
  lastId = h.id;
  const names = KOBOLD_NAMES.filter((n) => n !== state.chief!.name);
  let kobold = names[Math.floor(rand() * names.length) % names.length];
  let named: NamedKobold | null = null;
  let newlyNamed = false;
  if (h.text.includes('{kobold}')) {
    const pool = h.needsJob ? namedIn(state, h.needsJob) : state.named;
    const naming = NAMING[h.id];
    if (pool.length && rand() < 0.4) named = pool[Math.floor(rand() * pool.length) % pool.length];
    else if (naming && rand() < 0.5) {
      const jobs = h.needsJob ? [h.needsJob] : [...JOBS.map((j) => j.id).filter((j) => (state.crews[j]?.n ?? 0) > 0), ...(state.idle > 0 ? [IDLE] : [])];
      if (jobs.length) {
        const job = jobs[Math.floor(rand() * jobs.length) % jobs.length];
        named = nameKobold(state, job, naming[0], '', now, rand);
        if (named) {
          named.history = [];
          named.traits.push(naming[1]);
          newlyNamed = true;
        }
      }
    }
    if (named) kobold = named.name;
  }
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
  if (named) addHistory(named, now, text);
  if (newlyNamed && named) text += ` Ever since, they've been ${fullName(named)}.`;
  if (gain >= 1) text += ` (+${Math.floor(gain).toLocaleString('en-US')} copper)`;
  if (h.chiefPip) {
    state.chiefMarks.events.push(h.id);
    if (raiseStat(state.chief, h.chiefPip)) text += ` ${statName(h.chiefPip)} +1.`;
  }
  addChronicle(state, now, text);
  return h;
}

/** Chance of a happening on one tick of `seconds`. */
export function happeningChance(state: GameState, seconds: number): number {
  return 1 - Math.exp(-seconds / happeningEvery(state));
}

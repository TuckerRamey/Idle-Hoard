// Colonies: a named kobold with enough experiences can leave with a few
// kobolds to found a small colony of their own. Colonies run themselves:
// they grow slowly, send tribute to the dragon's hoard, and write their own
// little history. Nothing to manage, and nobody is lost.

import { founder, FOUNDER, type Founder } from './founders';
import { IDLE } from './data';
import { assign, store } from './economy';
import { addHistory, findNamed, fullName, type NamedKobold } from './kobolds';
import type { GameState } from './state';

export interface Colony {
  id: number;
  name: string;
  /** The founder. Their story carries on here. */
  leader: NamedKobold;
  /** Kobolds living there (it grows a little at a time). */
  pop: number;
  /** Epoch ms it was founded. */
  founded: number;
  /** Newest last. */
  history: { t: number; text: string }[];
  /** Seconds until something next happens there. */
  nextEvent: number;
  /** Copper's worth sent to the hoard so far. */
  sent: number;
  /** The founder's traits when they left, which shape how it grows and trades. Older colonies have none. */
  founder?: Founder;
  /** Named pieces of gear the founder took with them: each adds a little to tribute. */
  heirlooms?: number;
}

export const COLONY = {
  /** Experiences a named kobold needs to lead a colony. */
  experiences: 4,
  /** Crowd kobolds who go with them. */
  settlers: 5,
  /** The dragon has to have hatched: colonies pay tribute to it. */
  minStage: 1,
  /** A colony grows by this share of itself each day, up to `maxPop`. */
  growthPerDay: 0.05,
  maxPop: 200,
  /** Copper a second each colonist sends to the hoard. */
  tributeEach: 0.01,
  /** From this stage and this size, some tribute comes as silver. */
  silverStage: 2,
  silverPop: 20,
  /** Something happens there about this often. */
  eventHours: 12,
  historyMax: 20,
};

/** Tribute added for each named piece of gear the founder took along. */
export const HEIRLOOM_TRIBUTE = 0.1;

const PLACES = ['Hollow', 'Burrow', 'Deep', 'Nook', 'Warren', 'Delve', 'Crook', 'Sump'];

function pick<T>(xs: T[], rand: () => number): T {
  return xs[Math.floor(rand() * xs.length) % xs.length];
}

/** Crowd kobolds who could go with a founder: idle ones and everyone on a crew. */
function crowd(state: GameState): number {
  let n = state.idle;
  for (const c of Object.values(state.crews)) n += c.n;
  return n;
}

export function coloniesOpen(state: GameState): boolean {
  return state.stage >= COLONY.minStage;
}

/** Why this kobold can't found a colony yet, or null if they can. */
export function colonyBlocked(state: GameState, k: NamedKobold): string | null {
  if (!coloniesOpen(state)) return 'Colonies send tribute to the dragon, so they come once it hatches.';
  if (k.history.length < COLONY.experiences) return `Needs ${COLONY.experiences} experiences to lead a colony.`;
  if (crowd(state) < COLONY.settlers) return `Needs ${COLONY.settlers} kobolds from the crowd to go with them.`;
  return null;
}

/** Take `n` crowd kobolds: idle ones first, then from the biggest crews. */
function takeSettlers(state: GameState, n: number) {
  for (let i = 0; i < n; i++) {
    if (state.idle < 1) {
      let best: string | null = null;
      for (const [job, c] of Object.entries(state.crews)) if (c.n > 0 && (best === null || c.n > state.crews[best].n)) best = job;
      if (!best || assign(state, best, -1) === 0) return;
    }
    state.idle -= 1;
  }
}

/**
 * A named kobold leaves with a few settlers to found a colony. They're no
 * longer in the warren, but their story carries on. Returns the chronicle line.
 */
export function foundColony(state: GameState, id: number, t: number, rand: () => number): string | null {
  const k = findNamed(state, id);
  if (!k || colonyBlocked(state, k)) return null;
  const f = founder(k);
  const settlers = Math.max(2, COLONY.settlers + f.pull * FOUNDER.settlersPerPull);
  takeSettlers(state, settlers);
  state.named = state.named.filter((x) => x.id !== id);
  k.lieutenant = false;
  k.job = IDLE;
  delete k.artWork;
  const used = new Set(state.colonies.map((c) => c.name));
  let name = `${k.name}'s ${pick(PLACES, rand)}`;
  for (const p of PLACES) if (used.has(name)) name = `${k.name}'s ${p}`;
  const story = `Left the warren with ${settlers} kobolds to found ${name}.`;
  const heirlooms = Object.values(k.gear ?? {}).filter((p) => p?.name).length;
  addHistory(k, t, story);
  state.colonies.push({
    id: state.nextColonyId++,
    name,
    leader: k,
    pop: settlers + 1,
    founded: t,
    history: [{ t, text: `Founded by ${fullName(k)} and ${settlers} kobolds from the warren.` }],
    nextEvent: COLONY.eventHours * 3600 * (0.5 + rand()),
    sent: 0,
    founder: f,
    ...(heirlooms ? { heirlooms } : {}),
  });
  return `${fullName(k)} left with ${settlers} kobolds to found ${name}. They promised to send tribute to the hoard.`;
}

/** Copper's worth a second a colony sends, and how much of it comes as silver. */
export function tributeRate(state: GameState, c: Colony): { copper: number; silver: number } {
  let total = Math.floor(c.pop) * COLONY.tributeEach;
  const f = c.founder;
  if (f) total *= (1 + f.trade * FOUNDER.tributePerTrade) * (f.knack === 'market' ? 4 / 3 : 1);
  total *= 1 + HEIRLOOM_TRIBUTE * (c.heirlooms ?? 0);
  if (state.stage >= COLONY.silverStage && c.pop >= COLONY.silverPop) return { copper: total * 0.8, silver: (total * 0.2) / 10 };
  return { copper: total, silver: 0 };
}

interface ColonyEvent {
  /** {colony} and {leader} are filled in. */
  text: string;
  /** Kobolds who join. */
  pop?: number;
  /** Something sent to the hoard: a lump of copper (seconds of its tribute) or an oddity. */
  gift?: { seconds: number } | { oddity: string };
  /** Goes in the leader's own story too. */
  leader?: boolean;
}

export const COLONY_EVENTS: ColonyEvent[] = [
  { text: '{colony} held a mushroom festival. {leader} gave a speech nobody could hear over the drums.', pop: 1, leader: true },
  { text: '{colony} has started a feud with a giant beetle over a tunnel. The beetle is winning, but politely.' },
  { text: '{colony} dug a new tunnel and found a spring. A few kobolds wandered in for the water and stayed.', pop: 3 },
  { text: 'An adventurer got lost near {colony}. They were given soup and pointed the wrong way, very kindly.' },
  { text: 'Twins were born in {colony}. Both were named after the dragon, which caused some confusion.', pop: 2 },
  { text: '{colony} voted on a flag. It shows the dragon, but smaller, and with a kobold on its head.' },
  { text: '{leader} told the young ones of {colony} about the old warren. The story gets bigger every time.', leader: true },
  { text: '{colony} sent a cart to the hoard, piled with copper and a slightly squashed cake.', gift: { seconds: 6 * 3600 } },
  { text: '{colony} sent the dragon a carved figure of itself. It is on the oddities shelf, looking very serious.', gift: { oddity: 'colony-gifts' } },
  { text: '{leader} settled an argument in {colony} about whose turn it was to feed the crabs. Everyone was wrong.', leader: true },
];

/** Let `dt` seconds pass for the colonies. Returns chronicle lines (only for gifts that reach the hoard). */
export function colonyStep(state: GameState, dt: number, t: number, rand: () => number): string[] {
  const lines: string[] = [];
  for (const c of state.colonies) {
    const f = c.founder;
    const stubborn = f?.knack === 'stubborn';
    const growth = COLONY.growthPerDay * (1 + (f?.green ?? 0) * FOUNDER.growthPerGreen) * (stubborn ? 0.6 : 1);
    c.pop = Math.min(stubborn ? Infinity : COLONY.maxPop, c.pop * (1 + (growth * dt) / 86_400));
    const r = tributeRate(state, c);
    c.sent += store(state, 'copper', r.copper * dt);
    if (f?.knack === 'mining') {
      // a mining colony sends some of its worth as stone and ore
      store(state, 'stone', Math.floor(c.pop) * 0.01 * dt);
      store(state, 'ore', Math.floor(c.pop) * 0.005 * dt);
    }
    if (f?.knack === 'shrine' && state.magic) state.magic.mana = Math.min(200, state.magic.mana + Math.floor(c.pop) * 0.00002 * dt);
    if (r.silver > 0) c.sent += store(state, 'silver', r.silver * dt) * 10;
    c.nextEvent -= dt;
    if (c.nextEvent > 0) continue;
    c.nextEvent = COLONY.eventHours * 3600 * (0.5 + rand());
    const e = pick(COLONY_EVENTS, rand);
    const text = e.text.replaceAll('{colony}', c.name).replaceAll('{leader}', fullName(c.leader));
    c.history.push({ t, text });
    if (c.history.length > COLONY.historyMax) c.history.splice(0, c.history.length - COLONY.historyMax);
    if (e.pop) c.pop = Math.min(COLONY.maxPop, c.pop + e.pop);
    if (e.leader) addHistory(c.leader, t, text.replaceAll(fullName(c.leader), c.leader.name));
    if (e.gift && 'seconds' in e.gift) {
      const kept = store(state, 'copper', tributeRate(state, c).copper * e.gift.seconds);
      c.sent += kept;
      if (kept >= 1) lines.push(`${text} (+${Math.floor(kept).toLocaleString('en-US')} copper)`);
    } else if (e.gift) {
      const rec = state.oddities[e.gift.oddity];
      if (rec) rec.count++;
      else state.oddities[e.gift.oddity] = { count: 1, firstAt: t };
      lines.push(text);
    }
  }
  return lines;
}

// Named kobolds: the stars of the crowd. A crowd kobold gets a name when
// something memorable happens to them (a research explosion, a well, the
// dragon asking for them). From then on they collect experiences, have a job
// they love and one they hate, and can become lieutenants. Nobody is ever lost.

import { KOBOLD_NAMES } from './chief';
import { IDLE, JOBS } from './data';
import { researchEffect, researchEffects } from './research';
import type { GameState } from './state';

export interface NamedKobold {
  id: number;
  name: string;
  /** From the event that named them, e.g. "the Singed". */
  title: string;
  /** A job id, or 'idle'. */
  job: string;
  loves: string;
  hates: string;
  /** Which hat they wear in the cave (a frame of the hat sheet). */
  look: number;
  traits: string[];
  /** Gifts from the dragon. */
  gifts: string[];
  /** Their story, oldest first. Each entry is one experience. */
  history: { t: number; text: string }[];
  lieutenant: boolean;
  /** Seconds of work on their current piece, while an artisan. */
  artWork?: number;
  /** Knacks for a job, found by working it or left by a research mishap. */
  talents?: Talent[];
  /** Earned once they work like nobody else: "digs like a dragon". */
  epithet?: string;
}

export interface Talent {
  job: string;
  /** How much better they are at that job. */
  mult: number;
  /** What it's called on their card: "Tunnel-sense". */
  name: string;
}

/** A named kobold whose bonus at their job reaches this gets an epithet. */
export const EPITHET_MULT = 3;

/** Experiences a named kobold needs before they can be made a lieutenant. */
export const LIEUTENANT_EXPERIENCES = 4;
/** Lieutenant slots: this many, plus one per dragon stage. */
export const LIEUTENANT_BASE_SLOTS = 1;
export const MAX_LIEUTENANTS = 5;
/** A named kobold boosts the crew they join; a lieutenant boosts it more. */
export const NAMED_CREW_BONUS = 0.03;
export const LIEUTENANT_CREW_BONUS = 0.15;
/** How hard a named kobold works at a job they love or hate. */
export const LOVE_MULT = 1.5;
export const HATE_MULT = 0.75;
export const HAT_COUNT = 6;
/** Most history entries kept per kobold. */
export const HISTORY_MAX = 30;

export interface GiftDef {
  id: string;
  name: string;
  /** How much harder they work at any job. */
  mult: number;
}

/** Gifts the dragon gives at an audience. */
export const GIFTS: GiftDef[] = [
  { id: 'fireproof-scales', name: 'fire-proof scales', mult: 1.3 },
  { id: 'blessed-pick', name: 'a dragon-blessed pick', mult: 1.5 },
  { id: 'lucky-tooth', name: 'a lucky dragon tooth', mult: 1.25 },
  { id: 'smoke-ring', name: 'a smoke ring that never fades', mult: 1.2 },
  { id: 'old-scale', name: 'one of its old scales, to wear as a shield', mult: 1.35 },
];

export function giftDef(id: string) {
  return GIFTS.find((g) => g.id === id);
}

export function findNamed(state: GameState, id: number): NamedKobold | undefined {
  return state.named.find((k) => k.id === id);
}

export function namedIn(state: GameState, job: string): NamedKobold[] {
  return state.named.filter((k) => k.job === job);
}

/** How hard this kobold works, before the job's own multipliers. */
export function personalMult(k: NamedKobold): number {
  let m = k.job === k.loves ? LOVE_MULT : k.job === k.hates ? HATE_MULT : 1;
  for (const g of k.gifts) m *= giftDef(g)?.mult ?? 1;
  for (const t of k.talents ?? []) if (t.job === k.job) m *= t.mult;
  return m;
}

/** Give a kobold a talent, unless they already have one by that name. */
export function addTalent(k: NamedKobold, talent: Talent): boolean {
  k.talents ??= [];
  if (k.talents.some((t) => t.name === talent.name)) return false;
  k.talents.push(talent);
  return true;
}

/** Take one crowd digger off whichever room has the most, when one leaves the crew. */
export function takeDigger(state: GameState) {
  let best: string | null = null;
  for (const [room, n] of Object.entries(state.dig)) if (n > 0 && (best === null || n > state.dig[best])) best = room;
  if (best) state.dig[best] -= 1;
}

/** How much the named kobolds in a job lift its crew. */
export function crewLift(state: GameState, job: string): number {
  let b = 0;
  const named = researchEffect(state, 'namedLift')?.bonus ?? NAMED_CREW_BONUS;
  for (const k of namedIn(state, job)) b += k.lieutenant ? LIEUTENANT_CREW_BONUS : named;
  return 1 + b;
}

export function lieutenantSlots(state: GameState): number {
  let extra = 0;
  for (const e of researchEffects(state)) if (e.kind === 'lieutenantSlots') extra += e.add;
  return Math.min(MAX_LIEUTENANTS, LIEUTENANT_BASE_SLOTS + state.stage) + extra;
}

export function lieutenants(state: GameState): NamedKobold[] {
  return state.named.filter((k) => k.lieutenant);
}

export function canPromote(state: GameState, k: NamedKobold): boolean {
  return !k.lieutenant && k.history.length >= LIEUTENANT_EXPERIENCES && lieutenants(state).length < lieutenantSlots(state);
}

export function makeLieutenant(state: GameState, id: number, t: number): boolean {
  const k = findNamed(state, id);
  if (!k || !canPromote(state, k)) return false;
  k.lieutenant = true;
  addHistory(k, t, `Made a lieutenant by ${state.chief?.name ?? 'the Chief'}.`);
  return true;
}

/** Step down from lieutenant. They keep everything else. */
export function standDown(state: GameState, id: number, t: number): boolean {
  const k = findNamed(state, id);
  if (!k || !k.lieutenant) return false;
  k.lieutenant = false;
  addHistory(k, t, 'Stepped down as lieutenant, and seemed relieved.');
  return true;
}

export function addHistory(k: NamedKobold, t: number, text: string) {
  k.history.push({ t, text });
  if (k.history.length > HISTORY_MAX) k.history.splice(0, k.history.length - HISTORY_MAX);
}

/** Move a named kobold to a job (or idle). Unknown jobs are refused. */
export function moveNamed(state: GameState, id: number, job: string): boolean {
  const k = findNamed(state, id);
  if (!k || (job !== IDLE && !JOBS.some((j) => j.id === job))) return false;
  k.job = job;
  return true;
}

function pick<T>(xs: T[], rand: () => number): T {
  return xs[Math.floor(rand() * xs.length) % xs.length];
}

/** A name nobody in the warren is using yet, if there is one. */
function freshName(state: GameState, rand: () => number): string {
  const used = new Set([state.chief?.name, ...state.named.map((k) => k.name)]);
  const free = KOBOLD_NAMES.filter((n) => !used.has(n));
  if (free.length) return pick(free, rand);
  // all taken: add a number, kobold style
  return `${pick(KOBOLD_NAMES, rand)} ${state.named.length + 1}`;
}

/**
 * A crowd kobold from `job` (or idle) gets a name. They leave the crew count
 * and become an individual in the same job. Returns null if nobody is there.
 */
export function nameKobold(
  state: GameState,
  job: string,
  title: string,
  firstStory: string,
  t: number,
  rand: () => number,
): NamedKobold | null {
  if (job === IDLE) {
    if (state.idle < 1) return null;
    state.idle -= 1;
  } else {
    const c = state.crews[job];
    if (!c || c.n < 1) return null;
    c.n -= 1;
    if (job === 'digger') takeDigger(state);
  }
  const jobs = JOBS.map((j) => j.id);
  const loves = job !== IDLE && rand() < 0.5 ? job : pick(jobs, rand);
  const hates = pick(jobs.filter((j) => j !== loves), rand);
  const k: NamedKobold = {
    id: state.nextNamedId++,
    name: freshName(state, rand),
    title,
    job,
    loves,
    hates,
    look: Math.floor(rand() * HAT_COUNT) % HAT_COUNT,
    traits: [],
    gifts: [],
    history: [],
    lieutenant: false,
  };
  addHistory(k, t, firstStory);
  state.named.push(k);
  return k;
}

export function fullName(k: NamedKobold): string {
  return k.title ? `${k.name} ${k.title}` : k.name;
}

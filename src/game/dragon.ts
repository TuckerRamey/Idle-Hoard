// The dragon after hatching: what it eats and craves, what it asks for, who it
// wants to talk to, and how it molts into its next stage. Growth comes from
// how the warren looks after it, not from a number filling up.

import { DRAGON_STAGES, type ResourceId } from './data';
import { capacity, production, resourceOpen, roomExtent, workers } from './economy';
import { fullName, GIFTS, lieutenants, nameKobold, findNamed, addHistory, type NamedKobold } from './kobolds';
import { opened } from './research';
import type { GameState } from './state';
import { JOBS, UPGRADES } from './data';

// ---------- diet ----------

export interface AnimalDef {
  id: string;
  name: string;
  /** Research that lets the pasture raise it. */
  requires: string;
  /** Said a day before the dragon starts craving it. */
  hint: string;
}

export const ANIMALS: AnimalDef[] = [
  { id: 'crab', name: 'Crabs', requires: 'crab-wrangling', hint: 'The dragon keeps sniffing toward the crab pools.' },
  { id: 'goat', name: 'Goats', requires: 'goat-herding', hint: 'The dragon keeps staring at the goats. The Kogoat has gone into hiding.' },
  { id: 'beetle', name: 'Giant beetles', requires: 'beetle-ranching', hint: 'The dragon keeps licking its lips at the beetle pens.' },
];

export const DIET = {
  /** Meat eaten per second, by stage (egg, wyrmling, young, adult). */
  eatsByStage: [0, 0.05, 0.15, 0.4],
  /** Everything made, while fed / while fed what it craves. */
  fedMult: 1.1,
  delightedMult: 1.25,
  /** Cravings change this often, with a hint this long before. */
  cravingSeconds: 2 * 86_400,
  hintSeconds: 86_400,
  /** Switching the herd halves herders' output for this long while the new animals settle. */
  herdSettleSeconds: 1_800,
};

export type Mood = 'egg' | 'hungry' | 'fed' | 'delighted';

export function animalsOpen(state: GameState): AnimalDef[] {
  return ANIMALS.filter((a) => opened(state, a.requires));
}

export function animalName(id: string): string {
  return ANIMALS.find((a) => a.id === id)?.name.toLowerCase() ?? id;
}

/** How the dragon feels right now: hungry with no meat, fed, or delighted when the herd is what it craves. */
export function mood(state: GameState): Mood {
  if (state.stage === 0) return 'egg';
  if (state.res.meat <= 0) return 'hungry';
  return state.herd === state.dragon.craving && workers(state, 'herder') > 0 ? 'delighted' : 'fed';
}

export function moodMult(state: GameState): number {
  const m = mood(state);
  return m === 'delighted' ? DIET.delightedMult : m === 'fed' ? DIET.fedMult : 1;
}

export function eatRate(state: GameState): number {
  return DIET.eatsByStage[Math.min(state.stage, DIET.eatsByStage.length - 1)] ?? 0;
}

export function setHerd(state: GameState, animal: string): boolean {
  if (!animalsOpen(state).some((a) => a.id === animal) || state.herd === animal) return false;
  state.herd = animal;
  state.herdSettle = DIET.herdSettleSeconds;
  return true;
}

// ---------- requests and audiences ----------

export type DragonRequest =
  | { kind: 'give'; resource: ResourceId; amount: number; text: string; until: number }
  | { kind: 'audience'; namedId: number | null; job: string; name: string; until: number };

export interface RequestDef {
  resource: ResourceId;
  /** Asks for about this many seconds of what the warren makes. */
  seconds: number;
  min: number;
  text: string;
}

export const REQUESTS: RequestDef[] = [
  { resource: 'copper', seconds: 1_800, min: 200, text: 'The dragon wants more shiny things. It keeps pushing coins around and sighing.' },
  { resource: 'wood', seconds: 1_800, min: 50, text: 'The dragon wants something to scratch its back on.' },
  { resource: 'stone', seconds: 1_800, min: 50, text: 'The dragon wants a nice flat stone to sleep on.' },
  { resource: 'iron', seconds: 2_400, min: 10, text: 'The dragon wants something to chew. Something metal.' },
  { resource: 'meat', seconds: 1_200, min: 10, text: 'The dragon wants something crunchy, right now, please.' },
];

export const REQUEST = {
  /** A request or audience comes about this often after hatching... */
  everySeconds: 3 * 3_600,
  /** ...and fades if nobody answers within this long. Nothing bad happens. */
  lastsSeconds: 8 * 3_600,
  /** Chance a request is an audience with a kobold. */
  audienceChance: 0.35,
  /** Appeal per request granted (a pleased dragon is a draw). */
  favorAppeal: 1,
};

function pick<T>(xs: T[], rand: () => number): T {
  return xs[Math.floor(rand() * xs.length) % xs.length];
}

function makeRequest(state: GameState, rand: () => number): DragonRequest | null {
  const until = state.dragon.clock + REQUEST.lastsSeconds;
  if (rand() < REQUEST.audienceChance) {
    // someone named, or someone from the crowd who'll get a name
    if (state.named.length && rand() < 0.5) {
      const k = pick(state.named, rand);
      return { kind: 'audience', namedId: k.id, job: k.job, name: fullName(k), until };
    }
    const jobs = JOBS.filter((j) => workers(state, j.id) > 0);
    if (jobs.length) {
      const job = pick(jobs, rand).id;
      return { kind: 'audience', namedId: null, job, name: `one of the ${JOBS.find((j) => j.id === job)!.name.toLowerCase()}s`, until };
    }
  }
  const options = REQUESTS.filter((r) => resourceOpen(state, r.resource));
  if (!options.length) return null;
  const def = pick(options, rand);
  const p = production(state)[def.resource];
  const amount = Math.ceil(Math.min(capacity(state, def.resource) * 0.5, Math.max(def.min, p * def.seconds)));
  return { kind: 'give', resource: def.resource, amount, text: def.text, until };
}

/** Grant the current request. Returns the chronicle line, or null if it can't be done. */
export function grantRequest(state: GameState, t: number, rand: () => number): string | null {
  const r = state.dragon.request;
  if (!r) return null;
  if (r.kind === 'give') {
    if (state.res[r.resource] < r.amount) return null;
    state.res[r.resource] -= r.amount;
    state.dragon.request = null;
    state.dragon.granted++;
    state.dragon.favor++;
    return 'The dragon got what it wanted and purred so loudly the coins rattled.';
  }
  let k: NamedKobold | null | undefined = r.namedId !== null ? findNamed(state, r.namedId) : null;
  if (!k) {
    k = nameKobold(state, r.job, 'Dragon-touched', 'Summoned by the dragon, and lived to tell of it.', t, rand);
    if (!k) k = nameKobold(state, 'idle', 'Dragon-touched', 'Summoned by the dragon, and lived to tell of it.', t, rand);
  }
  if (!k) return null;
  const gift = pick(GIFTS, rand);
  k.gifts.push(gift.id);
  addHistory(k, t, `Spoke with the dragon and came back with ${gift.name}.`);
  state.dragon.request = null;
  state.dragon.granted++;
  state.dragon.favor++;
  return `${fullName(k)} went to speak with the dragon and came back with ${gift.name}, looking very pleased with themselves.`;
}

export function dismissRequest(state: GameState): string | null {
  if (!state.dragon.request) return null;
  state.dragon.request = null;
  return 'The dragon sulked for a minute, then forgot all about it.';
}

// ---------- molting ----------

export interface MoltDef {
  /** The stage this molt leaves. */
  from: number;
  lair: number;
  displays: number;
  granted: number;
  contentHours: number;
  lieutenants: number;
}

export const MOLTS: MoltDef[] = [
  { from: 1, lair: 3, displays: 2, granted: 2, contentHours: 12, lieutenants: 0 },
  { from: 2, lair: 6, displays: 4, granted: 4, contentHours: 24, lieutenants: 1 },
];

/** A trait the dragon gets at a molt, from what it ate most. */
export const DRAGON_TRAITS: Record<string, { name: string; text: string; appeal?: number; job?: string; mult?: number }> = {
  crab: { name: 'Shell-scaled', text: 'Crab-fed: hard, shiny scales that catch the light. Appeal +10.', appeal: 10 },
  goat: { name: 'Goat-stubborn', text: 'Goat-fed: stubborn and strong, and it helps with the digging. Diggers +20%.', job: 'digger', mult: 1.2 },
  beetle: { name: 'Beetle-bright', text: 'Beetle-fed: glossy and clever. Researchers +20%.', job: 'researcher', mult: 1.2 },
  jerky: { name: 'Jerky-chewer', text: 'Raised on alchemist jerky: patient and chewy. Appeal +5.', appeal: 5 },
};

export function displaysOwned(state: GameState): number {
  return UPGRADES.filter((u) => u.effect.kind === 'appeal' && state.upgrades.includes(u.id)).length;
}

export interface MoltNeed {
  label: string;
  have: number;
  need: number;
  met: boolean;
}

export function moltNeeds(state: GameState): MoltNeed[] | null {
  const m = MOLTS.find((x) => x.from === state.stage);
  if (!m) return null;
  const lair = roomExtent(state, 'lair');
  const needs: MoltNeed[] = [
    { label: `Lair dug to size ${m.lair}`, have: Math.floor(lair * 10) / 10, need: m.lair, met: lair >= m.lair },
    { label: `${m.displays} displays in the hoard room`, have: displaysOwned(state), need: m.displays, met: displaysOwned(state) >= m.displays },
    { label: `${m.granted} of its requests granted`, have: state.dragon.granted, need: m.granted, met: state.dragon.granted >= m.granted },
    {
      label: `Fed and content for ${m.contentHours} hours`,
      have: Math.floor((state.dragon.content / 3600) * 10) / 10,
      need: m.contentHours,
      met: state.dragon.content >= m.contentHours * 3600,
    },
  ];
  if (m.lieutenants)
    needs.push({ label: `${m.lieutenants} lieutenant to keep it company`, have: lieutenants(state).length, need: m.lieutenants, met: lieutenants(state).length >= m.lieutenants });
  return needs;
}

function topFood(state: GameState): string {
  let best = 'crab';
  let n = -1;
  for (const [k, v] of Object.entries(state.dragon.fed)) if (v > n) [best, n] = [k, v];
  return best;
}

function molt(state: GameState, t: number): string[] {
  state.stage++;
  state.dragon.granted = 0;
  state.dragon.content = 0;
  const trait = topFood(state);
  if (DRAGON_TRAITS[trait] && !state.dragon.traits.includes(trait)) state.dragon.traits.push(trait);
  state.dragon.fed = {};
  const rec = state.oddities['shed-skins'];
  if (rec) rec.count++;
  else state.oddities['shed-skins'] = { count: 1, firstAt: t };
  const tr = DRAGON_TRAITS[trait];
  return [
    `The dragon molted! ${DRAGON_STAGES[state.stage].flavor}`,
    `Its old skin is on the oddities shelf. ${tr ? `It came out ${tr.name.toLowerCase()}: ${tr.text}` : ''}`.trim(),
  ];
}

// ---------- time passing ----------

/** Rolls a fresh craving among the animals the pasture can raise. */
function nextCraving(state: GameState, rand: () => number): string {
  const open = animalsOpen(state);
  if (!open.length) return 'crab';
  const others = open.filter((a) => a.id !== state.dragon.craving);
  return pick(others.length ? others : open, rand).id;
}

/**
 * Let `dt` seconds pass for the dragon: eating, cravings, requests and
 * molting. Returns chronicle lines.
 */
export function dragonStep(state: GameState, dt: number, t: number, rand: () => number): string[] {
  const lines: string[] = [];
  const d = state.dragon;
  if (state.herdSettle > 0) state.herdSettle = Math.max(0, state.herdSettle - dt);
  if (state.stage === 0) return lines;
  d.clock += dt;

  // eating
  const want = eatRate(state) * dt;
  const ate = Math.min(want, state.res.meat);
  const wasHungry = d.hungry;
  if (want > 0) {
    state.res.meat -= ate;
    const food = workers(state, 'herder') > 0 ? state.herd : 'jerky';
    d.fed[food] = (d.fed[food] ?? 0) + ate;
    d.hungry = ate < want * 0.999;
    if (!d.hungry) d.content += dt;
    else if (ate > 0) d.content += dt * (ate / want);
  }
  if (d.hungry && !wasHungry && opened(state, 'crab-wrangling')) lines.push('The dragon is hungry and has stopped growing. More herders would help.');
  if (!d.hungry && wasHungry && d.content > 0) lines.push('The dragon has eaten its fill and settled down happily.');

  // cravings: a day's hint, then the change
  if (animalsOpen(state).length > 1) {
    if (!d.warned && d.clock >= d.changeAt - DIET.hintSeconds) {
      d.next = nextCraving(state, rand);
      d.warned = true;
      const hint = ANIMALS.find((a) => a.id === d.next)?.hint;
      if (hint && d.next !== d.craving) lines.push(`${hint} (It will crave ${animalName(d.next)} in about a day.)`);
    }
    if (d.clock >= d.changeAt) {
      if (d.next !== d.craving) lines.push(`The dragon now craves ${animalName(d.next)}.`);
      d.craving = d.next;
      d.changeAt = d.clock + DIET.cravingSeconds;
      d.warned = false;
    }
  } else d.changeAt = Math.max(d.changeAt, d.clock + DIET.hintSeconds);

  // requests come and go
  if (d.request && d.clock >= d.request.until) {
    d.request = null;
    lines.push('The dragon forgot what it wanted and went back to sleep.');
  }
  if (!d.request && d.clock >= d.nextRequestAt) {
    d.nextRequestAt = d.clock + REQUEST.everySeconds * (0.6 + rand() * 0.8);
    const r = makeRequest(state, rand);
    if (r) {
      d.request = r;
      lines.push(r.kind === 'give' ? r.text : `The dragon wants to speak with ${r.name}.`);
    }
  }

  // molting
  const needs = moltNeeds(state);
  if (needs && needs.every((n) => n.met)) lines.push(...molt(state, t));
  return lines;
}

/** Extra appeal from the dragon's favor and traits. */
export function dragonAppeal(state: GameState): number {
  let a = state.dragon.favor * REQUEST.favorAppeal;
  for (const tr of state.dragon.traits) a += DRAGON_TRAITS[tr]?.appeal ?? 0;
  return a;
}

export function dragonJobMult(state: GameState, job: string): number {
  let m = 1;
  for (const tr of state.dragon.traits) if (DRAGON_TRAITS[tr]?.job === job) m *= DRAGON_TRAITS[tr].mult ?? 1;
  return m;
}

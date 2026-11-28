// The economy: what the warren makes and uses, what the rooms hold, digging,
// crews, research and kobolds arriving. Pure functions over GameState; no DOM.

import { PIP_ODDITIES, quirkOf, raiseStat } from './chief';
import { artStep } from './art';
import {
  ATTRACTION,
  CONFIG,
  DIG,
  DRAGON_STAGES,
  HOARD_SIZE_THRESHOLDS,
  IDLE,
  JOBS,
  RECIPES,
  RESOURCES,
  ROOMS,
  type JobDef,
  type RecipeDef,
  type ResourceId,
  type RoomDef,
} from './data';
import { dragonAppeal, dragonJobMult, dragonStep, eatRate, moodMult } from './dragon';
import { forgeMakes, forgeStep, forgeUse, toolMults } from './forge';
import { addHistory, addTalent, crewLift, fullName, nameOrCredit, namedIn, personalMult, takeDigger } from './kobolds';
import { digFinds, epithetStep, talentStep } from './events';
import { colonyStep } from './colonies';
import { ODDITIES } from './oddities';
import { addResearch, MISHAPS, MISHAP_HOURS, opened, researchDef, researchEffect, researchEffects, researchMult, researchShortOf } from './research';
import { rng, type Crew, type GameState } from './state';

export const jobDef = (id: string) => JOBS.find((j) => j.id === id);
export const roomDef = (id: string) => ROOMS.find((r) => r.id === id);
export const resourceDef = (id: ResourceId) => RESOURCES.find((r) => r.id === id)!;
export const recipeDef = (id: string) => RECIPES.find((r) => r.id === id);

export const emptyRes = () => ({ copper: 0, silver: 0, gold: 0, wood: 0, stone: 0, ore: 0, bars: 0, steel: 0, meat: 0 }) as Record<ResourceId, number>;

// ---------- what's open ----------

export function jobOpen(state: GameState, def: JobDef): boolean {
  return opened(state, def.requires);
}

export function resourceOpen(state: GameState, res: ResourceId): boolean {
  const def = resourceDef(res);
  return opened(state, def.requires) && state.stage >= (def.minStage ?? 0);
}

export function roomOpen(state: GameState, def: RoomDef): boolean {
  return opened(state, def.requires) && state.stage >= (def.minStage ?? 0);
}

export function recipesOpen(state: GameState) {
  return RECIPES.filter((r) => resourceOpen(state, r.from) && resourceOpen(state, r.to));
}

// ---------- crews ----------

export function crew(state: GameState, jobId: string): Crew {
  return state.crews[jobId] ?? { n: 0 };
}

/** Everyone working a job: the crowd crew plus named kobolds. */
export function workers(state: GameState, jobId: string): number {
  return crew(state, jobId).n + namedIn(state, jobId).length;
}

/** Every kobold in the warren, working, idle or named (not counting the Chief). */
export function population(state: GameState): number {
  let n = state.idle + state.named.length;
  for (const c of Object.values(state.crews)) n += c.n;
  return n;
}

/**
 * Move crowd kobolds between the idle pool and a job. A positive `k` takes
 * them from idle, a negative one sends them back. Moving kobolds costs
 * nothing: a crew works as well the moment it's put together. Returns how many actually moved.
 */
export function assign(state: GameState, jobId: string, k: number): number {
  // diggers are put on a room with assignDig; taking them off here takes them from the busiest rooms
  if (jobId === 'digger') {
    if (k > 0) return 0;
    const m = moveCrew(state, jobId, k);
    for (let i = 0; i < -m; i++) takeDigger(state);
    return m;
  }
  return moveCrew(state, jobId, k);
}

/** Put idle kobolds to digging a room (k > 0), or send some of its diggers back to idle (k < 0). */
export function assignDig(state: GameState, roomId: string, k: number): number {
  const def = roomDef(roomId);
  if (!def || !Number.isFinite(k) || k === 0) return 0;
  if (k > 0) {
    if (!roomOpen(state, def)) return 0;
    const m = moveCrew(state, 'digger', k);
    state.dig[roomId] = (state.dig[roomId] ?? 0) + m;
    return m;
  }
  const m = moveCrew(state, 'digger', -Math.min(Math.floor(-k), state.dig[roomId] ?? 0));
  state.dig[roomId] = (state.dig[roomId] ?? 0) + m;
  return m;
}

function moveCrew(state: GameState, jobId: string, k: number): number {
  const def = jobDef(jobId);
  if (!def || !Number.isFinite(k) || k === 0) return 0;
  const c = { ...crew(state, jobId) };
  if (k > 0) {
    if (!jobOpen(state, def)) return 0;
    const m = Math.min(Math.floor(k), state.idle);
    if (m <= 0) return 0;
    c.n += m;
    state.idle -= m;
    state.crews[jobId] = c;
    return m;
  }
  const m = Math.min(Math.floor(-k), c.n);
  if (m <= 0) return 0;
  c.n -= m;
  state.idle += m;
  state.crews[jobId] = c;
  return -m;
}

// ---------- multipliers ----------

export function jobMultiplier(state: GameState, jobId: string): number {
  let m = 1;
  // a cunning Chief keeps the researchers on the right track
  if (jobId === 'researcher' && state.chief) m *= 1 + 0.1 * state.chief.cunning;
  m *= researchMult(state, 'jobMult', (e) => e.job === jobId);
  const q = quirkOf(state.chief);
  if (q?.effect.kind === 'jobMult' && q.effect.job === jobId) m *= q.effect.mult;
  return m * dragonJobMult(state, jobId);
}

export function globalMultiplier(state: GameState): number {
  let m = DRAGON_STAGES[state.stage]?.incomeMult ?? 1;
  m *= researchMult(state, 'globalMult');
  if (state.chief) m *= 1 + 0.05 * state.chief.nerve;
  for (const o of ODDITIES) if (o.incomeMult && state.oddities[o.id]) m *= o.incomeMult;
  return m * moodMult(state);
}

function baseRate(def: JobDef): number {
  return def.produces?.rate ?? def.digs ?? def.researches ?? def.converts ?? def.smiths ?? 0;
}

/** What one crowd kobold in this job makes (or digs, researches, converts) per second. */
export function perKobold(state: GameState, def: JobDef): number {
  return baseRate(def) * jobMultiplier(state, def.id) * globalMultiplier(state) * crewLift(state, def.id);
}

/** Herders beyond what the pasture fits do nothing; a new herd works at half pace. */
function herdFactor(state: GameState): number {
  const n = workers(state, 'herder');
  if (n === 0) return 1;
  let f = Math.min(1, herdersFit(state) / n);
  if (state.herdSettle > 0) f *= 0.5;
  return f;
}

/** What everyone in a job makes (or digs, researches, converts) per second. */
export function jobOutput(state: GameState, def: JobDef): number {
  if (!jobOpen(state, def)) return 0;
  const each = baseRate(def) * jobMultiplier(state, def.id) * globalMultiplier(state);
  const tools = toolMults(state, def.id);
  let total = crew(state, def.id).n * each * crewLift(state, def.id) * tools.crew;
  namedIn(state, def.id).forEach((k, i) => (total += each * personalMult(k) * (tools.named[i] ?? 1)));
  if (def.id === 'herder') total *= herdFactor(state);
  return total;
}

/** Copper per second the Chief brings in personally. */
export function chiefRate(state: GameState): number {
  return state.chief ? CONFIG.chiefRate * globalMultiplier(state) : 0;
}

/** Everything made per second by jobs and the Chief, before storage limits. Not counting alchemy. */
export function production(state: GameState): Record<ResourceId, number> {
  const p = emptyRes();
  p.copper = chiefRate(state);
  for (const def of JOBS) if (def.produces && resourceOpen(state, def.produces.resource)) p[def.produces.resource] += jobOutput(state, def);
  return p;
}

/** Copper per second (the headline number). */
export function incomePerSecond(state: GameState): number {
  return production(state).copper;
}

export function researchRate(state: GameState): number {
  const def = jobDef('researcher');
  return def ? jobOutput(state, def) : 0;
}

/** Alchemy input per second at full pace. */
export function alchemyRate(state: GameState): number {
  const def = jobDef('alchemist');
  return def && recipeDef(state.recipe) ? jobOutput(state, def) : 0;
}

/** Crowd diggers on a room. */
export function diggersIn(state: GameState, roomId: string): number {
  return state.dig[roomId] ?? 0;
}

/** Is the hoard room full while copper is still coming in? Then the scavengers dig it bigger. */
export function hoardFull(state: GameState): boolean {
  const income = production(state).copper;
  // "full" means less room left than a few seconds of copper (the dragon nibbling at it doesn't count)
  return state.res.copper > 0 && income > 0 && capacity(state, 'copper') - state.res.copper < Math.max(1, income * 10);
}

/** Dig work per second the scavengers put into a full hoard room. */
export function scavengerDig(state: GameState): number {
  const dig = jobDef('digger');
  if (!dig?.digs || !hoardFull(state) || digBlocked(state, 'hoard') === 'full') return 0;
  return workers(state, 'scavenger') * dig.digs * globalMultiplier(state);
}

/** Dig work per second going into each room: its diggers' share of the crew, plus scavengers in a full hoard. */
export function digRates(state: GameState): Record<string, number> {
  const out: Record<string, number> = {};
  const def = jobDef('digger');
  let crowd = 0;
  for (const [room, n] of Object.entries(state.dig)) if (n > 0 && roomDef(room)) crowd += n;
  const total = def && crowd > 0 ? jobOutput(state, def) : 0;
  if (total > 0) for (const [room, n] of Object.entries(state.dig)) if (n > 0 && roomDef(room)) out[room] = (total * n) / crowd;
  const sc = scavengerDig(state);
  if (sc > 0) out.hoard = (out.hoard ?? 0) + sc;
  return out;
}

export function digRate(state: GameState, roomId: string): number {
  return digRates(state)[roomId] ?? 0;
}

export function offlineCap(_state: GameState): number {
  return CONFIG.offlineCapSeconds;
}

// ---------- rooms ----------

function storageMult(state: GameState): number {
  const q = quirkOf(state.chief);
  return q?.effect.kind === 'storageMult' ? q.effect.mult : 1;
}

/** A room's volume in cubic paces. Rooms grow with every bit of digging. */
export function roomVolume(state: GameState, roomId: string): number {
  return state.rooms[roomId]?.volume ?? roomDef(roomId)?.start ?? 0;
}

/** What a room holds: cubic paces of goods, or beds, herders or smiths. */
export function roomCapacity(state: GameState, def: RoomDef, volume = roomVolume(state, def.id)): number {
  if (def.holds === 'goods') return volume;
  let m = 1;
  if (def.holds === 'beds') m *= storageMult(state) * researchMult(state, 'bedsMult');
  return Math.floor((volume / (def.pacesEach ?? 1)) * m + 1e-9);
}

/** The open goods a store holds; they share its space evenly. */
export function storeGoods(state: GameState, roomId: string) {
  return RESOURCES.filter((r) => r.store === roomId && resourceOpen(state, r.id));
}

/** How much of a resource can be held. */
export function capacity(state: GameState, res: ResourceId): number {
  if (!resourceOpen(state, res)) return 0;
  const def = resourceDef(res);
  const room = roomDef(def.store);
  if (!room) return 0;
  const mult = storageMult(state) * researchMult(state, 'storeMult', (e) => e.resource === res);
  if (room.id === 'hoard') {
    // one shared pile: what's held, plus however much more fits in the space left
    let used = 0;
    for (const g of storeGoods(state, 'hoard')) used += state.res[g.id] / g.perPace;
    // the dragon sleeps on the pile and takes up room as it grows
    const free = Math.max(0, roomVolume(state, 'hoard') * mult - state.dragon.size - used);
    return Math.floor(state.res[res] + free * def.perPace + 1e-9);
  }
  const share = roomVolume(state, room.id) / Math.max(1, storeGoods(state, room.id).length);
  return Math.floor(share * def.perPace * mult);
}

export function beds(state: GameState): number {
  return roomCapacity(state, roomDef('den')!);
}

export function herdersFit(state: GameState): number {
  const def = roomDef('pasture');
  return def && roomOpen(state, def) ? roomCapacity(state, def) : 0;
}

/** Supports used per cubic pace dug in a room of this volume. */
export function supportsFor(volume: number, state?: GameState) {
  const m = state ? researchMult(state, 'supportsMult') : 1;
  return DIG.supports.filter((s) => volume >= s.fromPaces).map((s) => ({ ...s, perPace: s.perPace * m }));
}

/** What each cubic pace dug turns up in a room this big (only goods the warren knows). */
export function digYields(volume: number, state: GameState): Partial<Record<ResourceId, number>> {
  let step: (typeof DIG.yields)[number] | undefined;
  for (const y of DIG.yields) if (volume >= y.fromPaces) step = y;
  const out: Partial<Record<ResourceId, number>> = {};
  if (!step) return out;
  for (const [res, n] of Object.entries(step.give)) if (resourceOpen(state, res as ResourceId)) out[res as ResourceId] = n;
  return out;
}

/** The biggest a room can be dug. */
export function maxVolume(state: GameState): number {
  return researchEffects(state).some((e) => e.kind === 'deepDigging') ? Infinity : DIG.maxPaces;
}

/** An alchemy recipe's ratio after research: how many in for one out. */
export function recipeRatio(state: GameState, recipe: RecipeDef): number {
  let ratio = recipe.ratio;
  for (const e of researchEffects(state)) if (e.kind === 'recipeRatio' && e.recipe === recipe.id) ratio = Math.min(ratio, e.ratio);
  return Math.max(1, ratio * researchMult(state, 'alchemyMult'));
}

/** Why a room can't be dug further: a support that's run out, 'full' at the size limit, or null. */
export function digBlocked(state: GameState, roomId: string): ResourceId | 'full' | null {
  const v = roomVolume(state, roomId);
  if (v >= maxVolume(state) - 1e-9) return 'full';
  for (const s of supportsFor(v, state)) if (state.res[s.resource] < s.perPace * 0.01) return s.resource;
  return null;
}

/** Dig work for one more cubic pace of a room this big: the bigger the room, the slower it grows. */
export function workPerPace(volume: number): number {
  return DIG.workPerPace * (1 + volume / DIG.growPaces);
}

/** Round volumes worth a line in the chronicle. */
export function volumeMilestone(v: number): number {
  const steps = [1, 1.5, 2, 2.5, 4, 5, 6, 8];
  let base = 100;
  for (;;) {
    for (const x of steps) if (base * x > v + 1e-9) return base * x;
    base *= 10;
  }
}

export function setRecipe(state: GameState, id: string): boolean {
  if (!recipesOpen(state).some((r) => r.id === id)) return false;
  state.recipe = id;
  return true;
}

// ---------- flow: what's coming in and going out ----------

export interface Flow {
  held: number;
  cap: number;
  /** Made per second (jobs, the Chief, alchemy). */
  in: number;
  /** Used per second at full pace (digging, alchemy, the forge, the dragon). */
  out: number;
  /** The biggest single use, for hints. */
  usedBy: 'digging' | 'alchemy' | 'forge' | 'dragon' | null;
}

export function flows(state: GameState): Record<ResourceId, Flow> {
  const inn = production(state);
  const out = emptyRes();
  const top = {} as Record<ResourceId, { by: Flow['usedBy']; n: number }>;
  const use = (res: ResourceId, n: number, by: Flow['usedBy']) => {
    out[res] += n;
    if (!top[res] || n > top[res].n) top[res] = { by, n };
  };
  for (const [room, rate] of Object.entries(digRates(state))) {
    const paces = rate / workPerPace(roomVolume(state, room));
    // a dig stalled for one support uses none of the others either
    const blocked = digBlocked(state, room);
    if (paces > 0 && blocked !== 'full')
      for (const s of supportsFor(roomVolume(state, room), state)) if (!blocked || blocked === s.resource) use(s.resource, paces * s.perPace, 'digging');
    if (paces > 0 && !blocked) for (const [res, n] of Object.entries(digYields(roomVolume(state, room), state))) inn[res as ResourceId] += paces * (n ?? 0);
  }
  for (const [res, n] of Object.entries(forgeUse(state))) use(res as ResourceId, n ?? 0, 'forge');
  for (const [res, n] of Object.entries(forgeMakes(state))) inn[res as ResourceId] += n ?? 0;
  const recipe = recipeDef(state.recipe);
  const alc = alchemyRate(state);
  if (recipe && alc > 0) {
    use(recipe.from, alc, 'alchemy');
    if (state.res[recipe.from] > 0) inn[recipe.to] += alc / recipeRatio(state, recipe);
  }
  if (resourceOpen(state, 'meat') && eatRate(state) > 0) use('meat', eatRate(state), 'dragon');
  const f = {} as Record<ResourceId, Flow>;
  for (const r of RESOURCES)
    f[r.id] = { held: state.res[r.id], cap: capacity(state, r.id), in: inn[r.id], out: out[r.id], usedBy: out[r.id] > 0 ? (top[r.id]?.by ?? null) : null };
  return f;
}

/**
 * Short notes for job rows: what's short, what's full, and roughly how many
 * kobolds would fix it. Keyed by job id; jobs with nothing to say are absent.
 */
export function jobHints(state: GameState): Record<string, string> {
  const hints: Record<string, string> = {};
  const f = flows(state);
  const why = { digging: 'Digging', alchemy: 'The alchemist', forge: 'The forge', dragon: 'The dragon' } as const;
  for (const def of JOBS) {
    const res = def.produces?.resource;
    if (!res || !jobOpen(state, def)) continue;
    const fl = f[res];
    const name = resourceDef(res).name.toLowerCase();
    const plural = (n: number) => `${def.name.toLowerCase()}${n === 1 ? '' : 's'}`;
    if (fl.out > fl.in && fl.usedBy) {
      const each = Math.max(1e-9, perKobold(state, def) * (def.id === 'herder' && state.herdSettle > 0 ? 0.5 : 1));
      const more = Math.max(1, Math.ceil((fl.out - fl.in) / each - 1e-9));
      const who = why[fl.usedBy];
      hints[def.id] = fl.held < 1
        ? `${who} has run out of ${name}. About ${more} more ${plural(more)} would keep up.`
        : `${who} uses ${name} faster than it comes in. About ${more} more ${plural(more)} would keep up.`;
    } else if (fl.in > 0 && fl.held >= fl.cap) {
      const room = roomDef(resourceDef(res).store)?.name.toLowerCase() ?? 'store';
      hints[def.id] = `${resourceDef(res).name} is full, so the extra is lost. Dig the ${room} bigger, spend some, or move kobolds.`;
    }
  }
  if (workers(state, 'herder') > herdersFit(state) && herdersFit(state) > 0)
    hints.herder = `The pasture only fits ${herdersFit(state)} herders. Dig it bigger, or the rest just stand about.`;
  if (hoardFull(state) && workers(state, 'scavenger') > 0) {
    const b = digBlocked(state, 'hoard');
    hints.scavenger =
      b === 'full'
        ? 'The hoard room is full and as big as it can be dug, so the extra copper is lost.'
        : b
          ? `The hoard room is full. The scavengers would dig it bigger, but there's no ${resourceDef(b).name.toLowerCase()} to hold the ceiling up.`
          : 'The hoard room is full, so the scavengers are digging it bigger until there is room again.';
  }
  if (workers(state, 'researcher') > 0 && !state.research.current) hints.researcher = 'Nothing being researched. Pick something below.';
  else if (workers(state, 'researcher') > 0 && state.research.current) {
    const cur = researchDef(state.research.current);
    const short = cur ? researchShortOf(state, cur) : [];
    if (cur && short.length)
      hints.researcher = `${cur.name} is waiting for ${short.map((x) => resourceDef(x).name.toLowerCase()).join(' and ')}. Spare research goes to other projects meanwhile.`;
  }
  const recipe = recipeDef(state.recipe);
  if (recipe && workers(state, 'alchemist') > 0 && state.res[recipe.from] < 1)
    hints.alchemist = `Out of ${resourceDef(recipe.from).name.toLowerCase()} to work with.`;
  return hints;
}

// ---------- kobolds coming to the hoard ----------

/** The hoard's worth in copper: copper, silver and gold together. */
export function hoardValue(state: GameState): number {
  let v = 0;
  for (const r of RESOURCES) if (r.value) v += state.res[r.id] * r.value;
  return v;
}

/** How strongly the hoard draws kobolds: the dragon, the hoard's worth (each tenfold counts the same), art and oddities. */
export function appeal(state: GameState): number {
  let a = DRAGON_STAGES[state.stage]?.appeal ?? 0;
  a += ATTRACTION.perValueDecade * Math.log10(1 + hoardValue(state));
  a += ATTRACTION.perOddity * Object.keys(state.oddities).length;
  a += ATTRACTION.perDragonPaces * state.dragon.size;
  a += dragonAppeal(state);
  let m = 1;
  if (state.chief) m *= 1 + 0.1 * state.chief.voice;
  const q = quirkOf(state.chief);
  if (q?.effect.kind === 'appealMult') m *= q.effect.mult;
  return a * m;
}

export function arrivalSeconds(state: GameState): number {
  return Math.max(ATTRACTION.minSeconds, ATTRACTION.secondsPerAppeal / Math.max(1, appeal(state)));
}

/**
 * Let `seconds` of arrivals happen. Newcomers go to `newcomerJob` (or idle),
 * as long as there are free beds. Nobody comes before there is a Chief.
 * Returns how many arrived.
 */
export function arrive(state: GameState, seconds: number): number {
  if (!state.chief || !(seconds > 0)) return 0;
  const free = beds(state) - population(state);
  if (free <= 0) {
    state.arrivalProgress = 0;
    return 0;
  }
  const every = arrivalSeconds(state);
  state.arrivalProgress += seconds;
  const n = Math.min(free, Math.floor(state.arrivalProgress / every));
  state.arrivalProgress -= n * every;
  if (n === free) state.arrivalProgress = 0;
  if (n > 0) {
    state.idle += n;
    const job = jobDef(state.newcomerJob);
    if (state.newcomerJob !== IDLE && job && jobOpen(state, job)) assign(state, state.newcomerJob, n);
  }
  return n;
}

// ---------- the dragon and the pile ----------

/**
 * The dragon stage a hoard value has earned. Only hatching comes from the
 * hoard's worth; later stages come from evolving (see dragon.ts).
 */
export function stageFor(value: number): number {
  return value >= (DRAGON_STAGES[1].threshold ?? Infinity) ? 1 : 0;
}

export function hoardSize(copperHeld: number): number {
  let s = 0;
  HOARD_SIZE_THRESHOLDS.forEach((t, i) => {
    if (copperHeld >= t) s = i;
  });
  return s;
}

/** Add a resource, up to what its room can hold. Returns how much was kept. */
export function store(state: GameState, res: ResourceId, amount: number): number {
  if (!(amount > 0)) return 0;
  const room = Math.max(0, capacity(state, res) - state.res[res]);
  const kept = Math.min(amount, room);
  state.res[res] += kept;
  if (res === 'copper') state.totalEarned += kept;
  return kept;
}

// ---------- time passing ----------

export interface TickResult {
  /** Kept, by resource. */
  gained: Record<ResourceId, number>;
  /** Made but lost because a room was full. */
  lost: Record<ResourceId, number>;
  newStage: number | null;
  /** Rooms that reached a new size, in order. */
  /** Rooms that passed a round volume. */
  dug: { room: string; volume: number }[];
  /** Research finished, by id. */
  learned: string[];
  /** Chronicle lines. {chief} is filled in by the caller. */
  events: string[];
}

const emptyResult = (): TickResult => ({ gained: emptyRes(), lost: emptyRes(), newStage: null, dug: [], learned: [], events: [] });

/** Rates are worked out again at least this often (seconds). */
const SUBSTEP = 10;

/**
 * Let `seconds` pass: production, storage limits, alchemy, digging, research
 * and mishaps, the dragon. `t` is the epoch ms when this
 * time started, for history entries.
 */
export function tick(state: GameState, seconds: number, t = state.lastTick): TickResult {
  const r = emptyResult();
  if (!(seconds > 0)) return r;
  const rand = rng(state);
  let at = t;
  for (let left = seconds; left > 1e-9; left -= SUBSTEP) {
    const dt = Math.min(SUBSTEP, left);
    at += dt * 1000;
    const p = production(state);
    for (const res of RESOURCES) {
      const made = p[res.id] * dt;
      const kept = store(state, res.id, made);
      r.gained[res.id] += kept;
      r.lost[res.id] += made - kept;
    }
    alchemy(state, alchemyRate(state) * dt);
    for (const [room, rate] of Object.entries(digRates(state))) dig(state, room, rate * dt, r, rand, at);
    forgeStep(state, dt);
    research(state, dt, at, rand, r);
    const before = state.stage;
    r.events.push(...dragonStep(state, dt, at, rand));
    r.events.push(...artStep(state, dt, at, rand));
    r.events.push(...oddityPips(state));
    r.events.push(...talentStep(state, dt, at, rand));
    r.events.push(...epithetStep(state, at));
    r.events.push(...colonyStep(state, dt, at, rand));
    const s = stageFor(hoardValue(state));
    if (s > state.stage) state.stage = s;
    if (state.stage > before) r.newStage = state.stage;
  }
  return r;
}

function alchemy(state: GameState, input: number) {
  const recipe = recipeDef(state.recipe);
  if (!recipe || !(input > 0) || !resourceOpen(state, recipe.to)) return;
  const room = Math.max(0, capacity(state, recipe.to) - state.res[recipe.to]);
  const ratio = recipeRatio(state, recipe);
  const use = Math.min(input, state.res[recipe.from], room * ratio);
  if (use <= 0) return;
  state.res[recipe.from] -= use;
  store(state, recipe.to, use / ratio);
}

function dig(state: GameState, roomId: string, work: number, r: TickResult, rand: () => number, t: number) {
  // supports change at set volumes, so dig up to each one in turn
  for (let guard = 0; guard < 100 && work > 1e-9; guard++) {
    const def = roomDef(roomId);
    if (!def) return;
    const room = (state.rooms[def.id] ??= { volume: def.start });
    const max = maxVolume(state);
    const next = DIG.supports.find((x) => x.fromPaces > room.volume + 1e-9)?.fromPaces ?? Infinity;
    // dig in small steps, so the work per pace keeps up as the room grows
    const wpp = workPerPace(room.volume);
    const want = Math.min(work / wpp, Math.min(next, max) - room.volume, 25);
    let paces = want;
    const sup = supportsFor(room.volume, state);
    for (const x of sup) paces = Math.min(paces, state.res[x.resource] / x.perPace);
    if (paces <= 1e-9) return; // stalled for supports, or full
    for (const x of sup) state.res[x.resource] = Math.max(0, state.res[x.resource] - paces * x.perPace);
    const before = room.volume;
    // deeper rooms turn up stone, then ore too
    for (const [res, n] of Object.entries(digYields(room.volume, state))) store(state, res as ResourceId, paces * (n ?? 0));
    room.volume += paces;
    work -= paces * wpp;
    const mark = volumeMilestone(before);
    if (room.volume >= mark - 1e-6) r.dug.push({ room: def.id, volume: mark });
    const found = digFinds(state, def, paces, rand, t);
    if (found) r.events.push(found);
    if (paces < want - 1e-9) return; // ran out of supports part way
  }
}

function research(state: GameState, dt: number, t: number, rand: () => number, r: TickResult) {
  const n = workers(state, 'researcher');
  if (n === 0) return;
  for (const done of addResearch(state, researchRate(state) * dt)) {
    r.learned.push(done.id);
    r.events.push(done.doneText);
  }
  // mishaps: loud, harmless, and how most kobolds get their names
  if (rand() >= (n * dt * researchMult(state, 'mishapRate')) / (MISHAP_HOURS * 3600)) return;
  const m = MISHAPS[Math.floor(rand() * MISHAPS.length) % MISHAPS.length];
  const named = namedIn(state, 'researcher');
  let k = named.length && rand() < (researchEffect(state, 'mishapNamedChance')?.chance ?? 0.35) ? named[Math.floor(rand() * named.length) % named.length] : null;
  let text: string;
  let fresh = false;
  if (!k) {
    const got = nameOrCredit(state, 'researcher', m.title, t, rand);
    if (!got) return;
    k = got.k;
    fresh = got.fresh;
  }
  if (fresh) {
    addHistory(k, t, m.text.replaceAll('{kobold}', 'They'));
    text = `${m.text.replaceAll('{kobold}', 'A researcher')} From now on they are ${fullName(k)}.`;
  } else {
    text = m.text.replaceAll('{kobold}', fullName(k));
    addHistory(k, t, m.text.replaceAll('{kobold}', k.name));
  }
  if (!k.traits.includes(m.trait)) k.traits.push(m.trait);
  if (m.talent && addTalent(k, m.talent)) text += ` It left them better at ${jobDef(m.talent.job)?.name.toLowerCase() ?? m.talent.job} work for good.`;
  const e = m.effect;
  if (e?.kind === 'research') {
    const cur = state.research.current ? researchDef(state.research.current) : undefined;
    if (cur)
      for (const done of addResearch(state, cur.cost * e.fraction * researchMult(state, 'mishapResearch'))) {
        r.learned.push(done.id);
        r.events.push(done.doneText);
      }
  } else if (e?.kind === 'dig') {
    // the crater goes to whichever room has the most diggers, or the den
    let room = 'den';
    for (const [id, n] of Object.entries(state.dig)) if (n > (state.dig[room] ?? 0)) room = id;
    dig(state, room, e.work, r, rand, t);
  } else if (e?.kind === 'oddity') {
    const rec = state.oddities[e.id];
    if (rec) rec.count++;
    else state.oddities[e.id] = { count: 1, firstAt: t };
  }
  r.events.push(text);
}

/** Long absences are worked through in steps of this many seconds. */
const ADVANCE_STEP = 60;

export interface AdvanceResult extends TickResult {
  arrived: number;
  elapsed: number;
  credited: number;
}

/**
 * Credit all time since `state.lastTick`, capped at the offline cap.
 * Used every tick, so a sleeping laptop, a hidden tab and a closed game
 * all work the same way. A clock that went backwards credits nothing.
 */
export function advanceTo(state: GameState, now: number): AdvanceResult {
  const elapsed = Math.max(0, (now - state.lastTick) / 1000);
  const credited = Math.min(elapsed, offlineCap(state));
  state.lastTick = Math.max(state.lastTick, now);
  const out: AdvanceResult = { ...emptyResult(), arrived: 0, elapsed, credited };
  // when the credited time started, so history entries land at about the right moment
  let at = now - credited * 1000;
  for (let left = credited; left > 0; left -= ADVANCE_STEP) {
    const step = Math.min(ADVANCE_STEP, left);
    const r = tick(state, step, at);
    at += step * 1000;
    for (const res of RESOURCES) {
      out.gained[res.id] += r.gained[res.id];
      out.lost[res.id] += r.lost[res.id];
    }
    if (r.newStage !== null) out.newStage = r.newStage;
    out.dug.push(...r.dug);
    out.learned.push(...r.learned);
    out.events.push(...r.events);
    out.arrived += arrive(state, step);
  }
  return out;
}

/** Every few kinds of oddity found, the Chief grows more cunning. */
function oddityPips(state: GameState): string[] {
  const earned = Math.floor(Object.keys(state.oddities).length / PIP_ODDITIES);
  if (earned <= state.chiefMarks.oddities) return [];
  state.chiefMarks.oddities = earned;
  if (!raiseStat(state.chief, 'cunning')) return [];
  return [`${state.chief!.name} has studied the oddities shelf so long they've grown more cunning. Cunning +1.`];
}

/** How many named kobolds work a job. */
export function namedInJob(state: GameState, jobId: string): number {
  return namedIn(state, jobId).length;
}

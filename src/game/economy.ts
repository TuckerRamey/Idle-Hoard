// The economy: what the warren makes and uses, what the rooms hold, digging,
// crews, research and kobolds arriving. Pure functions over GameState; no DOM.

import { quirkOf } from './chief';
import {
  ATTRACTION,
  CONFIG,
  CREW,
  DIG,
  DRAGON_STAGES,
  HOARD_SIZE_THRESHOLDS,
  IDLE,
  JOBS,
  RECIPES,
  RESOURCES,
  ROOMS,
  UPGRADES,
  type JobDef,
  type ResourceId,
  type RoomDef,
  type UpgradeDef,
} from './data';
import { dragonAppeal, dragonJobMult, dragonStep, eatRate, moodMult } from './dragon';
import { addHistory, crewLift, fullName, nameKobold, namedIn, personalMult } from './kobolds';
import { ODDITIES } from './oddities';
import { addResearch, MISHAPS, MISHAP_HOURS, opened, RESEARCH } from './research';
import { rng, type Crew, type GameState } from './state';

export const jobDef = (id: string) => JOBS.find((j) => j.id === id);
export const roomDef = (id: string) => ROOMS.find((r) => r.id === id);
export const resourceDef = (id: ResourceId) => RESOURCES.find((r) => r.id === id)!;
export const recipeDef = (id: string) => RECIPES.find((r) => r.id === id);

const emptyRes = () => ({ copper: 0, wood: 0, stone: 0, iron: 0, meat: 0 }) as Record<ResourceId, number>;

// ---------- what's open ----------

export function jobOpen(state: GameState, def: JobDef): boolean {
  return opened(state, def.requires);
}

export function resourceOpen(state: GameState, res: ResourceId): boolean {
  return opened(state, resourceDef(res).requires);
}

export function roomOpen(state: GameState, def: RoomDef): boolean {
  return opened(state, def.requires) && state.stage >= (def.minStage ?? 0);
}

export function recipesOpen(state: GameState) {
  return RECIPES.filter((r) => resourceOpen(state, r.from) && resourceOpen(state, r.to));
}

// ---------- crews ----------

export function crew(state: GameState, jobId: string): Crew {
  return state.crews[jobId] ?? { n: 0, exp: 0 };
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

/** Bonus for a crew that has worked together for `hours` on average. */
export function veteranBonus(hours: number): number {
  return CREW.maxBonus * (1 - Math.pow(0.5, Math.max(0, hours) / CREW.halfHours));
}

export function veteranLabel(hours: number): string {
  const b = veteranBonus(hours);
  if (b < 0.05) return 'green';
  if (b < 0.15) return 'steady';
  if (b < 0.25) return 'seasoned';
  return 'veteran';
}

/**
 * Move crowd kobolds between the idle pool and a job. A positive `k` takes
 * them from idle, a negative one sends them back. Newcomers to a crew start
 * with no experience, so moving many at once waters down the crew's bonus.
 * Returns how many actually moved.
 */
export function assign(state: GameState, jobId: string, k: number): number {
  const def = jobDef(jobId);
  if (!def || !Number.isFinite(k) || k === 0) return 0;
  const c = { ...crew(state, jobId) };
  if (k > 0) {
    if (!jobOpen(state, def)) return 0;
    const m = Math.min(Math.floor(k), state.idle);
    if (m <= 0) return 0;
    c.exp = (c.exp * c.n) / (c.n + m);
    c.n += m;
    state.idle -= m;
    state.crews[jobId] = c;
    return m;
  }
  const m = Math.min(Math.floor(-k), c.n);
  if (m <= 0) return 0;
  c.n -= m;
  if (c.n === 0) c.exp = 0;
  state.idle += m;
  state.crews[jobId] = c;
  return -m;
}

// ---------- multipliers ----------

function bought(state: GameState): UpgradeDef[] {
  return UPGRADES.filter((u) => state.upgrades.includes(u.id));
}

function researchedDefs(state: GameState) {
  return RESEARCH.filter((r) => state.research.done.includes(r.id));
}

export function jobMultiplier(state: GameState, jobId: string): number {
  let m = 1 + veteranBonus(crew(state, jobId).exp);
  for (const u of bought(state)) if (u.effect.kind === 'jobMult' && u.effect.job === jobId) m *= u.effect.mult;
  for (const r of researchedDefs(state)) if (r.effect?.kind === 'jobMult' && r.effect.job === jobId) m *= r.effect.mult;
  const q = quirkOf(state.chief);
  if (q?.effect.kind === 'jobMult' && q.effect.job === jobId) m *= q.effect.mult;
  return m * dragonJobMult(state, jobId);
}

export function globalMultiplier(state: GameState): number {
  let m = DRAGON_STAGES[state.stage]?.incomeMult ?? 1;
  for (const u of bought(state)) if (u.effect.kind === 'globalMult') m *= u.effect.mult;
  for (const r of researchedDefs(state)) if (r.effect?.kind === 'globalMult') m *= r.effect.mult;
  if (state.chief) m *= 1 + 0.05 * state.chief.nerve;
  for (const o of ODDITIES) if (o.incomeMult && state.oddities[o.id]) m *= o.incomeMult;
  return m * moodMult(state);
}

function baseRate(def: JobDef): number {
  return def.produces?.rate ?? def.digs ?? def.researches ?? def.converts ?? 0;
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
  let total = crew(state, def.id).n * each * crewLift(state, def.id);
  for (const k of namedIn(state, def.id)) total += each * personalMult(k);
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

/** Dig work per second, or 0 if nothing is being dug. */
export function digRate(state: GameState): number {
  if (!state.digging || !roomDef(state.digging)) return 0;
  const def = jobDef('digger');
  return def ? jobOutput(state, def) : 0;
}

export function offlineCap(_state: GameState): number {
  return CONFIG.offlineCapSeconds;
}

// ---------- rooms ----------

function storageMult(state: GameState): number {
  const q = quirkOf(state.chief);
  return q?.effect.kind === 'storageMult' ? q.effect.mult : 1;
}

export function roomSize(state: GameState, roomId: string): number {
  return state.rooms[roomId]?.size ?? 1;
}

/**
 * How far a room is dug, counting the dig in progress: size 3 halfway to 4
 * is 3.5. Rooms grow with every bit of digging; whole sizes only mark where
 * the supports a dig needs change.
 */
export function roomExtent(state: GameState, roomId: string): number {
  const room = state.rooms[roomId];
  const def = roomDef(roomId);
  if (!room || !def) return 1;
  return room.size + Math.min(1, room.progress / digWork(def, room.size + 1));
}

/** What a room holds: copper, storehouse space, beds or herders. Grows smoothly as it's dug. */
export function roomCapacity(state: GameState, def: RoomDef, size = roomExtent(state, def.id)): number {
  if (def.holds === 'beds' || def.holds === 'herders') {
    let m = 1;
    if (def.holds === 'beds') {
      m *= storageMult(state);
      for (const r of researchedDefs(state)) if (r.effect?.kind === 'bedsMult') m *= r.effect.mult;
    }
    return Math.floor(def.base * Math.pow(size, def.growth) * m + 1e-9);
  }
  if (def.holds === 'dragon') return 0;
  return Math.floor(def.base * Math.pow(def.growth, size - 1) * storageMult(state));
}

/** Storehouse goods uncovered so far; they share the storehouse evenly. */
export function storehouseGoods(state: GameState) {
  return RESOURCES.filter((r) => r.store === 'storehouse' && resourceOpen(state, r.id));
}

/** How much of a resource can be held. Storehouse space is split evenly. */
export function capacity(state: GameState, res: ResourceId): number {
  if (!resourceOpen(state, res)) return 0;
  if (resourceDef(res).store === 'hoard') return roomCapacity(state, roomDef('hoard')!);
  return Math.floor(roomCapacity(state, roomDef('storehouse')!) / storehouseGoods(state).length);
}

export function beds(state: GameState): number {
  return roomCapacity(state, roomDef('den')!);
}

export function herdersFit(state: GameState): number {
  const def = roomDef('pasture');
  return def && roomOpen(state, def) ? roomCapacity(state, def) : 0;
}

/** Dig work needed to take a room from `toSize - 1` to `toSize`. */
export function digWork(def: RoomDef, toSize: number): number {
  return def.digBase * Math.pow(DIG.growth, toSize - 2);
}

/** Supports used per unit of dig work while digging a room toward `toSize`. */
export function supportsFor(toSize: number) {
  return DIG.supports.filter((s) => toSize >= s.fromSize);
}

/** Why the current dig can't go on, or null if it can. */
export function digBlocked(state: GameState): ResourceId | null {
  if (!state.digging) return null;
  const toSize = roomSize(state, state.digging) + 1;
  for (const s of supportsFor(toSize)) if (state.res[s.resource] < s.perWork * 0.01) return s.resource;
  return null;
}

export function setDigging(state: GameState, roomId: string | null): boolean {
  if (roomId !== null) {
    const def = roomDef(roomId);
    if (!def || !roomOpen(state, def)) return false;
  }
  state.digging = roomId;
  return true;
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
  /** Used per second at full pace (digging, alchemy, the dragon). */
  out: number;
  /** The biggest single use, for hints. */
  usedBy: 'digging' | 'alchemy' | 'dragon' | null;
}

export function flows(state: GameState): Record<ResourceId, Flow> {
  const inn = production(state);
  const out = emptyRes();
  const top = {} as Record<ResourceId, { by: Flow['usedBy']; n: number }>;
  const use = (res: ResourceId, n: number, by: Flow['usedBy']) => {
    out[res] += n;
    if (!top[res] || n > top[res].n) top[res] = { by, n };
  };
  const dig = digRate(state);
  const toSize = state.digging ? roomSize(state, state.digging) + 1 : 0;
  // a dig stalled for one support uses none of the others either
  const blocked = digBlocked(state);
  if (dig > 0) for (const s of supportsFor(toSize)) if (!blocked || blocked === s.resource) use(s.resource, dig * s.perWork, 'digging');
  const recipe = recipeDef(state.recipe);
  const alc = alchemyRate(state);
  if (recipe && alc > 0) {
    use(recipe.from, alc, 'alchemy');
    if (state.res[recipe.from] > 0) inn[recipe.to] += alc / recipe.ratio;
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
  const why = { digging: 'Digging', alchemy: 'The alchemist', dragon: 'The dragon' } as const;
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
      const room = resourceDef(res).store === 'hoard' ? 'hoard room' : 'storehouse';
      hints[def.id] = `${resourceDef(res).name} is full, so the extra is lost. Dig the ${room} bigger, spend some, or move kobolds.`;
    }
  }
  if (workers(state, 'herder') > herdersFit(state) && herdersFit(state) > 0)
    hints.herder = `The pasture only fits ${herdersFit(state)} herders. Dig it bigger, or the rest just stand about.`;
  if (workers(state, 'digger') > 0 && !state.digging) hints.digger = 'Nothing to dig. Pick a room below.';
  else if (state.digging && workers(state, 'digger') === 0) hints.digger = `The ${roomDef(state.digging)!.name.toLowerCase()} is waiting for diggers.`;
  else if (state.digging && population(state) >= beds(state) && state.digging !== 'den') hints.digger = 'Every bed is taken. Dig the den bigger to fit more kobolds.';
  if (workers(state, 'researcher') > 0 && !state.research.current) hints.researcher = 'Nothing being researched. Pick something below.';
  const recipe = recipeDef(state.recipe);
  if (recipe && workers(state, 'alchemist') > 0 && state.res[recipe.from] < 1)
    hints.alchemist = `Out of ${resourceDef(recipe.from).name.toLowerCase()} to work with.`;
  return hints;
}

// ---------- kobolds coming to the hoard ----------

/** How strongly the hoard draws kobolds. Things that change slowly, not copper held. */
export function appeal(state: GameState): number {
  let a = DRAGON_STAGES[state.stage]?.appeal ?? 0;
  a += ATTRACTION.perHoardSize * roomExtent(state, 'hoard');
  a += ATTRACTION.perOddity * Object.keys(state.oddities).length;
  for (const u of bought(state)) if (u.effect.kind === 'appeal') a += u.effect.points;
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
 * The dragon stage a lifetime total has earned. Only hatching comes from
 * copper; later stages come from molting (see dragon.ts).
 */
export function stageFor(totalEarned: number): number {
  return totalEarned >= (DRAGON_STAGES[1].threshold ?? Infinity) ? 1 : 0;
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
  dug: { room: string; size: number }[];
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
 * and mishaps, crew experience, the dragon. `t` is the epoch ms when this
 * time started, for history entries.
 */
export function tick(state: GameState, seconds: number, t = state.lastTick): TickResult {
  const r = emptyResult();
  if (!(seconds > 0)) return r;
  const rand = rng(state);
  const expRate = state.chief ? 1 + 0.1 * state.chief.cunning : 1;
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
    dig(state, digRate(state) * dt, r);
    research(state, dt, at, rand, r);
    const before = state.stage;
    r.events.push(...dragonStep(state, dt, at, rand));
    for (const c of Object.values(state.crews)) if (c.n > 0) c.exp += (dt / 3600) * expRate;
    const s = stageFor(state.totalEarned);
    if (s > state.stage) state.stage = s;
    if (state.stage > before) r.newStage = state.stage;
  }
  return r;
}

function alchemy(state: GameState, input: number) {
  const recipe = recipeDef(state.recipe);
  if (!recipe || !(input > 0) || !resourceOpen(state, recipe.to)) return;
  const room = Math.max(0, capacity(state, recipe.to) - state.res[recipe.to]);
  const use = Math.min(input, state.res[recipe.from], room * recipe.ratio);
  if (use <= 0) return;
  state.res[recipe.from] -= use;
  store(state, recipe.to, use / recipe.ratio);
}

function dig(state: GameState, work: number, r: TickResult) {
  // a room can grow several sizes in one go after a long absence
  for (let guard = 0; guard < 50 && work > 1e-9 && state.digging; guard++) {
    const def = roomDef(state.digging);
    const room = state.rooms[state.digging];
    if (!def || !room) return;
    const toSize = room.size + 1;
    const need = digWork(def, toSize) - room.progress;
    const want = Math.min(work, need);
    let w = want;
    for (const s of supportsFor(toSize)) w = Math.min(w, state.res[s.resource] / s.perWork);
    if (w <= 1e-9) return; // stalled for supports
    for (const s of supportsFor(toSize)) state.res[s.resource] = Math.max(0, state.res[s.resource] - w * s.perWork);
    room.progress += w;
    work -= w;
    if (room.progress >= digWork(def, toSize) - 1e-6) {
      room.size = toSize;
      room.progress = 0;
      r.dug.push({ room: def.id, size: toSize });
    } else if (w < want) {
      return; // ran out of supports part way
    }
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
  if (rand() >= (n * dt) / (MISHAP_HOURS * 3600)) return;
  const m = MISHAPS[Math.floor(rand() * MISHAPS.length) % MISHAPS.length];
  const named = namedIn(state, 'researcher');
  let k = named.length && rand() < 0.35 ? named[Math.floor(rand() * named.length) % named.length] : null;
  let text: string;
  if (k) {
    text = m.text.replaceAll('{kobold}', fullName(k));
    addHistory(k, t, m.text.replaceAll('{kobold}', k.name));
    if (!k.traits.includes(m.trait)) k.traits.push(m.trait);
  } else {
    k = nameKobold(state, 'researcher', m.title, m.text.replaceAll('{kobold}', 'They'), t, rand);
    if (!k) return;
    k.traits.push(m.trait);
    text = `${m.text.replaceAll('{kobold}', 'A researcher')} From now on they are ${fullName(k)}.`;
  }
  const e = m.effect;
  if (e?.kind === 'research') {
    const cur = RESEARCH.find((x) => x.id === state.research.current);
    if (cur)
      for (const done of addResearch(state, cur.cost * e.fraction)) {
        r.learned.push(done.id);
        r.events.push(done.doneText);
      }
  } else if (e?.kind === 'dig' && state.digging) {
    dig(state, e.work, r);
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

// ---------- upgrades and displays ----------

export function upgradeVisible(state: GameState, u: UpgradeDef): boolean {
  if (state.upgrades.includes(u.id)) return false;
  const r = u.requires;
  if (r.stage !== undefined && state.stage < r.stage) return false;
  if (r.job && workers(state, r.job) < (r.count ?? 1)) return false;
  return Object.keys(u.cost).every((res) => resourceOpen(state, res as ResourceId));
}

export function canAfford(state: GameState, cost: Partial<Record<ResourceId, number>>): boolean {
  return Object.entries(cost).every(([res, n]) => state.res[res as ResourceId] >= (n ?? 0));
}

export function buyUpgrade(state: GameState, upgradeId: string): boolean {
  const u = UPGRADES.find((x) => x.id === upgradeId);
  if (!u || !upgradeVisible(state, u) || !canAfford(state, u.cost)) return false;
  for (const [res, n] of Object.entries(u.cost)) state.res[res as ResourceId] -= n ?? 0;
  state.upgrades.push(u.id);
  return true;
}

/** How many named kobolds work a job. */
export function namedInJob(state: GameState, jobId: string): number {
  return namedIn(state, jobId).length;
}

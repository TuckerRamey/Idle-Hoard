// The economy: what the warren makes, what the rooms hold, digging, crews and
// kobolds arriving. Pure functions over GameState; no DOM.

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
  RESOURCES,
  ROOMS,
  UPGRADES,
  type JobDef,
  type ResourceId,
  type RoomDef,
  type UpgradeDef,
} from './data';
import { ODDITIES } from './oddities';
import type { Crew, GameState } from './state';

export const jobDef = (id: string) => JOBS.find((j) => j.id === id);
export const roomDef = (id: string) => ROOMS.find((r) => r.id === id);
export const resourceDef = (id: ResourceId) => RESOURCES.find((r) => r.id === id)!;

// ---------- crews ----------

export function crew(state: GameState, jobId: string): Crew {
  return state.crews[jobId] ?? { n: 0, exp: 0 };
}

export function workers(state: GameState, jobId: string): number {
  return crew(state, jobId).n;
}

/** Every kobold in the warren, working or idle (not counting the Chief). */
export function population(state: GameState): number {
  let n = state.idle;
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
 * Move kobolds between the idle pool and a job. A positive `k` takes them
 * from idle, a negative one sends them back. Newcomers to a crew start with
 * no experience, so moving many at once waters down the crew's bonus.
 * Returns how many actually moved.
 */
export function assign(state: GameState, jobId: string, k: number): number {
  if (!jobDef(jobId) || !Number.isFinite(k) || k === 0) return 0;
  const c = { ...crew(state, jobId) };
  if (k > 0) {
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

export function jobMultiplier(state: GameState, jobId: string): number {
  let m = 1 + veteranBonus(crew(state, jobId).exp);
  for (const u of bought(state)) if (u.effect.kind === 'jobMult' && u.effect.job === jobId) m *= u.effect.mult;
  const q = quirkOf(state.chief);
  if (q?.effect.kind === 'jobMult' && q.effect.job === jobId) m *= q.effect.mult;
  return m;
}

export function globalMultiplier(state: GameState): number {
  let m = DRAGON_STAGES[state.stage]?.incomeMult ?? 1;
  for (const u of bought(state)) if (u.effect.kind === 'globalMult') m *= u.effect.mult;
  if (state.chief) m *= 1 + 0.05 * state.chief.nerve;
  for (const o of ODDITIES) if (o.incomeMult && state.oddities[o.id]) m *= o.incomeMult;
  return m;
}

/** What one kobold in this job makes (or digs) per second right now. */
export function perKobold(state: GameState, def: JobDef): number {
  const base = def.produces?.rate ?? def.digs ?? 0;
  return base * jobMultiplier(state, def.id) * globalMultiplier(state);
}

/** What the whole crew makes (or digs) per second. */
export function jobOutput(state: GameState, def: JobDef): number {
  return workers(state, def.id) * perKobold(state, def);
}

/** Copper per second the Chief brings in personally. */
export function chiefRate(state: GameState): number {
  return state.chief ? CONFIG.chiefRate * globalMultiplier(state) : 0;
}

/** Everything made per second, before storage limits. */
export function production(state: GameState): Record<ResourceId, number> {
  const p = { copper: chiefRate(state), wood: 0, stone: 0 } as Record<ResourceId, number>;
  for (const def of JOBS) if (def.produces) p[def.produces.resource] += jobOutput(state, def);
  return p;
}

/** Copper per second (the headline number). */
export function incomePerSecond(state: GameState): number {
  return production(state).copper;
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

/** What a room holds at a given size: copper, storehouse space, or beds. */
export function roomCapacity(state: GameState, def: RoomDef, size = roomSize(state, def.id)): number {
  if (def.holds === 'beds') return Math.round(def.base * Math.pow(size, def.growth) * storageMult(state));
  return Math.floor(def.base * Math.pow(def.growth, size - 1) * storageMult(state));
}

const storehouseGoods = () => RESOURCES.filter((r) => r.store === 'storehouse');

/** How much of a resource can be held. Storehouse space is split evenly. */
export function capacity(state: GameState, res: ResourceId): number {
  if (resourceDef(res).store === 'hoard') return roomCapacity(state, roomDef('hoard')!);
  return Math.floor(roomCapacity(state, roomDef('storehouse')!) / storehouseGoods().length);
}

export function beds(state: GameState): number {
  return roomCapacity(state, roomDef('den')!);
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
  if (roomId !== null && !roomDef(roomId)) return false;
  state.digging = roomId;
  return true;
}

// ---------- flow: what's coming in and going out ----------

export interface Flow {
  held: number;
  cap: number;
  /** Made per second. */
  in: number;
  /** Used per second by digging, at full speed. */
  out: number;
}

export function flows(state: GameState): Record<ResourceId, Flow> {
  const p = production(state);
  const dig = digRate(state);
  const toSize = state.digging ? roomSize(state, state.digging) + 1 : 0;
  const out = { copper: 0, wood: 0, stone: 0 } as Record<ResourceId, number>;
  // a dig stalled for one support uses none of the others either
  const blocked = digBlocked(state);
  if (dig > 0) for (const s of supportsFor(toSize)) if (!blocked || blocked === s.resource) out[s.resource] += dig * s.perWork;
  const f = {} as Record<ResourceId, Flow>;
  for (const r of RESOURCES) f[r.id] = { held: state.res[r.id], cap: capacity(state, r.id), in: p[r.id], out: out[r.id] };
  return f;
}

/**
 * Short notes for job rows: what's short, what's full, and roughly how many
 * kobolds would fix it. Keyed by job id; jobs with nothing to say are absent.
 */
export function jobHints(state: GameState): Record<string, string> {
  const hints: Record<string, string> = {};
  const f = flows(state);
  for (const def of JOBS) {
    const res = def.produces?.resource;
    if (!res) continue;
    const fl = f[res];
    const name = resourceDef(res).name.toLowerCase();
    if (fl.out > fl.in) {
      const each = perKobold(state, def);
      const more = Math.max(1, Math.ceil((fl.out - fl.in) / each - 1e-9));
      hints[def.id] = fl.held < 1
        ? `Digging has stalled for want of ${name}. About ${more} more ${def.name.toLowerCase()}${more === 1 ? '' : 's'} would keep it going.`
        : `Digging uses ${name} faster than it comes in. About ${more} more ${def.name.toLowerCase()}${more === 1 ? '' : 's'} would keep up.`;
    } else if (fl.in > 0 && fl.held >= fl.cap) {
      const room = resourceDef(res).store === 'hoard' ? 'hoard room' : 'storehouse';
      hints[def.id] = `${resourceDef(res).name} is full, so the extra is lost. Dig the ${room} bigger, spend some, or move kobolds.`;
    }
  }
  const digger = jobDef('digger');
  if (digger) {
    if (!state.digging) {
      if (workers(state, 'digger') > 0) hints.digger = 'Nothing to dig. Pick a room below.';
    } else if (workers(state, 'digger') === 0) {
      hints.digger = `The ${roomDef(state.digging)!.name.toLowerCase()} is waiting for diggers.`;
    } else if (population(state) >= beds(state) && state.digging !== 'den') {
      hints.digger = 'Every bed is taken. Dig the den bigger to fit more kobolds.';
    }
  }
  return hints;
}

// ---------- kobolds coming to the hoard ----------

/** How strongly the hoard draws kobolds. Things that change slowly, not copper held. */
export function appeal(state: GameState): number {
  let a = DRAGON_STAGES[state.stage]?.appeal ?? 0;
  a += ATTRACTION.perHoardSize * roomSize(state, 'hoard');
  a += ATTRACTION.perOddity * Object.keys(state.oddities).length;
  for (const u of bought(state)) if (u.effect.kind === 'appeal') a += u.effect.points;
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
    if (state.newcomerJob !== IDLE && jobDef(state.newcomerJob)) assign(state, state.newcomerJob, n);
  }
  return n;
}

// ---------- the dragon and the pile ----------

/** The dragon stage a lifetime total has earned. Stages never go backwards. */
export function stageFor(totalEarned: number): number {
  let s = 0;
  DRAGON_STAGES.forEach((d, i) => {
    if (totalEarned >= d.threshold) s = i;
  });
  return s;
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
  /** Rooms that grew, in order. */
  dug: { room: string; size: number }[];
}

const emptyRes = () => ({ copper: 0, wood: 0, stone: 0 }) as Record<ResourceId, number>;

/** Rates are worked out again at least this often (seconds). */
const SUBSTEP = 10;

/** Let `seconds` pass: production, storage limits, digging, crew experience, the dragon. */
export function tick(state: GameState, seconds: number): TickResult {
  const r: TickResult = { gained: emptyRes(), lost: emptyRes(), newStage: null, dug: [] };
  if (!(seconds > 0)) return r;
  const expRate = state.chief ? 1 + 0.1 * state.chief.cunning : 1;
  for (let left = seconds; left > 1e-9; left -= SUBSTEP) {
    const dt = Math.min(SUBSTEP, left);
    const p = production(state);
    for (const res of RESOURCES) {
      const made = p[res.id] * dt;
      const kept = store(state, res.id, made);
      r.gained[res.id] += kept;
      r.lost[res.id] += made - kept;
    }
    dig(state, digRate(state) * dt, r);
    for (const c of Object.values(state.crews)) if (c.n > 0) c.exp += (dt / 3600) * expRate;
    const s = stageFor(state.totalEarned);
    if (s > state.stage) {
      state.stage = s;
      r.newStage = s;
    }
  }
  return r;
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
  const out: AdvanceResult = { gained: emptyRes(), lost: emptyRes(), newStage: null, dug: [], arrived: 0, elapsed, credited };
  for (let left = credited; left > 0; left -= ADVANCE_STEP) {
    const step = Math.min(ADVANCE_STEP, left);
    const r = tick(state, step);
    for (const res of RESOURCES) {
      out.gained[res.id] += r.gained[res.id];
      out.lost[res.id] += r.lost[res.id];
    }
    if (r.newStage !== null) out.newStage = r.newStage;
    out.dug.push(...r.dug);
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
  return true;
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

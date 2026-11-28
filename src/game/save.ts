// Versioned saves.
//
// A save on disk looks like { version: N, savedAt: <ms>, state: {...} }.
// When the shape of GameState changes in a way that `normalize` can't paper
// over (renaming a field, changing units, splitting a currency...):
//   1. bump SAVE_VERSION
//   2. add MIGRATIONS[oldVersion] that turns an oldVersion state into the next one
//   3. add a test in tests/save.test.ts with a real old save
// Adding a new optional field, job, room or resource does NOT need a migration;
// `normalize` fills in defaults.

import { OLD_QUIRKS, QUIRKS, type Chief } from './chief';
import { JOBS, RESOURCES } from './data';
import type { ToolStock } from './forge';
import type { NamedKobold } from './kobolds';
import type { Colony } from './colonies';
import { areaDef, legacyAreas } from './areas';
import { CHRONICLE_MAX, newDragon, newExplore, newGame, newHunt, newMagic, type ExploreState, type ChronicleEntry, type Crew, type DragonState, type GameState, type HuntState, type MagicState, type RoomState } from './state';

export const SAVE_VERSION = 3;
export const SAVE_KEY = 'idle-hoard.save';
export const BACKUP_KEY = 'idle-hoard.save.backup';
export const UNREADABLE_KEY = 'idle-hoard.save.unreadable';

export interface SaveFile {
  version: number;
  savedAt: number;
  state: unknown;
}

/** MIGRATIONS[v] upgrades a state at version v to version v + 1. */
export type Migration = (state: any) => any;
export const MIGRATIONS: Record<number, Migration> = {
  // Version 2 replaced the job ladder with crews, rooms and storage. The old
  // warren can't be translated, so it starts over, but the Chief, the
  // chronicle, the oddities shelf and the settings come along.
  1: (s) => ({
    chief: s?.chief ? { ...s.chief, quirk: OLD_QUIRKS[s.chief.quirk] ?? s.chief.quirk } : null,
    chronicle: s?.chronicle,
    oddities: s?.oddities,
    settings: s?.settings,
    createdAt: s?.createdAt,
    lastTick: s?.lastTick,
  }),
  // Version 3 measured rooms in cubic paces, split the storehouse into
  // stores, and turned iron into ore and bars. During early development the
  // warren starts over; the Chief, chronicle, oddities and settings stay.
  2: (s) => ({
    chief: s?.chief ?? null,
    chronicle: s?.chronicle,
    oddities: s?.oddities,
    settings: s?.settings,
    createdAt: s?.createdAt,
    lastTick: s?.lastTick,
  }),
};

/** Minimal key/value store, so a desktop wrapper (Tauri) can swap in file storage. */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export const browserStore: KeyValueStore = {
  get(key) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // storage full or blocked; nothing sensible to do but keep playing
    }
  },
};

export class SaveError extends Error {}

/** Run migrations from `fromVersion` up to `toVersion`. */
export function migrate(
  state: unknown,
  fromVersion: number,
  toVersion = SAVE_VERSION,
  migrations: Record<number, Migration> = MIGRATIONS,
): unknown {
  if (!Number.isInteger(fromVersion) || fromVersion < 1) throw new SaveError(`Bad save version: ${fromVersion}`);
  if (fromVersion > toVersion)
    throw new SaveError(`This save is from a newer version of the game (v${fromVersion}). Update the game to load it.`);
  let s = state;
  for (let v = fromVersion; v < toVersion; v++) {
    const m = migrations[v];
    if (!m) throw new SaveError(`No migration from save version ${v}`);
    s = m(s);
  }
  return s;
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d);
const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function normalizeChief(c: any): Chief | null {
  if (!c || typeof c !== 'object' || typeof c.name !== 'string' || !c.name.trim()) return null;
  return {
    name: c.name.trim().slice(0, 24),
    cunning: Math.floor(num(c.cunning, 1)),
    voice: Math.floor(num(c.voice, 1)),
    nerve: Math.floor(num(c.nerve, 1)),
    // an unknown quirk (from a newer version) is kept; it simply has no effect here
    quirk: typeof c.quirk === 'string' ? c.quirk : QUIRKS[0].id,
  };
}

function normalizeOddities(v: unknown): GameState['oddities'] {
  const out: GameState['oddities'] = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, o] of Object.entries(v as Record<string, any>)) {
    const count = Math.floor(num(o?.count, 0));
    if (count > 0) out[k] = { count, firstAt: num(o?.firstAt, 0) };
  }
  return out;
}

function normalizeChronicle(v: unknown): ChronicleEntry[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((e) => e && typeof e.text === 'string')
    .map((e) => ({ t: num(e.t, 0), text: String(e.text) }))
    .slice(-CHRONICLE_MAX);
}

function normalizeCrews(v: unknown): Record<string, Crew> {
  const out: Record<string, Crew> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, c] of Object.entries(v as Record<string, any>)) out[k] = { n: Math.floor(num(c?.n, 0)) };
  return out;
}

function normalizeRooms(v: unknown, base: Record<string, RoomState>): Record<string, RoomState> {
  const out: Record<string, RoomState> = { ...base };
  if (!v || typeof v !== 'object') return out;
  for (const [k, r] of Object.entries(v as Record<string, any>)) if (k !== 'lair') out[k] = { volume: num(r?.volume, out[k]?.volume ?? 0) };
  // the lair became part of the hoard room: the dragon sleeps on its hoard now
  const lair = (v as Record<string, any>).lair;
  if (lair && out.hoard) out.hoard = { volume: out.hoard.volume + num(lair.volume, 0) };
  return out;
}

function normalizeSlots(v: unknown): GameState['forge']['slots'] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => {
    const order = typeof x?.order === 'string' ? x.order : null;
    if (order?.startsWith('tool:')) return { order: 'auto', progress: 0 };
    return { order, progress: num(x?.progress, 0) };
  });
}

const TOOL_TIERS = ['stone', 'iron', 'steel', 'mithril', 'adamant'] as const;

function normalizeStock(v: any): ToolStock | null {
  if (!v || typeof v !== 'object') return null;
  const n = Math.max(0, Math.floor(num(v.n, 0)));
  return n > 0 ? { n, wear: Math.min(0.999, Math.max(0, num(v.wear, 0))) } : null;
}

/**
 * The tool rack. Old saves kept tools per job; those all go onto the one
 * rack, tier by tier, with their wear added up.
 */
function normalizeRack(rack: unknown, legacy: unknown): GameState['rack'] {
  const out: GameState['rack'] = {};
  const add = (tier: (typeof TOOL_TIERS)[number], st: ToolStock | null) => {
    if (!st) return;
    const s = (out[tier] ??= { n: 0, wear: 0 });
    s.n += st.n;
    s.wear += st.wear;
    while (s.wear >= 1 && s.n > 1) {
      s.wear -= 1;
      s.n -= 1;
    }
  };
  if (rack && typeof rack === 'object') for (const t of TOOL_TIERS) add(t, normalizeStock((rack as any)[t]));
  if (legacy && typeof legacy === 'object')
    for (const tiers of Object.values(legacy as Record<string, any>)) if (tiers && typeof tiers === 'object') for (const t of TOOL_TIERS) add(t, normalizeStock(tiers[t]));
  return out;
}

/** Old saves could order tools for one job; that job goes first in line instead. */
function legacyToolFirst(r: any): string | null {
  if (typeof r.toolFirst === 'string') return r.toolFirst;
  if (!Array.isArray(r.forge?.slots)) return null;
  const sl = r.forge.slots.find((x: any) => typeof x?.order === 'string' && x.order.startsWith('tool:'));
  return sl ? sl.order.slice(5) : null;
}

const GEAR_TIERS = ['stone', 'iron', 'steel', 'mithril', 'adamant'];

function normalizeGear(v: any): NamedKobold['gear'] | null {
  if (!v || typeof v !== 'object') return null;
  const out: NonNullable<NamedKobold['gear']> = {};
  for (const slot of ['tool', 'armor', 'trinket'] as const) {
    const p = v[slot];
    if (!p || typeof p !== 'object' || !GEAR_TIERS.includes(p.tier)) continue;
    out[slot] = {
      tier: p.tier,
      marks: Math.max(0, Math.min(3, Math.floor(num(p.marks, 0)))),
      origin: typeof p.origin === 'string' ? p.origin : '',
      ...(typeof p.look === 'string' ? { look: p.look } : {}),
      ...(typeof p.name === 'string' ? { name: p.name } : {}),
    };
  }
  return Object.keys(out).length ? out : null;
}

function normalizeNamed(v: unknown): NamedKobold[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((k) => k && typeof k.name === 'string' && typeof k.job === 'string')
    .map((k) => ({
      id: Math.floor(num(k.id, 0)),
      name: String(k.name).slice(0, 32),
      title: typeof k.title === 'string' ? k.title : '',
      job: k.job,
      loves: typeof k.loves === 'string' ? k.loves : '',
      hates: typeof k.hates === 'string' ? k.hates : '',
      look: Math.floor(num(k.look, 0)),
      traits: strList(k.traits),
      gifts: strList(k.gifts),
      history: Array.isArray(k.history)
        ? k.history.filter((h: any) => h && typeof h.text === 'string').map((h: any) => ({ t: num(h.t, 0), text: String(h.text) }))
        : [],
      lieutenant: k.lieutenant === true,
      ...(typeof k.artWork === 'number' && k.artWork >= 0 ? { artWork: k.artWork } : {}),
      ...(Array.isArray(k.talents)
        ? {
            talents: k.talents
              .filter((x: any) => x && typeof x.job === 'string' && typeof x.name === 'string')
              .map((x: any) => ({ job: x.job, name: x.name, mult: num(x.mult, 1) })),
          }
        : {}),
      ...(typeof k.epithet === 'string' ? { epithet: k.epithet } : {}),
      ...(typeof k.room === 'string' ? { room: k.room } : {}),
      ...(typeof k.restLeft === 'number' && k.restLeft > 0 ? { restLeft: k.restLeft } : {}),
      ...(normalizeGear(k.gear) ? { gear: normalizeGear(k.gear)! } : {}),
    }));
}

function normalizeColonies(v: unknown, now: number): Colony[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((c) => c && typeof c.name === 'string' && c.leader)
    .map((c) => ({
      id: Math.floor(num(c.id, 0)),
      name: c.name,
      leader: normalizeNamed([c.leader])[0],
      pop: num(c.pop, 1),
      founded: num(c.founded, now),
      history: Array.isArray(c.history)
        ? c.history.filter((h: any) => h && typeof h.text === 'string').map((h: any) => ({ t: num(h.t, 0), text: String(h.text) }))
        : [],
      nextEvent: num(c.nextEvent, 3600),
      sent: num(c.sent, 0),
      ...(c.founder && typeof c.founder === 'object'
        ? {
            founder: {
              pull: Math.max(-2, Math.min(2, Math.round(num(c.founder.pull, 0)))),
              green: Math.max(-2, Math.min(2, Math.round(num(c.founder.green, 0)))),
              trade: Math.max(-2, Math.min(2, Math.round(num(c.founder.trade, 0)))),
              ...(['mining', 'shrine', 'stubborn', 'market'].includes(c.founder.knack) ? { knack: c.founder.knack } : {}),
            },
          }
        : {}),
      ...(num(c.heirlooms, 0) > 0 ? { heirlooms: Math.floor(num(c.heirlooms, 0)) } : {}),
    }))
    .filter((c) => c.leader);
}

/** Diggers by room. Older saves had one room being dug: its crew moves there. */
function normalizeDig(r: any, crews: Record<string, Crew>, rooms: Record<string, RoomState>): Record<string, number> {
  const out: Record<string, number> = {};
  if (r.dig && typeof r.dig === 'object')
    for (const [k, n] of Object.entries(r.dig)) {
      const room = k === 'lair' ? 'hoard' : k;
      if (rooms[room]) out[room] = (out[room] ?? 0) + Math.floor(num(n, 0));
    }
  const crewN = crews.digger?.n ?? 0;
  let sum = Object.values(out).reduce((a, b) => a + b, 0);
  if (sum < crewN) {
    const old = r.digging === 'lair' ? 'hoard' : r.digging;
    const target = typeof old === 'string' && rooms[old] ? old : 'den';
    out[target] = (out[target] ?? 0) + crewN - sum;
  }
  sum = Object.values(out).reduce((a, b) => a + b, 0);
  if (sum > crewN) {
    // more on rooms than in the crew: trust the crew, and take the extra off the rooms
    let extra = sum - crewN;
    for (const room of Object.keys(out)) {
      const take = Math.min(extra, out[room]);
      out[room] -= take;
      extra -= take;
    }
  }
  return out;
}

function normalizeDragon(v: any): DragonState {
  const d = newDragon();
  if (!v || typeof v !== 'object') return d;
  const r = v.request;
  const request =
    r && typeof r === 'object' && (r.kind === 'give' || r.kind === 'audience') && typeof r.until === 'number' ? r : null;
  const fed: Record<string, number> = {};
  if (v.fed && typeof v.fed === 'object') for (const [k, n] of Object.entries(v.fed)) fed[k] = num(n, 0);
  return {
    clock: num(v.clock, d.clock),
    craving: typeof v.craving === 'string' ? v.craving : d.craving,
    next: typeof v.next === 'string' ? v.next : d.next,
    changeAt: num(v.changeAt, d.changeAt),
    warned: v.warned === true,
    hungry: v.hungry !== false,
    content: num(v.content, 0),
    granted: Math.floor(num(v.granted, 0)),
    favor: Math.floor(num(v.favor, 0)),
    boons: Math.min(3, Math.floor(num(v.boons, 0))),
    boosts: Array.isArray(v.boosts)
      ? v.boosts.filter((b: any) => b && typeof b.job === 'string' && typeof b.until === 'number').map((b: any) => ({ job: b.job, until: b.until }))
      : [],
    request,
    nextRequestAt: num(v.nextRequestAt, d.nextRequestAt),
    fed,
    traits: strList(v.traits),
    size: num(v.size, 0),
    trained: { might: num(v.trained?.might, 0), fire: num(v.trained?.fire, 0), presence: num(v.trained?.presence, 0) },
    raid:
      v.raid && typeof v.raid.target === 'string' && typeof v.raid.until === 'number'
        ? { target: v.raid.target, until: v.raid.until, rider: typeof v.raid.rider === 'number' ? v.raid.rider : null, ...(v.raid.blessed === true ? { blessed: true } : {}) }
        : null,
    nextRaidAt: num(v.nextRaidAt, 0),
    raided: Object.fromEntries(Object.entries(v.raided && typeof v.raided === 'object' ? v.raided : {}).map(([k, n]) => [k, Math.floor(num(n, 0))])),
  };
}

/** Fill in defaults and drop junk, so small shape changes need no migration. */
/** Points per project. Older saves had one shared pool; it goes to the project that was current. */
function normalizeProgress(raw: any, current: any): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof raw === 'number') {
    if (typeof current === 'string' && raw > 0) out[current] = raw;
    return out;
  }
  if (raw && typeof raw === 'object')
    for (const [id, v] of Object.entries(raw)) if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[id] = v;
  return out;
}

/**
 * There are no scouts any more: gatherers with no room to work look for more
 * places themselves. Old saves send their scouts (crowd and named) back to idle.
 * Works on a copy.
 */
function retireScouts(raw: Record<string, any>): Record<string, any> {
  if (!JSON.stringify(raw).includes('"scout"')) return raw;
  const r = JSON.parse(JSON.stringify(raw));
  if (r.crews?.scout) {
    r.idle = Math.floor(num(r.idle, 0)) + Math.floor(num(r.crews.scout?.n, 0));
    delete r.crews.scout;
  }
  if (r.newcomerJob === 'scout') r.newcomerJob = 'idle';
  if (Array.isArray(r.named)) for (const k of r.named) if (k && k.job === 'scout') k.job = 'idle';
  if (r.toolFirst === 'scout') r.toolFirst = null;
  if (Array.isArray(r.dragon?.boosts)) r.dragon.boosts = r.dragon.boosts.filter((b: any) => b?.job !== 'scout');
  return r;
}

/**
 * Quarriers and miners became one Miner job. Old saves move quarriers (crews,
 * named kobolds, talents, tools, orders) over to miners. Works on a copy.
 */
function mergeQuarriers(raw: Record<string, any>): Record<string, any> {
  if (!JSON.stringify(raw).includes('"quarrier"') && !JSON.stringify(raw).includes('tool:quarrier')) return raw;
  const r = JSON.parse(JSON.stringify(raw));
  const job = (j: unknown) => (j === 'quarrier' ? 'miner' : j);
  if (r.crews?.quarrier) {
    const n = (r.crews.quarrier?.n ?? 0) + (r.crews.miner?.n ?? 0);
    r.crews.miner = { ...(r.crews.miner ?? {}), n };
    delete r.crews.quarrier;
  }
  r.newcomerJob = job(r.newcomerJob);
  const kobold = (k: any) => {
    if (!k || typeof k !== 'object') return;
    k.job = job(k.job);
    k.loves = job(k.loves);
    k.hates = job(k.hates);
    if (k.hates === k.loves) k.hates = 'digger';
    if (Array.isArray(k.talents)) for (const t of k.talents) if (t) t.job = job(t.job);
  };
  if (Array.isArray(r.named)) r.named.forEach(kobold);
  if (Array.isArray(r.colonies)) for (const c of r.colonies) kobold(c?.leader);
  if (r.tools?.quarrier && typeof r.tools.quarrier === 'object') {
    const into = (r.tools.miner ??= {});
    for (const [tier, t] of Object.entries<any>(r.tools.quarrier)) {
      const a = into[tier];
      const n = (a?.n ?? 0) + (t?.n ?? 0);
      into[tier] = { n, wear: n > 0 ? ((a?.wear ?? 0) * (a?.n ?? 0) + (t?.wear ?? 0) * (t?.n ?? 0)) / n : 0 };
    }
    delete r.tools.quarrier;
  }
  if (Array.isArray(r.forge?.slots)) for (const sl of r.forge.slots) if (sl?.order === 'tool:quarrier') sl.order = 'tool:miner';
  if (r.dragon) {
    if (r.dragon.request) r.dragon.request.job = job(r.dragon.request.job);
    if (Array.isArray(r.dragon.boosts)) for (const b of r.dragon.boosts) if (b) b.job = job(b.job);
  }
  return r;
}

export function normalize(raw: unknown, now: number): GameState {
  const base = newGame(now);
  if (!raw || typeof raw !== 'object') throw new SaveError('Save has no game state');
  const r = retireScouts(mergeQuarriers(raw as Record<string, any>));
  const res = { ...base.res };
  for (const d of RESOURCES) res[d.id] = num(r.res?.[d.id], 0);
  const crews = normalizeCrews(r.crews);
  const rooms = normalizeRooms(r.rooms, base.rooms);
  const state: GameState = {
    res,
    totalEarned: num(r.totalEarned, base.totalEarned),
    idle: Math.floor(num(r.idle, 0)),
    crews,
    newcomerJob: typeof r.newcomerJob === 'string' ? r.newcomerJob : base.newcomerJob,
    rooms,
    dig: normalizeDig(r, crews, rooms),
    stage: Math.floor(num(r.stage, 0)),
    lastTick: num(r.lastTick, now),
    createdAt: num(r.createdAt, now),
    settings: {
      motion: r.settings?.motion === 'low' ? 'low' : 'normal',
      goal: r.settings?.goal !== false,
    },
    chief: normalizeChief(r.chief),
    chronicle: normalizeChronicle(r.chronicle),
    arrivalProgress: num(r.arrivalProgress, 0),
    oddities: normalizeOddities(r.oddities),
    research: {
      done: strList(r.research?.done),
      current: typeof r.research?.current === 'string' ? r.research.current : r.research?.current === null ? null : base.research.current,
      progress: normalizeProgress(r.research?.progress, r.research?.current),
    },
    named: normalizeNamed(r.named),
    nextNamedId: Math.max(1, Math.floor(num(r.nextNamedId, 1)), ...normalizeNamed(r.named).map((k) => k.id + 1)),
    herd: typeof r.herd === 'string' ? r.herd : base.herd,
    herdSettle: num(r.herdSettle, 0),
    recipe: typeof r.recipe === 'string' ? r.recipe : base.recipe,
    dragon: normalizeDragon(r.dragon),
    art: {
      pieces: Array.isArray(r.art?.pieces)
        ? r.art.pieces
            .filter((p: any) => p && typeof p.title === 'string')
            .map((p: any) => ({ id: Math.floor(num(p.id, 0)), title: p.title, by: typeof p.by === 'string' ? p.by : '', material: String(p.material ?? ''), appeal: num(p.appeal, 0), t: num(p.t, now) }))
        : [],
      nextId: Math.max(1, Math.floor(num(r.art?.nextId, 1))),
    },
    colonies: normalizeColonies(r.colonies, now),
    nextColonyId: Math.max(1, Math.floor(num(r.nextColonyId, 1)), ...normalizeColonies(r.colonies, now).map((c) => c.id + 1)),
    chiefMarks: {
      oddities: Math.floor(num(r.chiefMarks?.oddities, 0)),
      events: strList(r.chiefMarks?.events),
      pending: Math.floor(num(r.chiefMarks?.pending, 0)),
    },
    forge: {
      slots: normalizeSlots(r.forge?.slots),
      commissions: (Array.isArray(r.forge?.commissions) ? r.forge.commissions : [])
        .filter((c: any) => c && Number.isInteger(c.kobold) && ['tool', 'armor', 'trinket'].includes(c.slot))
        .map((c: any) => ({ kobold: c.kobold, slot: c.slot })),
      toolUse: Object.fromEntries(
        Object.entries(r.forge?.toolUse && typeof r.forge.toolUse === 'object' ? r.forge.toolUse : {}).filter(([k, v]) => RESOURCES.some((d) => d.id === k) && typeof v === 'number' && Number.isFinite(v) && v >= 0),
      ),
    },
    rack: normalizeRack(r.rack, r.tools),
    toolFirst: ((j) => (j && JOBS.some((d) => d.id === j) ? j : null))(legacyToolFirst(r)),
    gems: Object.fromEntries(Object.entries(r.gems && typeof r.gems === 'object' ? r.gems : {}).filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v > 0)) as Record<string, number>,
    discovered: strList(r.discovered),
    hunt: normalizeHunt(r.hunt),
    magic: normalizeMagic(r.magic, r.oddities),
    explore: normalizeExplore(r.explore),
    losses: {
      acc: Object.fromEntries(Object.entries(r.losses?.acc && typeof r.losses.acc === 'object' ? r.losses.acc : {}).filter(([, n]) => typeof n === 'number' && Number.isFinite(n))) as Record<string, number>,
      idleFor: num(r.losses?.idleFor, 0),
      wanderAcc: num(r.losses?.wanderAcc, 0),
      died: Math.floor(num(r.losses?.died, 0)),
      wandered: Math.floor(num(r.losses?.wandered, 0)),
    },
    seed: Number.isInteger(r.seed) ? r.seed : base.seed,
  };
  // saves from before areas: find enough for them that nothing they made drops
  if (!r.explore || typeof r.explore !== 'object') legacyAreas(state);
  return state;
}

const KIND_IDS = ['wood', 'stone', 'copper', 'monsters'] as const;

function normalizeExplore(v: any): ExploreState {
  const base = newExplore();
  if (!v || typeof v !== 'object') return { ...base, found: [] };
  const nums = (o: any) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).filter(([, n]) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) as Record<string, number>;
  const found = strList(v.found).filter((id, i, a) => areaDef(id) && a.indexOf(id) === i);
  if (!found.includes('near-tunnels')) found.unshift('near-tunnels');
  const pick = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).filter(([k]) => (KIND_IDS as readonly string[]).includes(k)));
  return {
    target: (KIND_IDS as readonly string[]).includes(v.target) ? v.target : v.target === null ? null : base.target,
    points: pick(nums(v.points)),
    found,
    names: Object.fromEntries(Object.entries(v.names && typeof v.names === 'object' ? v.names : {}).filter(([k, n]) => areaDef(k) && typeof n === 'string')) as Record<string, string>,
    bonus: pick(nums(v.bonus)),
    progress: Object.fromEntries(Object.entries(nums(v.progress)).filter(([k]) => areaDef(k))),
  };
}

function normalizeMagic(v: any, oddities: any): MagicState {
  const base = newMagic();
  // scales and skins from before magic existed count as ground already, so an old save doesn't get a pile of dust
  const seen = Math.floor(num(oddities?.['shed-scales']?.count, 0) + num(oddities?.['shed-skins']?.count, 0));
  if (!v || typeof v !== 'object') return { ...base, ground: seen };
  return {
    bones: num(v.bones, 0),
    dust: num(v.dust, 0),
    mana: num(v.mana, 0),
    ground: Math.floor(num(v.ground, seen)),
    blessed: v.blessed === true,
    stoneSong: num(v.stoneSong, 0),
    vision: num(v.vision, 0),
    charms: Math.floor(num(v.charms, 0)),
    nextSpellAt: num(v.nextSpellAt, 0),
  };
}

function normalizeHunt(v: any): HuntState {
  const base = newHunt();
  if (!v || typeof v !== 'object') return base;
  const counts = (o: any) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).filter(([, n]) => typeof n === 'number' && Number.isFinite(n) && n > 0)) as Record<string, number>;
  const meat: HuntState['meat'] = {};
  for (const [k, m] of Object.entries(v.meat && typeof v.meat === 'object' ? v.meat : {}))
    if (m && typeof m === 'object') meat[k] = { wild: num((m as any).wild, 0), farmed: num((m as any).farmed, 0) };
  return {
    hunted: counts(v.hunted),
    meat,
    eatClock: num(v.eatClock, 0),
  };
}

export function serialize(state: GameState, now: number): string {
  const file: SaveFile = { version: SAVE_VERSION, savedAt: now, state };
  return JSON.stringify(file);
}

export function deserialize(text: string, now: number): GameState {
  let file: SaveFile;
  try {
    file = JSON.parse(text);
  } catch {
    throw new SaveError('Save is not valid JSON');
  }
  if (!file || typeof file !== 'object' || !('version' in file)) throw new SaveError('Not an Idle Hoard save');
  return normalize(migrate(file.state, file.version), now);
}

export type LoadResult =
  | { kind: 'new'; state: GameState }
  | { kind: 'loaded'; state: GameState; migratedFrom?: number }
  | { kind: 'error'; state: GameState; error: string };

/**
 * Load the save. If it needs migrating, the original text is copied to
 * BACKUP_KEY first. If it can't be read, its text is copied to UNREADABLE_KEY
 * (so nothing is lost) and a new game starts.
 */
export function load(store: KeyValueStore, now: number): LoadResult {
  const text = store.get(SAVE_KEY);
  if (!text) return { kind: 'new', state: newGame(now) };
  try {
    const version = JSON.parse(text)?.version;
    const state = deserialize(text, now);
    if (version !== SAVE_VERSION) {
      store.set(BACKUP_KEY, text);
      return { kind: 'loaded', state, migratedFrom: version };
    }
    return { kind: 'loaded', state };
  } catch (e) {
    store.set(UNREADABLE_KEY, text);
    return { kind: 'error', state: newGame(now), error: (e as Error).message };
  }
}

export function write(store: KeyValueStore, state: GameState, now: number) {
  store.set(SAVE_KEY, serialize(state, now));
}

// Export strings are base64 so they paste cleanly into chat or a text file.
export function exportSave(state: GameState, now: number): string {
  const bytes = new TextEncoder().encode(serialize(state, now));
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

export function importSave(text: string, now: number): GameState {
  const trimmed = text.trim();
  // accept raw JSON too
  if (trimmed.startsWith('{')) return deserialize(trimmed, now);
  let json: string;
  try {
    const bin = atob(trimmed);
    json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    throw new SaveError('That does not look like an exported save');
  }
  return deserialize(json, now);
}

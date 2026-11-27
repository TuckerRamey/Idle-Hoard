// Versioned saves.
//
// A save on disk looks like { version: N, savedAt: <ms>, state: {...} }.
// When the shape of GameState changes in a way that `normalize` can't paper
// over (renaming a field, changing units, splitting a currency...):
//   1. bump SAVE_VERSION
//   2. add MIGRATIONS[oldVersion] that turns an oldVersion state into the next one
//   3. add a test in tests/save.test.ts with a real old save
// Adding a new optional field or a new worker does NOT need a migration;
// `normalize` fills in defaults.

import { QUIRKS, type Chief } from './chief';
import { CHRONICLE_MAX, newGame, type ChronicleEntry, type GameState } from './state';

export const SAVE_VERSION = 1;
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
  // Example for the future:
  // 1: (s) => ({ ...s, gems: 0 }),
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

function normalizeChronicle(v: unknown): ChronicleEntry[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((e) => e && typeof e.text === 'string')
    .map((e) => ({ t: num(e.t, 0), text: String(e.text) }))
    .slice(-CHRONICLE_MAX);
}

/** Fill in defaults and drop junk, so small shape changes need no migration. */
export function normalize(raw: unknown, now: number): GameState {
  const base = newGame(now);
  if (!raw || typeof raw !== 'object') throw new SaveError('Save has no game state');
  const r = raw as Record<string, any>;
  const workers: Record<string, number> = {};
  if (r.workers && typeof r.workers === 'object')
    for (const [k, v] of Object.entries(r.workers)) workers[k] = Math.floor(num(v, 0));
  return {
    copper: num(r.copper, base.copper),
    totalEarned: num(r.totalEarned, base.totalEarned),
    workers: r.workers ? workers : base.workers,
    upgrades: strList(r.upgrades),
    stage: Math.floor(num(r.stage, 0)),
    lastTick: num(r.lastTick, now),
    createdAt: num(r.createdAt, now),
    settings: {
      motion: r.settings?.motion === 'low' ? 'low' : 'normal',
    },
    chief: normalizeChief(r.chief),
    skills: strList(r.skills),
    chronicle: normalizeChronicle(r.chronicle),
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

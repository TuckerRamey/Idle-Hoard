import { describe, expect, it } from 'vitest';
import {
  BACKUP_KEY,
  SAVE_KEY,
  SAVE_VERSION,
  SaveError,
  UNREADABLE_KEY,
  deserialize,
  exportSave,
  importSave,
  load,
  migrate,
  serialize,
  write,
  type KeyValueStore,
} from '../src/game/save';
import { newGame } from '../src/game/state';

const T0 = 1_700_000_000_000;

function memoryStore(init: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...init };
  return { data, get: (k) => data[k] ?? null, set: (k, v) => void (data[k] = v) };
}

describe('save round trip', () => {
  it('serializes and loads the same state', () => {
    const s = newGame(T0);
    s.copper = 123.5;
    s.workers.digger = 4;
    s.upgrades.push('bigger-pockets');
    s.settings.motion = 'low';
    expect(deserialize(serialize(s, T0), T0)).toEqual(s);
  });

  it('export/import round trips, and import accepts raw JSON too', () => {
    const s = newGame(T0);
    s.copper = 42;
    expect(importSave(exportSave(s, T0), T0)).toEqual(s);
    expect(importSave(serialize(s, T0), T0)).toEqual(s);
  });

  it('rejects garbage with a readable error', () => {
    expect(() => importSave('not a save', T0)).toThrow(SaveError);
    expect(() => deserialize('{"hello":1}', T0)).toThrow(SaveError);
  });

  it('fills in defaults for missing fields (no migration needed for additions)', () => {
    const text = JSON.stringify({ version: SAVE_VERSION, savedAt: T0, state: { copper: 5 } });
    const s = deserialize(text, T0);
    expect(s.copper).toBe(5);
    expect(s.workers.scavenger).toBe(1);
    expect(s.settings.motion).toBe('normal');
    expect(s.upgrades).toEqual([]);
  });

  it('keeps unknown worker ids instead of dropping them', () => {
    const text = JSON.stringify({ version: SAVE_VERSION, savedAt: T0, state: { workers: { scavenger: 2, futureThing: 3 } } });
    expect(deserialize(text, T0).workers).toEqual({ scavenger: 2, futureThing: 3 });
  });

  it('cleans bad numbers', () => {
    const text = JSON.stringify({ version: SAVE_VERSION, savedAt: T0, state: { copper: -5, totalEarned: 'lots' } });
    const s = deserialize(text, T0);
    expect(s.copper).toBe(0);
    expect(s.totalEarned).toBe(0);
  });
});

describe('migrate', () => {
  const migrations = {
    1: (s: any) => ({ ...s, gold: s.gold * 100, copper: undefined }),
    2: (s: any) => ({ ...s, renamed: s.gold }),
  };

  it('runs each migration in order from the save version', () => {
    expect(migrate({ gold: 2 }, 1, 3, migrations)).toEqual({ gold: 200, copper: undefined, renamed: 200 });
    expect(migrate({ gold: 2 }, 2, 3, migrations)).toEqual({ gold: 2, renamed: 2 });
  });

  it('does nothing when already current', () => {
    const s = { a: 1 };
    expect(migrate(s, 3, 3, migrations)).toBe(s);
  });

  it('refuses saves from a newer game version', () => {
    expect(() => migrate({}, 4, 3, migrations)).toThrow(/newer version/);
  });

  it('refuses when a migration step is missing', () => {
    expect(() => migrate({}, 1, 3, { 2: (s: any) => s })).toThrow(/No migration from save version 1/);
  });

  it('has a migration for every version below the current one', () => {
    expect(() => migrate({}, 1)).not.toThrow();
  });
});

describe('load / write', () => {
  it('starts a new game when there is no save', () => {
    expect(load(memoryStore(), T0).kind).toBe('new');
  });

  it('loads what write stored', () => {
    const store = memoryStore();
    const s = newGame(T0);
    s.copper = 77;
    write(store, s, T0);
    const r = load(store, T0);
    expect(r.kind).toBe('loaded');
    expect(r.state.copper).toBe(77);
  });

  it('keeps an unreadable save instead of losing it', () => {
    const store = memoryStore({ [SAVE_KEY]: '{broken' });
    const r = load(store, T0);
    expect(r.kind).toBe('error');
    expect(store.data[UNREADABLE_KEY]).toBe('{broken');
  });

  it('keeps a newer-version save as unreadable rather than overwriting it silently', () => {
    const future = JSON.stringify({ version: SAVE_VERSION + 1, savedAt: T0, state: {} });
    const store = memoryStore({ [SAVE_KEY]: future });
    expect(load(store, T0).kind).toBe('error');
    expect(store.data[UNREADABLE_KEY]).toBe(future);
    expect(store.data[BACKUP_KEY]).toBeUndefined();
  });
});

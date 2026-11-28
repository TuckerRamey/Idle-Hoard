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
    s.res.copper = 123.5;
    s.res.wood = 7;
    s.crews.digger = { n: 4 };
    s.dig = { den: 4 };
    s.idle = 2;
    s.rooms.den = { volume: 123.5 };
    s.settings.motion = 'low';
    expect(deserialize(serialize(s, T0), T0)).toEqual(s);
  });

  it('export/import round trips, and import accepts raw JSON too', () => {
    const s = newGame(T0);
    s.res.copper = 42;
    expect(importSave(exportSave(s, T0), T0)).toEqual(s);
    expect(importSave(serialize(s, T0), T0)).toEqual(s);
  });

  it('rejects garbage with a readable error', () => {
    expect(() => importSave('not a save', T0)).toThrow(SaveError);
    expect(() => deserialize('{"hello":1}', T0)).toThrow(SaveError);
  });

  it('fills in defaults for missing fields (no migration needed for additions)', () => {
    const text = JSON.stringify({ version: SAVE_VERSION, savedAt: T0, state: { res: { copper: 5 } } });
    const s = deserialize(text, T0);
    expect(s.res).toEqual({ copper: 5, silver: 0, gold: 0, wood: 0, stone: 0, ore: 0, bars: 0, steel: 0, mithril: 0, adamant: 0, meat: 0 });
    expect(s.named).toEqual([]);
    expect(s.research.done).toEqual([]);
    expect(s.dragon.request).toBeNull();
    expect(s.crews).toEqual({});
    expect(s.rooms.hoard).toEqual({ volume: 100 });
    expect(s.forge.slots).toEqual([]);
    expect(s.rack).toEqual({});
    expect(s.toolFirst).toBeNull();
    expect(s.dig).toEqual({});
    expect(s.newcomerJob).toBe('scavenger');
    expect(s.chief).toBeNull();
    expect(s.chronicle).toEqual([]);
    expect(s.settings.motion).toBe('normal');
  });

  it('keeps unknown job and room ids instead of dropping them', () => {
    const text = JSON.stringify({
      version: SAVE_VERSION,
      savedAt: T0,
      state: { crews: { scavenger: { n: 2 }, futureJob: { n: 3 } }, rooms: { vault: { volume: 70 } } },
    });
    const s = deserialize(text, T0);
    expect(s.crews).toEqual({ scavenger: { n: 2 }, futureJob: { n: 3 } });
    expect(s.rooms.vault).toEqual({ volume: 70 });
    expect(s.rooms.den).toEqual({ volume: 40 });
  });

  it('cleans bad numbers', () => {
    const text = JSON.stringify({ version: SAVE_VERSION, savedAt: T0, state: { res: { copper: -5 }, totalEarned: 'lots', idle: NaN } });
    const s = deserialize(text, T0);
    expect(s.res.copper).toBe(0);
    expect(s.idle).toBe(0);
    expect(s.totalEarned).toBe(0);
  });
});

describe('saves from version 1 (the job ladder)', () => {
  const v1 = {
    version: 1,
    savedAt: T0,
    state: {
      copper: 5000,
      totalEarned: 90_000,
      workers: { scavenger: 12, digger: 4, hauler: 1 },
      upgrades: ['bigger-pockets'],
      stage: 1,
      lastTick: T0,
      createdAt: T0 - 86_400_000,
      settings: { motion: 'low' },
      chief: { name: 'Snik', cunning: 1, voice: 2, nerve: 3, quirk: 'packmule' },
      skills: ['crack-the-whip'],
      chronicle: [{ t: T0, text: 'Snik found an egg.' }],
      arrivalProgress: 4,
      oddities: { kogoat: { count: 1, firstAt: T0 } },
    },
  };

  it('starts the warren over but keeps the Chief, chronicle, oddities and settings', () => {
    const s = deserialize(JSON.stringify(v1), T0);
    expect(s.chief).toEqual({ name: 'Snik', cunning: 1, voice: 2, nerve: 3, quirk: 'packrat' });
    expect(s.chronicle).toEqual(v1.state.chronicle);
    expect(s.oddities).toEqual(v1.state.oddities);
    expect(s.settings.motion).toBe('low');
    expect(s.createdAt).toBe(v1.state.createdAt);
    expect(s.res.copper).toBe(0);
    expect(s.totalEarned).toBe(0);
    expect(s.stage).toBe(0);
    expect(s.crews).toEqual({});
    expect((s as any).upgrades).toBeUndefined();
    expect((s as any).workers).toBeUndefined();
    expect((s as any).skills).toBeUndefined();
  });

  it('keeps a backup of the old save when loading it', () => {
    const text = JSON.stringify(v1);
    const store = memoryStore({ [SAVE_KEY]: text });
    const r = load(store, T0);
    expect(r.kind === 'loaded' && r.migratedFrom).toBe(1);
    expect(store.data[BACKUP_KEY]).toBe(text);
  });

  it('a version 1 save with no Chief still loads', () => {
    const s = deserialize(JSON.stringify({ version: 1, savedAt: T0, state: { copper: 50, workers: { scavenger: 3 } } }), T0);
    expect(s.chief).toBeNull();
    expect(s.idle).toBe(0);
  });

  it('round trips a Chief and chronicle, and cleans a bad Chief', () => {
    const s = newGame(T0);
    s.chief = { name: 'Snik', cunning: 1, voice: 2, nerve: 3, quirk: 'packrat' };
    s.chronicle = [{ t: T0, text: 'Snik found an egg.' }];
    expect(deserialize(serialize(s, T0), T0)).toEqual(s);
    const bad = JSON.stringify({ version: SAVE_VERSION, savedAt: T0, state: { chief: { name: '   ' } } });
    expect(deserialize(bad, T0).chief).toBeNull();
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
    s.res.copper = 77;
    write(store, s, T0);
    const r = load(store, T0);
    expect(r.kind).toBe('loaded');
    expect(r.state.res.copper).toBe(77);
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

describe('saves from version 2 (rooms by size, one storehouse)', () => {
  it('starts the warren over but keeps the Chief, chronicle, oddities and settings', () => {
    const v2 = {
      version: 2,
      savedAt: T0,
      state: {
        res: { copper: 5000, wood: 10, stone: 10, iron: 4, meat: 2 },
        rooms: { storehouse: { size: 3, progress: 0 } },
        chief: { name: 'Snik', cunning: 1, voice: 2, nerve: 3, quirk: 'packrat' },
        chronicle: [{ t: T0, text: 'The dragon molted.' }],
        oddities: { kogoat: { count: 1, firstAt: T0 } },
        settings: { motion: 'low' },
        stage: 2,
      },
    };
    const store = memoryStore({ [SAVE_KEY]: JSON.stringify(v2) });
    const r = load(store, T0);
    expect(r.kind === 'loaded' && r.migratedFrom).toBe(2);
    const s = r.state;
    expect(s.chief?.name).toBe('Snik');
    expect(s.chronicle).toEqual(v2.state.chronicle);
    expect(s.oddities).toEqual(v2.state.oddities);
    expect(s.settings.motion).toBe('low');
    expect(s.stage).toBe(0);
    expect(s.res.copper).toBe(0);
    expect(s.rooms.storehouse).toBeUndefined();
    expect(store.data[BACKUP_KEY]).toBe(JSON.stringify(v2));
  });
});

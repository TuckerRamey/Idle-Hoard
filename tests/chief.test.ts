import { describe, expect, it } from 'vitest';
import { QUIRKS, rollChief, STAT_POINTS, type Chief } from '../src/game/chief';
import { appeal, capacity, chiefRate, incomePerSecond, production } from '../src/game/economy';
import { happen, HAPPENINGS } from '../src/game/happenings';
import { CHRONICLE_MAX, addChronicle, newGame } from '../src/game/state';
import { CONFIG } from '../src/game/data';

const T0 = 1_700_000_000_000;
const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length];
};
const plain: Chief = { name: 'Snik', cunning: 2, voice: 2, nerve: 2, quirk: 'goat-whisperer' /* no effect */ };

describe('rolling a Chief', () => {
  it('always spends exactly the same stat points, at least 1 each', () => {
    for (let i = 0; i < 200; i++) {
      const c = rollChief(Math.random);
      expect(c.cunning + c.voice + c.nerve).toBe(STAT_POINTS);
      expect(Math.min(c.cunning, c.voice, c.nerve)).toBeGreaterThanOrEqual(1);
      expect(QUIRKS.some((q) => q.id === c.quirk)).toBe(true);
    }
  });

  it('keeps a given name when rerolling traits', () => {
    expect(rollChief(seq(0.1, 0.5, 0.9), 'Tazz').name).toBe('Tazz');
  });
});

describe('the Chief in the economy', () => {
  it('hauls copper personally once they exist', () => {
    const s = newGame(T0);
    expect(chiefRate(s)).toBe(0);
    s.chief = { ...plain, nerve: 0 };
    expect(chiefRate(s)).toBe(CONFIG.chiefRate);
  });

  it('Nerve raises income 5% per point', () => {
    const s = newGame(T0);
    s.chief = { ...plain, nerve: 0 };
    const base = incomePerSecond(s);
    s.chief.nerve = 4;
    expect(incomePerSecond(s)).toBeCloseTo(base * 1.2);
  });

  it('a job quirk boosts only that job', () => {
    const s = newGame(T0);
    s.chief = { ...plain, nerve: 0 };
    s.crews.quarrier = { n: 10, exp: 0 };
    s.crews.scavenger = { n: 10, exp: 0 };
    const before = production(s);
    s.chief.quirk = 'stonecutter';
    const after = production(s);
    expect(after.stone).toBeCloseTo(before.stone * 1.25);
    expect(after.copper).toBeCloseTo(before.copper);
  });

  it('Silver-tongued draws kobolds and Packrat makes rooms hold more', () => {
    const s = newGame(T0);
    s.chief = { ...plain };
    const a = appeal(s);
    const cap = capacity(s, 'copper');
    s.chief.quirk = 'silver-tongued';
    expect(appeal(s)).toBeCloseTo(a * 1.25);
    s.chief.quirk = 'packrat';
    expect(capacity(s, 'copper')).toBe(Math.floor(cap * 1.25));
  });
});

describe('chronicle and happenings', () => {
  it('keeps only the newest entries', () => {
    const s = newGame(T0);
    for (let i = 0; i < CHRONICLE_MAX + 10; i++) addChronicle(s, T0 + i, `line ${i}`);
    expect(s.chronicle).toHaveLength(CHRONICLE_MAX);
    expect(s.chronicle.at(-1)!.text).toBe(`line ${CHRONICLE_MAX + 9}`);
  });

  it('happenings wait for a Chief, then add a filled-in line and any reward', () => {
    const s = newGame(T0);
    expect(happen(s, T0, Math.random)).toBeNull();
    s.chief = { ...plain, nerve: 0 };
    const h = happen(s, T0, seq(0))!;
    expect(h).not.toBeNull();
    const line = s.chronicle.at(-1)!.text;
    expect(line).not.toMatch(/\{chief\}|\{kobold\}/);
    expect(s.res.copper).toBeCloseTo(h.rewardSeconds * CONFIG.chiefRate);
  });

  it('only picks happenings that fit the warren', () => {
    const s = newGame(T0);
    s.chief = plain;
    for (let i = 0; i < 50; i++) {
      const h = happen(s, T0, Math.random)!;
      const def = HAPPENINGS.find((x) => x.id === h.id)!;
      expect(def.needsJob).toBeUndefined();
      expect(def.minStage ?? 0).toBe(0);
    }
  });
});

describe('oddities', () => {
  it('a one-off oddity is found once, a stacking one keeps counting', () => {
    const s = newGame(T0);
    s.chief = plain;
    for (let i = 0; i < 400; i++) happen(s, T0 + i, Math.random);
    expect(s.oddities.kogoat?.count).toBe(1);
    expect(s.oddities.lanterns.count).toBeGreaterThan(25);
    expect(s.chronicle.filter((e) => e.text.includes('Kogoat')).length).toBeLessThanOrEqual(1);
  });

  it('the Kogoat lifts morale', () => {
    const s = newGame(T0);
    s.chief = { ...plain, nerve: 0 };
    const before = incomePerSecond(s);
    s.oddities.kogoat = { count: 1, firstAt: T0 };
    expect(incomePerSecond(s)).toBeCloseTo(before * 1.02);
  });
});

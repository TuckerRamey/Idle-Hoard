import { describe, expect, it } from 'vitest';
import { QUIRKS, rollChief, SKILLS, STAT_POINTS, type Chief } from '../src/game/chief';
import { WORKERS } from '../src/game/data';
import {
  canLearn,
  chiefRate,
  incomePerSecond,
  learnSkill,
  offlineCap,
  skillPointsEarned,
  skillPointsFree,
  workerCost,
} from '../src/game/economy';
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

  it('Voice and quirks make kobolds cheaper', () => {
    const s = newGame(T0);
    const scav = WORKERS[0];
    const full = workerCost(s, scav);
    s.chief = { ...plain, voice: 4 };
    expect(workerCost(s, scav)).toBe(Math.ceil(scav.baseCost * 0.88));
    s.chief.quirk = 'silver-tongued';
    expect(workerCost(s, scav)).toBeLessThan(full * 0.88);
  });

  it('a worker quirk boosts only that worker', () => {
    const s = newGame(T0);
    s.chief = { ...plain, nerve: 0 };
    s.workers.digger = 10;
    const before = incomePerSecond(s);
    s.chief.quirk = 'stonecutter';
    const digRate = WORKERS.find((w) => w.id === 'digger')!.rate * 10;
    expect(incomePerSecond(s)).toBeCloseTo(before + digRate * 0.25);
  });
});

describe('renown and skills', () => {
  it('earns no points before the Chief exists or before 100 renown', () => {
    const s = newGame(T0);
    s.totalEarned = 1e6;
    expect(skillPointsEarned(s)).toBe(0);
    s.chief = { ...plain, cunning: 0 };
    s.totalEarned = 99;
    expect(skillPointsEarned(s)).toBe(0);
  });

  it('gives a point at 100, 500, 2500... renown, plus one per dragon stage', () => {
    const s = newGame(T0);
    s.chief = { ...plain, cunning: 0 };
    s.totalEarned = 100;
    expect(skillPointsEarned(s)).toBe(1);
    s.totalEarned = 2500;
    expect(skillPointsEarned(s)).toBe(3);
    s.stage = 2;
    expect(skillPointsEarned(s)).toBe(5);
  });

  it('Cunning speeds renown', () => {
    const s = newGame(T0);
    s.chief = { ...plain, cunning: 0 };
    s.totalEarned = 400;
    expect(skillPointsEarned(s)).toBe(1);
    s.chief.cunning = 3; // 400 × 1.3 = 520 renown
    expect(skillPointsEarned(s)).toBe(2);
  });

  it('learning spends points and respects prerequisites', () => {
    const s = newGame(T0);
    s.chief = { ...plain, cunning: 0 };
    s.totalEarned = 500; // 2 points
    const night = SKILLS.find((x) => x.id === 'night-shifts')!;
    expect(canLearn(s, night)).toBe(false); // needs Crack the whip
    expect(learnSkill(s, 'crack-the-whip')).toBe(true);
    expect(learnSkill(s, 'night-shifts')).toBe(true);
    expect(skillPointsFree(s)).toBe(0);
    expect(learnSkill(s, 'bulk-recruiting')).toBe(false);
    expect(offlineCap(s)).toBe(CONFIG.offlineCapSeconds + 12 * 3600);
  });

  it('cannot learn the same skill twice', () => {
    const s = newGame(T0);
    s.chief = plain;
    s.totalEarned = 1e9;
    expect(learnSkill(s, 'crack-the-whip')).toBe(true);
    expect(learnSkill(s, 'crack-the-whip')).toBe(false);
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
    expect(s.copper).toBeCloseTo(h.rewardSeconds * CONFIG.chiefRate);
  });

  it('only picks happenings that fit the warren', () => {
    const s = newGame(T0);
    s.chief = plain;
    for (let i = 0; i < 50; i++) {
      const h = happen(s, T0, Math.random)!;
      const def = HAPPENINGS.find((x) => x.id === h.id)!;
      expect(def.needsWorker).toBeUndefined();
      expect(def.minStage ?? 0).toBe(0);
    }
  });
});

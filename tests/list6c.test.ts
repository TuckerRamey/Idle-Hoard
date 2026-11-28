// List 6, part C: shamans, mana, rituals, and the old dragon's own spells.
import { describe, expect, it } from 'vitest';
import type { Chief } from '../src/game/chief';
import { cravingHintSeconds, DIET } from '../src/game/dragon';
import { assign, jobDef, jobMultiplier, jobOpen } from '../src/game/economy';
import { findStep } from '../src/game/finds';
import { HUNT, huntStep } from '../src/game/hunting';
import { MAGIC, magicStep, performRitual, ritualBlocked, ritualDef } from '../src/game/magic';
import { raidStep, raidTarget } from '../src/game/raids';
import { canResearch, researchDef } from '../src/game/research';
import { normalize } from '../src/game/save';
import { newGame, rng, type GameState } from '../src/game/state';

const T0 = 1_700_000_000_000;
const chief: Chief = { name: 'Snik', cunning: 0, voice: 0, nerve: 0, quirk: 'none' };

function game(stage = 2): GameState {
  const s = newGame(T0);
  s.chief = { ...chief };
  s.newcomerJob = 'idle';
  s.seed = 321;
  s.stage = stage;
  s.research.done.push('crab-wrangling', 'monster-tracking');
  s.dragon.hungry = false;
  s.dragon.size = 100;
  s.res.meat = 1e3;
  return s;
}

const shamans = (s: GameState, n = 4) => {
  s.research.done.push('bone-reading');
  s.idle += n;
  assign(s, 'shaman', n);
};

describe('shamans and mana', () => {
  it('bone-reading opens shamans, once the hunters are out and the dragon is young', () => {
    const s = game(1);
    expect(canResearch(s, researchDef('bone-reading')!)).toBe(false);
    s.stage = 2;
    expect(canResearch(s, researchDef('bone-reading')!)).toBe(true);
    s.research.done.push('bone-reading');
    expect(jobOpen(s, jobDef('shaman')!)).toBe(true);
  });

  it('hunts bring back bones, and shed scales grind into dust', () => {
    const s = game(1);
    s.idle = 30;
    assign(s, 'hunter', 30);
    s.dragon.hungry = true;
    const rand = rng(s);
    for (let i = 0; i < 200; i++) huntStep(s, 600, T0, rand);
    expect(s.magic.bones).toBe(Math.min(HUNT.maxBones, (s.hunt.hunted['cave-bear'] ?? 0) * HUNT.bonesPerKill));
    s.oddities['shed-scales'] = { count: 2, firstAt: T0 };
    magicStep(s, 1, T0, rand);
    expect(s.magic.dust).toBe(2 * MAGIC.dustPerScale);
    magicStep(s, 1, T0, rand);
    expect(s.magic.dust).toBe(2 * MAGIC.dustPerScale); // not ground twice
  });

  it('shamans draw mana from dust first, then bones, up to a cap', () => {
    const s = game();
    shamans(s);
    s.magic.dust = 1;
    s.magic.bones = 10;
    magicStep(s, 3600, T0, rng(s));
    expect(s.magic.dust).toBe(0);
    expect(s.magic.mana).toBeGreaterThan(MAGIC.manaPerDust);
    expect(s.magic.bones).toBeCloseTo(10 - (s.magic.mana - MAGIC.manaPerDust) / MAGIC.manaPerBone);
    s.magic.bones = 1e4;
    magicStep(s, 1e6, T0, rng(s));
    expect(s.magic.mana).toBe(MAGIC.maxMana);
  });

  it('old saves count the scales already on the shelf as ground', () => {
    const raw = JSON.parse(JSON.stringify(game()));
    delete raw.magic;
    raw.oddities['shed-scales'] = { count: 5, firstAt: T0 };
    const back = normalize(raw, T0);
    expect(back.magic.ground).toBe(5);
    expect(back.magic.dust).toBe(0);
  });
});

describe('rituals', () => {
  it('cost mana, and need shamans', () => {
    const s = game();
    s.magic.mana = 200;
    expect(ritualBlocked(s, ritualDef('charm')!)).toBe('Needs shamans');
    shamans(s);
    expect(performRitual(s, 'charm')).toBeTruthy();
    expect(s.magic.mana).toBe(150);
    expect(s.magic.charms).toBe(3);
    s.magic.mana = 10;
    expect(performRitual(s, 'charm')).toBeNull();
  });

  it('bless the dragon: its stats count for more on the next raid, then it wears off', () => {
    const s = game();
    shamans(s);
    s.dragon.trained.might = 4; // Might 29: a farmstead
    expect(raidTarget(s)!.id).toBe('farmstead');
    s.magic.mana = 200;
    performRitual(s, 'bless');
    expect(raidTarget(s)!.id).toBe('village'); // 29 × 1.25 = 36
    expect(ritualBlocked(s, ritualDef('bless')!)).toMatch(/Already/);
    s.dragon.nextRaidAt = 1;
    s.dragon.clock = 10;
    const lines = raidStep(s, T0, rng(s));
    expect(lines[0]).toContain('runes');
    expect(s.dragon.raid?.blessed).toBe(true);
    expect(s.magic.blessed).toBe(false);
    expect(raidTarget(s)!.id).toBe('farmstead');
  });

  it('stone-song doubles digging for an hour', () => {
    const s = game();
    shamans(s);
    s.magic.mana = 200;
    const before = jobMultiplier(s, 'digger');
    performRitual(s, 'stone-song');
    expect(jobMultiplier(s, 'digger')).toBeCloseTo(before * MAGIC.stoneSongMult);
    const lines = magicStep(s, 3600, T0, rng(s));
    expect(lines.some((l) => l.includes('stone-song has ended'))).toBe(true);
    expect(jobMultiplier(s, 'digger')).toBeCloseTo(before);
  });

  it('reading the bones shows cravings as far ahead as they go', () => {
    const s = game();
    shamans(s);
    s.magic.mana = 200;
    expect(cravingHintSeconds(s)).toBe(DIET.hintSeconds);
    performRitual(s, 'read-bones');
    expect(cravingHintSeconds(s)).toBe(DIET.cravingSeconds);
  });

  it('a lucky charm makes the next finds at least uncommon', () => {
    const s = game();
    s.research.done.push('ore-sniffing');
    s.crews.miner = { n: 1000 };
    s.magic.charms = 3;
    const rand = rng(s);
    let lines = 0;
    for (let i = 0; i < 50 && s.magic.charms > 0; i++) lines += findStep(s, 600, T0, rand).length;
    expect(s.magic.charms).toBe(0);
    expect(lines).toBeGreaterThanOrEqual(2); // uncommon or better make the chronicle (one may find nothing that fits)
  });
});

describe("the old dragon's own spells", () => {
  it('an elder dragon casts one now and then, and none before', () => {
    const s = game(3);
    const rand = rng(s);
    s.dragon.clock = 1e6;
    magicStep(s, 10, T0, rand);
    expect(s.magic.nextSpellAt).toBe(0);
    s.stage = 4;
    s.res.copper = 1e5;
    magicStep(s, 10, T0, rand);
    expect(s.magic.nextSpellAt).toBe(s.dragon.clock + MAGIC.firstSpellSeconds);
    s.dragon.clock = s.magic.nextSpellAt;
    const lines = magicStep(s, 10, T0, rand);
    expect(lines.length).toBe(1);
  });
});

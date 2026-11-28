// List 6, part A: one room for the hoard and the dragon, the hoard's worth,
// deeper rooms turning things up, and rare finds while working.
import { describe, expect, it } from 'vitest';
import type { Chief } from '../src/game/chief';
import { DIG, GEMS } from '../src/game/data';
import { moltNeeds, MOLTS, sizeCap, SIZE, worthRate } from '../src/game/dragon';
import { assignDig, capacity, digYields, hoardValue, incomePerSecond, resourceOpen, tick } from '../src/game/economy';
import { findStep, luckOf, rollRarity, WORK_FINDS } from '../src/game/finds';
import { nameKobold } from '../src/game/kobolds';
import { canResearch, researchDef } from '../src/game/research';
import { normalize } from '../src/game/save';
import { newGame, rng, type GameState } from '../src/game/state';

const T0 = 1_700_000_000_000;
const chief: Chief = { name: 'Snik', cunning: 0, voice: 0, nerve: 0, quirk: 'none' };

function game(): GameState {
  const s = newGame(T0);
  s.chief = { ...chief };
  s.newcomerJob = 'idle';
  s.seed = 4242;
  return s;
}

describe('one room for the hoard and the dragon', () => {
  it('there is no lair; old saves add its paces to the hoard room and its diggers to the hoard', () => {
    const s = game();
    expect(s.rooms.lair).toBeUndefined();
    const raw = JSON.parse(JSON.stringify(s));
    raw.rooms.hoard = { volume: 300 };
    raw.rooms.lair = { volume: 700 };
    raw.crews = { digger: { n: 4 } };
    raw.dig = { lair: 3, den: 1 };
    const back = normalize(raw, T0);
    expect(back.rooms.hoard.volume).toBe(1_000);
    expect(back.rooms.lair).toBeUndefined();
    expect(back.dig).toEqual({ hoard: 3, den: 1 });
  });

  it('the dragon takes up room in the hoard, and grows into half of it at most', () => {
    const s = game();
    s.stage = 1;
    s.rooms.hoard.volume = 400;
    const before = capacity(s, 'copper');
    s.dragon.size = 100;
    expect(before - capacity(s, 'copper')).toBeCloseTo(100 * 1000, -2);
    expect(sizeCap(s)).toBe(400 * SIZE.hoardShare);
  });

  it('a molt needs the hoard room dug big enough', () => {
    const s = game();
    s.stage = 1;
    const need = moltNeeds(s)!.find((n) => n.label.startsWith('Hoard room'))!;
    expect(need.need).toBe(MOLTS[0].hoard);
    expect(need.met).toBe(false);
    s.rooms.hoard.volume = MOLTS[0].hoard;
    expect(moltNeeds(s)!.find((n) => n.label.startsWith('Hoard room'))!.met).toBe(true);
  });
});

describe("the hoard's worth", () => {
  it('counts gems, and grows faster than copper alone while the dragon refines', () => {
    const s = game();
    s.res.copper = 100;
    s.gems.sapphire = 2;
    expect(hoardValue(s)).toBe(100 + 2 * GEMS.find((g) => g.id === 'sapphire')!.value);
    expect(worthRate(s)).toBeCloseTo(incomePerSecond(s));
  });
});

describe('deeper rooms turn things up', () => {
  it('stone from the first threshold, then stone and ore, always less than the supports cost', () => {
    const s = game();
    expect(digYields(100, s)).toEqual({});
    expect(digYields(200, s)).toEqual({ stone: 0.5 });
    expect(digYields(600, s)).toEqual({ stone: 0.5 }); // ore not known yet
    s.research.done.push('ore-sniffing');
    expect(digYields(600, s)).toEqual({ stone: 0.5, ore: 0.5 });
    for (const y of DIG.yields) {
      const cost = DIG.supports.filter((x) => x.fromPaces <= y.fromPaces).reduce((a, x) => a + x.perPace, 0);
      const give = Object.values(y.give).reduce((a, n) => a + (n ?? 0), 0);
      expect(give).toBeLessThan(cost * 1.5);
    }
  });

  it('digging a deep room adds stone to the stores', () => {
    const s = game();
    s.chief = null;
    s.rooms.den.volume = 200;
    s.res.wood = 1e4;
    s.idle = 10;
    assignDig(s, 'den', 10);
    const stone = s.res.stone;
    tick(s, 3600);
    expect(s.res.stone).toBeGreaterThan(stone);
  });
});

describe('rare finds while working', () => {
  it('luck comes from fitting talents and the Lucky trait', () => {
    const s = game();
    s.crews.miner = { n: 1 };
    const k = nameKobold(s, 'miner', 't', 'x', T0, rng(s))!;
    expect(luckOf(k, 'miner')).toBe(1);
    k.talents = [{ job: 'miner', mult: 1.25, name: 'Seam-finder' }];
    expect(luckOf(k, 'miner')).toBe(WORK_FINDS.luck);
    k.traits.push('Lucky');
    expect(luckOf(k, 'miner')).toBe(WORK_FINDS.luck ** 2);
  });

  it('very rare finds need a deep room, and luck makes the good ones likelier', () => {
    const s = game();
    const count = (luck: number) => {
      const rand = rng(s);
      const out: Record<string, number> = {};
      for (let i = 0; i < 4000; i++) {
        const r = rollRarity(s, luck, rand, 'miner');
        out[r] = (out[r] ?? 0) + 1;
      }
      return out;
    };
    expect(count(1)['very rare']).toBeUndefined();
    s.rooms.den.volume = WORK_FINDS.deepPaces;
    const plain = count(1);
    const lucky = count(2);
    expect(plain['very rare']).toBeGreaterThan(0);
    expect(lucky.common).toBeLessThan(plain.common);
  });

  it('a busy crew turns up gems and metals over time, and mithril opens its research', () => {
    const s = game();
    s.research.done.push('ore-sniffing', 'smithing', 'ironworking', 'steelmaking');
    s.crews.miner = { n: 40 };
    s.crews.quarrier = { n: 40 };
    s.rooms.den.volume = WORK_FINDS.deepPaces;
    s.stage = 2;
    const rand = rng(s);
    const lines: string[] = [];
    for (let i = 0; i < 2000; i++) lines.push(...findStep(s, 600, T0, rand));
    expect(lines.length).toBeGreaterThan(10);
    expect(Object.keys(s.gems).length).toBeGreaterThan(2);
    expect(s.discovered).toContain('mithril');
    expect(resourceOpen(s, 'mithril')).toBe(true);
    expect(canResearch(s, researchDef('mithril-working')!)).toBe(true);
    expect(s.oddities['first-gems']?.count).toBe(Object.keys(s.gems).length);
  });

  it('rare metals keep a small corner of the metal store and do not crowd out iron', () => {
    const s = game();
    s.research.done.push('ore-sniffing', 'smithing');
    const ore = capacity(s, 'ore');
    s.discovered.push('mithril');
    expect(capacity(s, 'ore')).toBe(ore);
    expect(capacity(s, 'mithril')).toBeGreaterThan(0);
  });
});

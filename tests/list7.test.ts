// List 7, parts A and B: gathering areas with limits and mixes, hunting
// grounds, scouts and exploring, and old saves keeping what they make.
import { describe, expect, it } from 'vitest';
import type { Chief } from '../src/game/chief';
import {
  addArea,
  areaDef,
  capHint,
  EXPLORE,
  exploreBlocked,
  exploreKinds,
  exploreRate,
  exploreStep,
  findCost,
  fills,
  found,
  gathered,
  kindCap,
  searchers,
} from '../src/game/areas';
import { jobDef, jobHints, jobOpen, jobOutput, production } from '../src/game/economy';
import { HUNT, huntStep } from '../src/game/hunting';
import { nameKobold } from '../src/game/kobolds';
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

const open = (s: GameState, job: string) => jobOpen(s, jobDef(job)!);

/** Let kobolds look around until something turns up (or give up). */
function searchUntilFound(s: GameState, n = 1): string[] {
  const rand = rng(s);
  const lines: string[] = [];
  const before = s.explore.found.length;
  for (let i = 0; i < 100_000 && s.explore.found.length < before + n; i++) lines.push(...exploreStep(s, 60, T0, rand));
  return lines;
}

describe('a new game', () => {
  it('opens scavenging, woodcutting and mining, and knows only the near tunnels', () => {
    const s = game();
    expect(open(s, 'scavenger')).toBe(true);
    expect(open(s, 'woodcutter')).toBe(true);
    expect(open(s, 'miner')).toBe(true);
    expect(jobDef('scout')).toBeUndefined();
    expect(found(s).map((a) => a.id)).toEqual(['near-tunnels']);
    expect(exploreKinds(s)).toEqual(['wood', 'stone', 'copper']);
  });

  it('woodcutters with nowhere to work go looking, and the first find is the grove', () => {
    const s = game();
    s.crews.woodcutter = { n: 2 };
    expect(searchers(s, 'wood')).toBeCloseTo(2);
    expect(findCost(s, 'wood')).toBe(EXPLORE.firstCost.wood);
    const lines = searchUntilFound(s);
    expect(s.explore.found).toContain('grove');
    expect(lines[0]).toMatch(/grove/);
    expect(findCost(s, 'wood')).toBe(EXPLORE.firstCost.wood * EXPLORE.growth);
  });

  it('miners with nowhere to work find the rubble cave first', () => {
    const s = game();
    s.crews.miner = { n: 2 };
    searchUntilFound(s);
    expect(s.explore.found).toContain('rubble-cave');
  });

  it('hunters need monster tracking, then go looking for grounds themselves', () => {
    const s = game();
    s.stage = 1;
    expect(open(s, 'hunter')).toBe(false);
    s.research.done.push('monster-tracking');
    expect(open(s, 'hunter')).toBe(true);
    s.crews.hunter = { n: 10 };
    searchUntilFound(s);
    expect(s.explore.found).toContain('bear-caves');
  });

  it('nobody looks while everyone has room to work', () => {
    const s = game();
    addArea(s, 'grove');
    s.crews.woodcutter = { n: 2 };
    expect(searchers(s, 'wood')).toBe(0);
    expect(exploreRate(s, 'wood')).toBe(0);
    s.crews.woodcutter = { n: 100 };
    expect(searchers(s, 'wood')).toBeGreaterThan(80);
  });
});

describe('areas', () => {
  it('give at most so much: more kobolds past that add nothing, and the row says so', () => {
    const s = game();
    addArea(s, 'grove');
    s.crews.woodcutter = { n: 4 };
    expect(production(s).wood).toBeCloseTo(jobOutput(s, jobDef('woodcutter')!));
    s.crews.woodcutter = { n: 100 };
    expect(production(s).wood).toBeCloseTo(6);
    expect(capHint(s, 'wood')).toMatch(/grove outside the hoard gives at most 6 wood a second/);
    expect(capHint(s, 'wood')).toMatch(/out looking for more woodland/);
    expect(jobHints(s).woodcutter).toBe(capHint(s, 'wood'));
  });

  it('kobolds fill the best areas first, and better areas give more kinds of things', () => {
    const s = game();
    addArea(s, 'grove');
    addArea(s, 'petrified-grove');
    s.crews.woodcutter = { n: 100 };
    const f = fills(s, 'wood').fills;
    expect(f[0].area!.id).toBe('petrified-grove');
    // the second find is twice its listed size
    expect(kindCap(s, 'wood')).toBe(6 + 16);
    const g = gathered(s, 'wood');
    expect(g.stone).toBeCloseTo(16 * 0.3);
    expect(g.wood).toBeCloseTo(16 * 0.7 + 6);
  });

  it("anything the warren doesn't know yet comes out as the plain thing", () => {
    const s = game();
    addArea(s, 'collapsed-mine');
    s.crews.scavenger = { n: 200 };
    expect(gathered(s, 'copper').ore ?? 0).toBe(0);
    expect(gathered(s, 'copper').copper).toBeCloseTo(15 + 40);
    s.research.done.push('ore-sniffing');
    expect(gathered(s, 'copper').ore).toBeCloseTo(4);
  });

  it('once the miners can sniff ore, the next stone find has iron in it', () => {
    const s = game();
    addArea(s, 'rubble-cave');
    s.research.done.push('ore-sniffing');
    s.crews.miner = { n: 200 };
    searchUntilFound(s);
    const latest = areaDef(s.explore.found.at(-1)!)!;
    expect(latest.mix!.ore).toBeGreaterThan(0);
  });

  it('deeper and better finds wait for a bigger dragon or a deeper warren', () => {
    const s = game();
    for (const id of ['grove', 'mushroom-thicket', 'petrified-grove']) addArea(s, id);
    expect(exploreBlocked(s, 'wood')).toMatch(/dragon is bigger/);
    s.stage = 2;
    expect(exploreBlocked(s, 'wood')).toBeNull();
    for (const id of ['rubble-cave', 'granite-face', 'iron-seam', 'gem-pocket', 'silver-lode']) addArea(s, id);
    s.stage = 3;
    expect(exploreBlocked(s, 'stone')).toMatch(/Dig a room past/);
  });
});

describe('finding places', () => {
  it('a named kobold on the job gets the story, and sometimes the place is named after them', () => {
    let named = 0;
    for (let seed = 1; seed < 30; seed++) {
      const s = game();
      s.seed = seed;
      addArea(s, 'grove');
      s.idle = 1;
      const k = nameKobold(s, 'idle', 'the Bold', 'Was bold.', T0, rng(s))!;
      k.job = 'woodcutter';
      s.crews.woodcutter = { n: 200 };
      searchUntilFound(s);
      expect(k.history.some((h) => h.text.startsWith('Was first into'))).toBe(true);
      if (Object.values(s.explore.names).some((n) => n.startsWith(k.name))) named++;
    }
    expect(named).toBeGreaterThan(0);
  });
});

describe('hunting grounds', () => {
  it('hunters fill the grounds, each up to its kills an hour, best first', () => {
    const s = game();
    s.stage = 2;
    s.research.done.push('monster-tracking', 'crab-wrangling');
    addArea(s, 'bear-caves');
    addArea(s, 'deep-warrens');
    s.crews.hunter = { n: 500 };
    s.dragon.hungry = true;
    const f = fills(s, 'monsters').fills;
    expect(f[0].area!.id).toBe('deep-warrens');
    const rand = rng(s);
    for (let i = 0; i < 60; i++) huntStep(s, 600, T0, rand); // 10 hours
    const kills = Object.values(s.hunt.hunted).reduce((a, n) => a + n, 0);
    // at most 2 + 3×2 = 8 kills an hour between them (the second ground is twice its size), and most hunts succeed
    expect(kills).toBeLessThanOrEqual(80);
    expect(kills).toBeGreaterThan(80 * HUNT.success * 0.7);
    expect(s.hunt.hunted['salamander'] ?? 0).toBeGreaterThan(0); // the deep warrens hold all three
  });

  it("the elder deeps' meat trains all three stats", () => {
    const s = game();
    s.stage = 5;
    s.dragon.hungry = false;
    s.dragon.size = 100;
    s.research.done.push('crab-wrangling');
    s.res.meat = 1000;
    s.hunt.meat['elder'] = { wild: 1, farmed: 0 };
    huntStep(s, HUNT.eatSeconds, T0, rng(s));
    const gain = HUNT.wildGain * 3;
    expect(s.dragon.trained).toMatchObject({ might: gain, fire: gain, presence: gain });
  });
});

describe('old saves', () => {
  it('get the plain areas, an iron seam if they sniff ore, and enough room that nothing drops', () => {
    const s = game();
    s.stage = 2;
    s.research.done.push('ore-sniffing', 'monster-tracking');
    s.crews = { woodcutter: { n: 80 }, miner: { n: 20 }, scavenger: { n: 10 }, hunter: { n: 4 } };
    const raw = JSON.parse(JSON.stringify(s));
    delete raw.explore;
    const back = normalize(raw, T0);
    const ids = back.explore.found;
    for (const id of ['near-tunnels', 'grove', 'rubble-cave', 'iron-seam', 'bear-caves', 'ember-pits', 'glow-pools']) expect(ids).toContain(id);
    for (const kind of ['wood', 'stone', 'copper'] as const) expect(fills(back, kind).spare).toBeLessThan(1e-6);
    expect(open(back, 'woodcutter') && open(back, 'miner') && open(back, 'hunter')).toBe(true);
    // a save that's already been through this keeps what it has
    const again = normalize(JSON.parse(JSON.stringify(back)), T0);
    expect(again.explore.found).toEqual(back.explore.found);
    expect(again.explore.bonus).toEqual(back.explore.bonus);
  });

  it('a very big crew gets "the old workings" for what no area covers', () => {
    const s = game();
    s.crews = { woodcutter: { n: 2_000 } };
    const raw = JSON.parse(JSON.stringify(s));
    delete raw.explore;
    const back = normalize(raw, T0);
    expect(back.explore.bonus.wood).toBeGreaterThan(0);
    expect(fills(back, 'wood').spare).toBeLessThan(1e-6);
  });
});

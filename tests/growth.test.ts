// Research, named kobolds, the dragon's diet, requests and molting, alchemy,
// the pasture, and rooms growing as they're dug.
import { describe, expect, it } from 'vitest';
import type { Chief } from '../src/game/chief';
import { DIG, ROOMS } from '../src/game/data';
import { DIET, grantRequest, mood, moltNeeds, MOLTS, setHerd, REQUEST } from '../src/game/dragon';
import {
  advanceTo,
  beds,
  capacity,
  digBlocked,
  digWork,
  herdersFit,
  jobOutput,
  jobDef,
  population,
  resourceOpen,
  roomCapacity,
  stageFor,
  storehouseGoods,
  tick,
  workers,
} from '../src/game/economy';
import { happen } from '../src/game/happenings';
import { canPromote, crewLift, LIEUTENANT_EXPERIENCES, makeLieutenant, nameKobold, personalMult } from '../src/game/kobolds';
import { addResearch, chooseResearch, RESEARCH, researchDef } from '../src/game/research';
import { newGame, rng, type GameState } from '../src/game/state';

const T0 = 1_700_000_000_000;
const chief: Chief = { name: 'Snik', cunning: 0, voice: 0, nerve: 0, quirk: 'none' };
const room = (id: string) => ROOMS.find((r) => r.id === id)!;

function game(): GameState {
  const s = newGame(T0);
  s.chief = { ...chief };
  s.digging = null;
  s.newcomerJob = 'idle';
  s.seed = 12345;
  return s;
}

function learn(s: GameState, ...ids: string[]) {
  for (const id of ids) s.research.done.push(id);
}

describe('rooms grow as they are dug', () => {
  it('a half-dug room already holds more', () => {
    const s = game();
    const before = capacity(s, 'copper');
    s.rooms.hoard.progress = digWork(room('hoard'), 2) / 2;
    expect(capacity(s, 'copper')).toBeGreaterThan(before);
    expect(capacity(s, 'copper')).toBeLessThan(roomCapacity(s, room('hoard'), 2));
  });

  it('whole sizes only change the supports: iron from size 10, and iron must be researched', () => {
    const s = game();
    s.rooms.den.size = 9;
    s.digging = 'den';
    s.crews.digger = { n: 1, exp: 0 };
    s.res.wood = 100;
    s.res.stone = 100;
    expect(DIG.supports.find((x) => x.resource === 'iron')!.fromSize).toBe(10);
    expect(digBlocked(s)).toBe('iron');
    tick(s, 60);
    expect(s.rooms.den.progress).toBe(0);
  });
});

describe('research', () => {
  it('a new game knows only copper, wood and stone', () => {
    const s = game();
    expect(resourceOpen(s, 'iron')).toBe(false);
    expect(resourceOpen(s, 'meat')).toBe(false);
    expect(storehouseGoods(s).map((r) => r.id)).toEqual(['wood', 'stone']);
    expect(capacity(s, 'iron')).toBe(0);
  });

  it('researchers uncover new resources and jobs, one at a time', () => {
    const s = game();
    s.crews.researcher = { n: 10, exp: 0 };
    chooseResearch(s, 'ore-sniffing');
    const r = tick(s, researchDef('ore-sniffing')!.cost / 0.9);
    expect(r.learned).toContain('ore-sniffing');
    expect(resourceOpen(s, 'iron')).toBe(true);
    expect(storehouseGoods(s)).toHaveLength(3);
    s.idle = 2;
    s.crews.miner = { n: 2, exp: 0 };
    expect(jobOutput(s, jobDef('miner')!)).toBeGreaterThan(0);
  });

  it('moves on to the cheapest next project, and keeps leftover points', () => {
    const s = game();
    chooseResearch(s, 'ore-sniffing');
    const done = addResearch(s, researchDef('ore-sniffing')!.cost + 10);
    expect(done.map((d) => d.id)).toEqual(['ore-sniffing']);
    expect(s.research.progress).toBeCloseTo(10);
    expect(s.research.current).toBe('crab-wrangling');
  });

  it('refuses projects whose prerequisites are missing', () => {
    const s = game();
    expect(chooseResearch(s, 'goat-herding')).toBe(false);
    expect(RESEARCH.every((r) => r.requires.every((q) => RESEARCH.some((x) => x.id === q)))).toBe(true);
  });

  it('mishaps are harmless and give researchers names', () => {
    const s = game();
    s.crews.researcher = { n: 6, exp: 0 };
    s.chief!.voice = 0;
    const pop = population(s);
    tick(s, 20 * 3600);
    expect(population(s)).toBe(pop);
    expect(s.named.length).toBeGreaterThan(0);
    expect(s.named.every((k) => k.history.length >= 1 && k.title)).toBe(true);
  });
});

describe('named kobolds', () => {
  it('leave the crowd count but stay in the warren', () => {
    const s = game();
    s.crews.scavenger = { n: 3, exp: 0 };
    const k = nameKobold(s, 'scavenger', 'the Test', 'Was tested.', T0, rng(s))!;
    expect(s.crews.scavenger.n).toBe(2);
    expect(workers(s, 'scavenger')).toBe(3);
    expect(population(s)).toBe(3);
    expect(k.job).toBe('scavenger');
    expect(nameKobold(s, 'woodcutter', 'x', 'y', T0, rng(s))).toBeNull();
  });

  it('work harder at a job they love, and lift their crew', () => {
    const s = game();
    s.crews.scavenger = { n: 2, exp: 0 };
    const k = nameKobold(s, 'scavenger', 'the Test', 'Was tested.', T0, rng(s))!;
    k.loves = 'scavenger';
    k.hates = 'digger';
    expect(personalMult(k)).toBe(1.5);
    expect(crewLift(s, 'scavenger')).toBeGreaterThan(1);
  });

  it('become lieutenants after enough experiences, with limited slots', () => {
    const s = game();
    s.crews.scavenger = { n: 3, exp: 0 };
    const a = nameKobold(s, 'scavenger', 'A', 'one', T0, rng(s))!;
    const b = nameKobold(s, 'scavenger', 'B', 'one', T0, rng(s))!;
    expect(canPromote(s, a)).toBe(false);
    for (const k of [a, b]) for (let i = 1; i < LIEUTENANT_EXPERIENCES; i++) k.history.push({ t: T0, text: `story ${i}` });
    expect(makeLieutenant(s, a.id, T0)).toBe(true);
    expect(makeLieutenant(s, b.id, T0)).toBe(false); // one slot for an egg
    s.stage = 1;
    expect(makeLieutenant(s, b.id, T0)).toBe(true);
  });

  it('happenings give crowd kobolds names and stories', () => {
    const s = game();
    s.crews = { scavenger: { n: 20, exp: 0 }, woodcutter: { n: 20, exp: 0 }, quarrier: { n: 20, exp: 0 } };
    const rand = rng(s);
    for (let i = 0; i < 200; i++) happen(s, T0 + i, rand);
    expect(s.named.length).toBeGreaterThan(3);
    expect(s.named.some((k) => k.history.length > 1)).toBe(true);
    expect(population(s)).toBe(60);
  });
});

describe('the dragon', () => {
  function hatched(): GameState {
    const s = game();
    s.stage = 1;
    s.totalEarned = 2000;
    learn(s, 'crab-wrangling');
    s.rooms.pasture = { size: 1, progress: 0 };
    return s;
  }

  it('only hatching comes from copper', () => {
    expect(stageFor(1e15)).toBe(1);
  });

  it('is hungry without meat and grows content when fed', () => {
    const s = hatched();
    expect(mood(s)).toBe('hungry');
    tick(s, 3600);
    expect(s.dragon.content).toBe(0);
    s.crews.herder = { n: 2, exp: 0 };
    tick(s, 3600);
    expect(s.dragon.content).toBeGreaterThan(3000);
    expect(mood(s)).toBe('delighted'); // crabs are all it knows, and all it craves
  });

  it('a craving change is hinted about a day ahead', () => {
    const s = hatched();
    learn(s, 'goat-herding', 'beetle-ranching');
    s.crews.herder = { n: 3, exp: 0 };
    const lines: string[] = [];
    for (let h = 0; h < 50; h++) lines.push(...tick(s, 3600).events);
    const hint = lines.findIndex((l) => /in about a day/.test(l));
    const change = lines.findIndex((l) => /now craves/.test(l));
    expect(hint).toBeGreaterThanOrEqual(0);
    expect(change).toBeGreaterThan(hint);
  });

  it('a new herd settles in at half pace', () => {
    const s = hatched();
    learn(s, 'goat-herding');
    s.crews.herder = { n: 2, exp: 0 };
    const full = jobOutput(s, jobDef('herder')!);
    expect(setHerd(s, 'goat')).toBe(true);
    expect(jobOutput(s, jobDef('herder')!)).toBeCloseTo(full / 2);
    tick(s, DIET.herdSettleSeconds + 10);
    expect(jobOutput(s, jobDef('herder')!)).toBeCloseTo(full, 1);
  });

  it('the pasture limits how many herders work', () => {
    const s = hatched();
    s.crews.herder = { n: 50, exp: 0 };
    const capped = jobOutput(s, jobDef('herder')!);
    s.crews.herder = { n: herdersFit(s), exp: 0 };
    expect(jobOutput(s, jobDef('herder')!)).toBeCloseTo(capped);
  });

  it('makes requests, and granting one spends it and counts toward the molt', () => {
    const s = hatched();
    s.res.copper = 1e5;
    s.dragon.request = { kind: 'give', resource: 'copper', amount: 500, text: 'shiny', until: 1e9 };
    expect(grantRequest(s, T0, rng(s))).toMatch(/purred/);
    expect(s.res.copper).toBe(1e5 - 500);
    expect(s.dragon.granted).toBe(1);
    expect(s.dragon.request).toBeNull();
  });

  it('an audience names a crowd kobold and gives them a gift', () => {
    const s = hatched();
    s.crews.quarrier = { n: 3, exp: 0 };
    s.dragon.request = { kind: 'audience', namedId: null, job: 'quarrier', name: 'one of the quarriers', until: 1e9 };
    expect(grantRequest(s, T0, rng(s))).toMatch(/came back with/);
    expect(s.named).toHaveLength(1);
    expect(s.named[0].gifts).toHaveLength(1);
    expect(personalMult(s.named[0])).toBeGreaterThan(1);
  });

  it('unanswered requests fade with no harm done', () => {
    const s = hatched();
    s.dragon.nextRequestAt = 0;
    tick(s, 20);
    expect(s.dragon.request).not.toBeNull();
    const pop = population(s);
    tick(s, REQUEST.lastsSeconds + 60);
    expect(population(s)).toBe(pop);
    expect(s.dragon.granted).toBe(0);
  });

  it('molts once every condition is met, leaving its skin on the shelf', () => {
    const s = hatched();
    const m = MOLTS[0];
    expect(moltNeeds(s)!.every((n) => n.met)).toBe(false);
    s.rooms.lair = { size: m.lair, progress: 0 };
    s.upgrades.push('mural', 'mushroom-garden');
    s.dragon.granted = m.granted;
    s.dragon.content = m.contentHours * 3600 - 5;
    s.crews.herder = { n: 2, exp: 0 };
    s.res.meat = 100;
    s.dragon.nextRequestAt = 1e12;
    const r = tick(s, 20);
    expect(s.stage).toBe(2);
    expect(r.newStage).toBe(2);
    expect(s.oddities['shed-skins'].count).toBe(1);
    expect(s.dragon.traits).toContain('crab');
    expect(s.dragon.granted).toBe(0);
  });
});

describe('alchemy', () => {
  it('turns plentiful into scarce at its ratio, and only with input', () => {
    const s = game();
    learn(s, 'ore-sniffing', 'alchemy');
    s.crews.alchemist = { n: 2, exp: 0 };
    s.recipe = 'stone-to-iron';
    s.res.stone = 80;
    tick(s, 100);
    expect(s.res.stone).toBe(0);
    expect(s.res.iron).toBeCloseTo(10);
  });
});

describe('beds', () => {
  it('bunk beds research fits more kobolds', () => {
    const s = game();
    s.rooms.den.size = 4;
    const before = beds(s);
    learn(s, 'bunk-beds');
    expect(beds(s)).toBe(Math.floor(before * 1.25));
  });
});

describe('a long absence with everything going', () => {
  it('stays sane', () => {
    const s = game();
    learn(s, 'ore-sniffing', 'crab-wrangling');
    s.stage = 1;
    s.rooms.pasture = { size: 2, progress: 0 };
    s.crews = {
      scavenger: { n: 10, exp: 0 },
      woodcutter: { n: 6, exp: 0 },
      quarrier: { n: 6, exp: 0 },
      digger: { n: 4, exp: 0 },
      researcher: { n: 4, exp: 0 },
      herder: { n: 3, exp: 0 },
    };
    s.digging = 'lair';
    const pop = population(s);
    const r = advanceTo(s, T0 + 24 * 3600 * 1000);
    expect(population(s)).toBeGreaterThanOrEqual(pop);
    for (const v of Object.values(s.res)) expect(Number.isFinite(v) && v >= 0).toBe(true);
    expect(r.events.length).toBeGreaterThan(0);
    expect(s.rooms.lair.size).toBeGreaterThan(1);
  });
});

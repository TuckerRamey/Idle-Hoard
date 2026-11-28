// Research, named kobolds, the dragon's diet, requests and molting, alchemy,
// the pasture, and rooms growing as they're dug.
import { describe, expect, it } from 'vitest';
import type { Chief } from '../src/game/chief';
import { DIG, RECIPES, type ResourceId } from '../src/game/data';
import { cravingHintSeconds, DIET, grantRequest, mood, moltNeeds, MOLTS, setHerd, REQUEST } from '../src/game/dragon';
import {
  advanceTo,
  beds,
  capacity,
  digBlocked,
  herdersFit,
  jobHints,
  jobOutput,
  jobDef,
  population,
  recipeRatio,
  resourceOpen,
  stageFor,
  storeGoods,
  supportsFor,
  tick,
  workers,
} from '../src/game/economy';
import { happen } from '../src/game/happenings';
import { canPromote, crewLift, LIEUTENANT_EXPERIENCES, lieutenantSlots, makeLieutenant, nameKobold, personalMult } from '../src/game/kobolds';
import { addResearch, chooseResearch, RESEARCH, researchDef, researchProgress, researchShortOf } from '../src/game/research';
import { normalize } from '../src/game/save';
import { newGame, rng, type GameState } from '../src/game/state';

const T0 = 1_700_000_000_000;
const chief: Chief = { name: 'Snik', cunning: 0, voice: 0, nerve: 0, quirk: 'none' };

function game(): GameState {
  const s = newGame(T0);
  s.chief = { ...chief };
  s.newcomerJob = 'idle';
  s.seed = 12345;
  return s;
}

function learn(s: GameState, ...ids: string[]) {
  for (const id of ids) s.research.done.push(id);
}

describe('rooms measured in volume', () => {
  it('supports change at set volumes: bars from 1,500 paces, and bars need the forge', () => {
    const s = game();
    s.rooms.den.volume = 1_500;
    s.crews.digger = { n: 1 };
    s.dig = { den: s.crews.digger?.n ?? 0 };
    s.res.wood = 100;
    s.res.stone = 100;
    expect(DIG.supports.find((x) => x.resource === 'bars')!.fromPaces).toBe(1_500);
    expect(digBlocked(s, 'den')).toBe('bars');
    tick(s, 60);
    expect(s.rooms.den.volume).toBe(1_500);
  });

  it('a dig crossing a support threshold starts paying there', () => {
    const s = game();
    s.rooms.den.volume = 140;
    s.crews.digger = { n: 1 };
    s.dig = { den: s.crews.digger?.n ?? 0 };
    s.res.wood = 100;
    tick(s, 300);
    const wood = DIG.supports.find((x) => x.resource === 'wood')!;
    expect(s.rooms.den.volume).toBeGreaterThan(wood.fromPaces);
    // only the paces past the threshold paid for wood
    expect(s.res.wood).toBeCloseTo(100 - (s.rooms.den.volume - wood.fromPaces) * wood.perPace, 3);
  });
});

describe('research', () => {
  it('a new game knows only copper, wood and stone', () => {
    const s = game();
    expect(resourceOpen(s, 'ore')).toBe(false);
    expect(resourceOpen(s, 'meat')).toBe(false);
    expect(capacity(s, 'ore')).toBe(0);
  });

  it('researchers uncover new resources and jobs, one at a time', () => {
    const s = game();
    s.crews.researcher = { n: 10 };
    s.res.stone = 500;
    chooseResearch(s, 'ore-sniffing');
    const r = tick(s, researchDef('ore-sniffing')!.cost / 0.9);
    expect(s.res.stone).toBeLessThan(500 - 199);
    expect(r.learned).toContain('ore-sniffing');
    expect(resourceOpen(s, 'ore')).toBe(true);
    expect(storeGoods(s, 'metals').map((g) => g.id)).toEqual(['ore']);
    s.idle = 2;
    s.crews.miner = { n: 2 };
    expect(jobOutput(s, jobDef('miner')!)).toBeGreaterThan(0);
  });

  it('moves on to the cheapest project it can pay for, and drops leftover points', () => {
    const s = game();
    s.res.stone = 1000;
    s.res.wood = 1000;
    chooseResearch(s, 'ore-sniffing');
    const done = addResearch(s, researchDef('ore-sniffing')!.cost + 10);
    expect(done.map((d) => d.id)).toEqual(['ore-sniffing']);
    expect(s.research.progress).toEqual({});
    expect(s.research.current).toBe('crab-wrangling');
    expect(s.res.stone).toBeCloseTo(800);
    // with no wood, crab wrangling waits and a stone-only project goes first
    const t = game();
    t.res.stone = 1000;
    chooseResearch(t, 'ore-sniffing');
    addResearch(t, researchDef('ore-sniffing')!.cost);
    expect(t.research.current).toBe('smithing');
  });

  it('uses resources a little with every point, and keeps progress per project', () => {
    const s = game();
    s.res.stone = 1000;
    s.res.wood = 1000;
    const ore = researchDef('ore-sniffing')!;
    chooseResearch(s, 'ore-sniffing');
    addResearch(s, ore.cost / 2);
    expect(researchProgress(s, 'ore-sniffing')).toBeCloseTo(ore.cost / 2);
    expect(s.res.stone).toBeCloseTo(1000 - 100);
    chooseResearch(s, 'crab-wrangling');
    addResearch(s, 100);
    chooseResearch(s, 'ore-sniffing');
    expect(researchProgress(s, 'ore-sniffing')).toBeCloseTo(ore.cost / 2);
    expect(researchProgress(s, 'crab-wrangling')).toBeCloseTo(100);
  });

  it('pauses without resources and sends spare points to a project that can pay', () => {
    const s = game();
    s.res.stone = 20; // enough for a tenth of ore sniffing
    s.res.wood = 1000;
    const ore = researchDef('ore-sniffing')!;
    chooseResearch(s, 'ore-sniffing');
    addResearch(s, ore.cost / 2);
    expect(researchProgress(s, 'ore-sniffing')).toBeCloseTo(ore.cost / 10);
    expect(s.res.stone).toBeCloseTo(0);
    expect(researchShortOf(s, ore)).toEqual(['stone']);
    expect(s.research.current).toBe('ore-sniffing');
    const spilled = Object.entries(s.research.progress).filter(([id]) => id !== 'ore-sniffing');
    expect(spilled).toHaveLength(1);
    expect(spilled[0][1]).toBeCloseTo(ore.cost / 2 - ore.cost / 10);
    const hint = jobHints(s);
    s.crews.researcher = { n: 1 };
    expect(jobHints(s).researcher).toMatch(/waiting for stone/);
    expect(hint).toBeDefined();
  });

  it('new research bonuses do what they say', () => {
    const s = game();
    learn(s, 'ore-sniffing', 'crab-wrangling', 'alchemy', 'echo-maps', 'pit-props', 'smokehouse', 'better-jerky', 'name-tags', 'storytelling', 'bunk-beds', 'safety-goggles', 'lab-notebooks', 'bouncy-helmets');
    expect(supportsFor(200, s)[0].perPace).toBeCloseTo(DIG.supports[0].perPace * 0.75);
    expect(recipeRatio(s, RECIPES.find((r) => r.id === 'wood-to-meat')!)).toBe(4);
    expect(capacity(s, 'meat')).toBeGreaterThan(capacity(s, 'wood'));
    expect(lieutenantSlots(s)).toBe(1 + s.stage + 1);
    s.crews.scavenger = { n: 3 };
    nameKobold(s, 'scavenger', 'the Test', 'Was tested.', T0, rng(s));
    expect(crewLift(s, 'scavenger')).toBeCloseTo(1.05);
    learn(s, 'kobold-arithmetic', 'transmutation-theory');
    expect(recipeRatio(s, RECIPES.find((r) => r.id === 'stone-to-ore')!)).toBeCloseTo(6);
  });

  it('every project costs something the game has by the time it opens', () => {
    for (const r of RESEARCH) {
      const s = game();
      const need = new Set<string>();
      const walk = (id: string) => {
        need.add(id);
        for (const q of researchDef(id)!.requires) walk(q);
      };
      for (const q of r.requires) walk(q);
      learn(s, ...need);
      // projects that need something found first open once it has been
      for (const id of [...need, r.id]) {
        const f = researchDef(id)!.found;
        if (f) s.discovered.push(f);
      }
      for (const res of Object.keys(r.resources ?? {})) expect(resourceOpen(s, res as ResourceId), `${r.id} uses ${res}`).toBe(true);
    }
  });

  it('the dragon cookbook gives two days of warning', () => {
    const s = game();
    expect(cravingHintSeconds(s)).toBe(DIET.hintSeconds);
    learn(s, 'dragon-cookbook');
    expect(cravingHintSeconds(s)).toBe(2 * 86_400);
  });

  it('old saves put their shared research pool on the current project', () => {
    const s = game();
    const raw = JSON.parse(JSON.stringify(s));
    raw.research = { done: [], current: 'crab-wrangling', progress: 123 };
    expect(normalize(raw, T0).research.progress).toEqual({ 'crab-wrangling': 123 });
  });

  it('refuses projects whose prerequisites are missing', () => {
    const s = game();
    expect(chooseResearch(s, 'goat-herding')).toBe(false);
    expect(RESEARCH.every((r) => r.requires.every((q) => RESEARCH.some((x) => x.id === q)))).toBe(true);
  });

  it('mishaps are harmless and give researchers names', () => {
    const s = game();
    s.crews.researcher = { n: 6 };
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
    s.crews.scavenger = { n: 3 };
    const k = nameKobold(s, 'scavenger', 'the Test', 'Was tested.', T0, rng(s))!;
    expect(s.crews.scavenger.n).toBe(2);
    expect(workers(s, 'scavenger')).toBe(3);
    expect(population(s)).toBe(3);
    expect(k.job).toBe('scavenger');
    expect(nameKobold(s, 'woodcutter', 'x', 'y', T0, rng(s))).toBeNull();
  });

  it('work harder at a job they love, and lift their crew', () => {
    const s = game();
    s.crews.scavenger = { n: 2 };
    const k = nameKobold(s, 'scavenger', 'the Test', 'Was tested.', T0, rng(s))!;
    k.loves = 'scavenger';
    k.hates = 'digger';
    expect(personalMult(k)).toBe(1.5);
    expect(crewLift(s, 'scavenger')).toBeGreaterThan(1);
  });

  it('become lieutenants after enough experiences, with limited slots', () => {
    const s = game();
    s.crews.scavenger = { n: 3 };
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
    s.crews = { scavenger: { n: 20 }, woodcutter: { n: 20 }, miner: { n: 20 } };
    const rand = rng(s);
    for (let i = 0; i < 200; i++) happen(s, T0 + i, rand);
    expect(s.named.length).toBe(6); // one in ten of 60
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
    s.rooms.pasture = { volume: 30 };
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
    s.crews.herder = { n: 2 };
    tick(s, 3600);
    expect(s.dragon.content).toBeGreaterThan(3000);
    expect(mood(s)).toBe('delighted'); // crabs are all it knows, and all it craves
  });

  it('a craving change is hinted about a day ahead', () => {
    const s = hatched();
    learn(s, 'goat-herding', 'beetle-ranching');
    s.crews.herder = { n: 3 };
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
    s.crews.herder = { n: 2 };
    const full = jobOutput(s, jobDef('herder')!);
    expect(setHerd(s, 'goat')).toBe(true);
    expect(jobOutput(s, jobDef('herder')!)).toBeCloseTo(full / 2);
    tick(s, DIET.herdSettleSeconds + 10);
    expect(jobOutput(s, jobDef('herder')!)).toBeCloseTo(full, 1);
  });

  it('the pasture limits how many herders work', () => {
    const s = hatched();
    s.crews.herder = { n: 50 };
    const capped = jobOutput(s, jobDef('herder')!);
    s.crews.herder = { n: herdersFit(s) };
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
    s.crews.miner = { n: 3 };
    s.dragon.request = { kind: 'audience', namedId: null, job: 'miner', name: 'one of the miners', until: 1e9 };
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
    s.rooms.hoard = { volume: m.hoard };
    s.res.copper = m.value;
    s.dragon.granted = m.granted;
    s.dragon.content = m.contentHours * 3600 - 5;
    s.crews.herder = { n: 2 };
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
    s.crews.alchemist = { n: 2 };
    s.recipe = 'stone-to-ore';
    s.res.stone = 80;
    tick(s, 100);
    expect(s.res.stone).toBe(0);
    expect(s.res.ore).toBeCloseTo(10);
  });
});

describe('beds', () => {
  it('bunk beds research fits more kobolds', () => {
    const s = game();
    s.rooms.den.volume = 300;
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
    s.rooms.pasture = { volume: 60 };
    s.crews = {
      scavenger: { n: 10 },
      woodcutter: { n: 6 },
      miner: { n: 6 },
      digger: { n: 4 },
      researcher: { n: 4 },
      herder: { n: 3 },
    };
    s.dig = { hoard: s.crews.digger?.n ?? 0 };
    const pop = population(s);
    const r = advanceTo(s, T0 + 24 * 3600 * 1000);
    expect(population(s)).toBeGreaterThanOrEqual(pop);
    for (const v of Object.values(s.res)) expect(Number.isFinite(v) && v >= 0).toBe(true);
    expect(r.events.length).toBeGreaterThan(0);
    expect(s.rooms.hoard.volume).toBeGreaterThan(50);
  });
});

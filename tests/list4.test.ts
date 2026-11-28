// List 4: diggers per room, a full hoard, the dragon's favor and stories,
// more happening, talents, epithets, colonies, the next-goal line.
import { describe, expect, it } from 'vitest';
import { founder } from '../src/game/founders';
import type { Chief } from '../src/game/chief';
import { COLONY, colonyBlocked, colonyStep, foundColony, tributeRate } from '../src/game/colonies';
import { boostLeft, FAVOR, grantRequest, refineRates, useFavor } from '../src/game/dragon';
import {
  assign,
  assignDig,
  capacity,
  digRate,
  digRates,
  diggersIn,
  hoardFull,
  jobDef,
  jobHints,
  jobOutput,
  scavengerDig,
  tick,
  workers,
} from '../src/game/economy';
import { digFinds, epithetStep, FIND, talentStep } from '../src/game/events';
import { nextGoal } from '../src/game/goals';
import { awayHappenings, happeningEvery, HAPPENING_MIN_SECONDS } from '../src/game/happenings';
import { addHistory, addTalent, EPITHET_MULT, nameKobold, personalMult } from '../src/game/kobolds';
import { deserialize, normalize, serialize } from '../src/game/save';
import { newGame, rng, type GameState } from '../src/game/state';
import { ROOMS } from '../src/game/data';

const T0 = 1_700_000_000_000;
const chief: Chief = { name: 'Snik', cunning: 0, voice: 0, nerve: 0, quirk: 'none' };

function game(): GameState {
  const s = newGame(T0);
  s.explore.found.push('grove', 'rubble-cave'); // the starting woods and stone, so every gathering job is open
  s.chief = { ...chief };
  s.newcomerJob = 'idle';
  s.seed = 4242;
  return s;
}

/** A hatched, fed dragon. */
function fed(): GameState {
  const s = game();
  s.stage = 1;
  s.research.done.push('crab-wrangling');
  s.res.meat = 5_000;
  s.crews.herder = { n: 3 };
  s.dragon.hungry = false;
  s.dragon.nextRequestAt = 1e12;
  s.rooms.hoard.volume = 2_000;
  s.dragon.size = 200;
  return s;
}

describe('diggers per room', () => {
  it('puts idle kobolds on a room and takes them back', () => {
    const s = game();
    s.idle = 10;
    expect(assignDig(s, 'den', 4)).toBe(4);
    expect(assignDig(s, 'woodpile', 3)).toBe(3);
    expect(s.crews.digger.n).toBe(7);
    expect(s.idle).toBe(3);
    expect(diggersIn(s, 'den')).toBe(4);
    expect(assignDig(s, 'den', -10)).toBe(-4);
    expect(diggersIn(s, 'den')).toBe(0);
    expect(s.crews.digger.n).toBe(3);
    expect(s.idle).toBe(7);
  });

  it('several rooms grow at once, each at its own diggers’ pace', () => {
    const s = game();
    s.idle = 6;
    assignDig(s, 'den', 4);
    assignDig(s, 'hoard', 2);
    const r = digRates(s);
    expect(r.den).toBeCloseTo(r.hoard * 2);
    expect(r.den + r.hoard).toBeCloseTo(jobOutput(s, jobDef('digger')!));
    // same size rooms, so a pace costs the same work in each
    s.rooms.den.volume = s.rooms.hoard.volume = 100;
    const den = s.rooms.den.volume;
    const hoard = s.rooms.hoard.volume;
    tick(s, 20);
    expect(s.rooms.den.volume - den).toBeCloseTo((s.rooms.hoard.volume - hoard) * 2, 1);
  });

  it('the job list cannot add diggers without a room, and taking them off empties the busiest room', () => {
    const s = game();
    s.idle = 5;
    expect(assign(s, 'digger', 2)).toBe(0);
    assignDig(s, 'den', 3);
    assignDig(s, 'hoard', 1);
    expect(assign(s, 'digger', -1)).toBe(-1);
    expect(diggersIn(s, 'den')).toBe(2);
    expect(diggersIn(s, 'hoard')).toBe(1);
  });

  it('naming a digger keeps the rooms and the crew in step', () => {
    const s = game();
    s.idle = 3;
    assignDig(s, 'den', 3);
    nameKobold(s, 'digger', 'the Test', 'Was tested.', T0, rng(s));
    expect(s.crews.digger.n).toBe(2);
    expect(diggersIn(s, 'den')).toBe(2);
  });

  it('an older save with one room being dug moves its diggers there', () => {
    const s = normalize({ crews: { digger: { n: 5 } }, digging: 'woodpile' }, T0);
    expect(s.dig).toEqual({ woodpile: 5 });
  });
});

describe('a full hoard', () => {
  it('sends the scavengers to dig the hoard room until there is room', () => {
    const s = game();
    s.crews.scavenger = { n: 10 };
    s.res.copper = capacity(s, 'copper');
    expect(hoardFull(s)).toBe(true);
    expect(scavengerDig(s)).toBeGreaterThan(0);
    expect(jobHints(s).scavenger).toMatch(/digging it bigger/);
    const before = s.rooms.hoard.volume;
    tick(s, 60);
    expect(s.rooms.hoard.volume).toBeGreaterThan(before);
  });

  it('scavengers just scavenge while there is room', () => {
    const s = game();
    s.crews.scavenger = { n: 10 };
    expect(hoardFull(s)).toBe(false);
    expect(digRate(s, 'hoard')).toBe(0);
  });
});

describe("the dragon's favor", () => {
  function grant(s: GameState) {
    s.res.wood = 1e6;
    s.dragon.request = { kind: 'give', resource: 'wood', amount: 1, text: 'x', until: 1e12 };
    return grantRequest(s, T0, rng(s))!;
  }

  it('each granted request banks a favor, up to a few', () => {
    const s = fed();
    for (let i = 0; i < FAVOR.max + 2; i++) grant(s);
    expect(s.dragon.boons).toBe(FAVOR.max);
    expect(s.dragon.granted).toBe(FAVOR.max + 2);
  });

  it('sometimes leaves a shed scale on the shelf', () => {
    const s = fed();
    for (let i = 0; i < 20; i++) grant(s);
    expect(s.oddities['shed-scales']?.count).toBeGreaterThan(0);
  });

  it('a favor makes one job twice as fast for an hour, then wears off', () => {
    const s = fed();
    s.crews.miner = { n: 4 };
    const q = jobDef('miner')!;
    const before = jobOutput(s, q);
    expect(useFavor(s, 'miner')).toBeNull(); // nothing owed yet
    s.dragon.boons = 1;
    expect(useFavor(s, 'miner')).toMatch(/helping/);
    expect(s.dragon.boons).toBe(0);
    expect(jobOutput(s, q)).toBeCloseTo(before * FAVOR.mult);
    expect(boostLeft(s, 'miner')).toBe(FAVOR.seconds);
    const r = tick(s, FAVOR.seconds + 20);
    expect(boostLeft(s, 'miner')).toBe(0);
    expect(jobOutput(s, q)).toBeLessThan(before * 1.5); // back to normal, give or take crew experience
    expect(r.events.some((e) => e.includes('stopped helping'))).toBe(true);
  });

  it('a kobold summoned from the crowd starts with one experience, not two', () => {
    const s = fed();
    s.crews.miner = { n: 4 };
    s.dragon.request = { kind: 'audience', namedId: null, job: 'miner', name: 'one of the miners', until: 1e12 };
    grantRequest(s, T0, rng(s));
    expect(s.named).toHaveLength(1);
    expect(s.named[0].history).toHaveLength(1);
    expect(s.named[0].history[0].text).toMatch(/Spoke with the dragon/);
  });
});

describe('the dragon', () => {
  it('tells named kobolds stories while content', () => {
    const s = fed();
    s.crews.miner = { n: 4 };
    s.chief = null; // keep the test about stories
    const k = nameKobold(s, 'miner', 'the Test', 'Was tested.', T0, rng(s))!;
    tick(s, 48 * 3600);
    expect(k.history.some((h) => h.text.startsWith('The dragon told them a story'))).toBe(true);
  });

  it('refines twice as fast at each evolution, for the same size', () => {
    const a = fed();
    const b = fed();
    b.stage = 2;
    expect(refineRates(b).copper).toBeCloseTo(refineRates(a).copper * 2);
  });
});

describe('more happens as the warren grows', () => {
  it('happenings come faster with more kobolds, but not too fast', () => {
    const s = game();
    s.idle = 10;
    const ten = happeningEvery(s);
    s.idle = 40;
    expect(happeningEvery(s)).toBeLessThan(ten);
    s.idle = 100_000;
    expect(happeningEvery(s)).toBe(HAPPENING_MIN_SECONDS);
  });

  it('a long absence brings a few happenings, not just one', () => {
    expect(awayHappenings(10 * 60)).toBe(0);
    expect(awayHappenings(45 * 60)).toBe(1);
    expect(awayHappenings(5 * 3600)).toBe(2);
    expect(awayHappenings(24 * 3600)).toBe(4);
  });

  it('digging turns things up, and the digger can earn a name for it', () => {
    const s = game();
    s.crews.digger = { n: 5 };
    s.dig = { den: 5 };
    const old = FIND.perPace;
    FIND.perPace = 1;
    const lines: string[] = [];
    const rand = rng(s);
    try {
      for (let i = 0; i < 40; i++) {
        const l = digFinds(s, ROOMS.find((r) => r.id === 'den')!, 1, rand, T0);
        if (l) lines.push(l);
      }
    } finally {
      FIND.perPace = old;
    }
    expect(lines.length).toBeGreaterThan(10);
    expect(s.named.length).toBeGreaterThan(0);
    expect(s.crews.digger.n + s.named.filter((k) => k.job === 'digger').length).toBe(5);
    expect(s.dig.den).toBe(s.crews.digger.n);
  });
});

describe('talents and epithets', () => {
  it('a talent makes a kobold better at that job only', () => {
    const s = game();
    s.crews.woodcutter = { n: 1 };
    const k = nameKobold(s, 'woodcutter', 't', 'x', T0, rng(s))!;
    k.loves = 'herder';
    k.hates = 'scavenger';
    const before = personalMult(k);
    addTalent(k, { job: 'miner', mult: 1.5, name: 'Dark-sighted' });
    expect(personalMult(k)).toBeCloseTo(before);
    k.job = 'miner';
    expect(personalMult(k)).toBeCloseTo(1.5);
    k.job = 'woodcutter';
    expect(personalMult(k)).toBeCloseTo(1);
    expect(addTalent(k, { job: 'miner', mult: 1.5, name: 'Dark-sighted' })).toBe(false);
  });

  it('working long enough, someone finds a knack and earns a name', () => {
    const s = game();
    s.crews.scavenger = { n: 40 };
    const lines: string[] = [];
    for (let i = 0; i < 200; i++) lines.push(...talentStep(s, 3600, T0, rng(s)));
    expect(lines.length).toBeGreaterThan(0);
    const k = s.named.find((x) => x.talents?.length)!;
    expect(k).toBeDefined();
    expect(k.history[0].text).toMatch(/knack/);
    expect(personalMult(k)).toBeGreaterThan(1);
  });

  it('a kobold this good at their job earns an epithet, once', () => {
    const s = game();
    s.crews.digger = { n: 2 };
    s.dig = { den: 2 };
    const k = nameKobold(s, 'digger', 't', 'x', T0, rng(s))!;
    k.loves = 'digger';
    addTalent(k, { job: 'digger', mult: EPITHET_MULT, name: 'Blast-digger' });
    expect(epithetStep(s, T0)[0]).toMatch(/digs like a dragon/);
    expect(k.epithet).toBe('digs like a dragon');
    expect(epithetStep(s, T0)).toEqual([]);
  });
});

describe('colonies', () => {
  function ready(): { s: GameState; id: number } {
    const s = fed();
    s.crews.miner = { n: 10 };
    const k = nameKobold(s, 'miner', 'the Bold', 'Was bold.', T0, rng(s))!;
    for (let i = 0; i < COLONY.experiences; i++) addHistory(k, T0, 'Did a thing.');
    return { s, id: k.id };
  }

  it('need a hatched dragon and an experienced kobold', () => {
    const { s, id } = ready();
    const k = s.named.find((x) => x.id === id)!;
    expect(colonyBlocked(s, k)).toBeNull();
    s.stage = 0;
    expect(colonyBlocked(s, k)).toMatch(/hatches/);
    s.stage = 1;
    k.history = [];
    expect(colonyBlocked(s, k)).toMatch(/experiences/);
  });

  it('a founder leaves with a few kobolds, and the colony sends tribute and writes its history', () => {
    const { s, id } = ready();
    const pop = s.crews.miner.n + s.idle;
    // how many go with them depends on the founder's Pull
    const settlers = Math.max(2, COLONY.settlers + founder(s.named.find((x) => x.id === id)!).pull);
    const line = foundColony(s, id, T0, rng(s))!;
    expect(line).toMatch(/to found/);
    expect(s.named).toHaveLength(0);
    expect(s.crews.miner.n + s.idle).toBe(pop - settlers);
    const c = s.colonies[0];
    expect(c.leader.name).toBeTruthy();
    expect(c.pop).toBe(settlers + 1);
    s.res.copper = 0;
    for (let i = 0; i < 24 * 6; i++) colonyStep(s, 600, T0 + i * 600_000, rng(s));
    expect(s.res.copper).toBeGreaterThan(0);
    expect(c.sent).toBeGreaterThan(0);
    expect(c.pop).toBeGreaterThan(settlers + 1);
    expect(c.history.length).toBeGreaterThan(1);
    expect(tributeRate(s, c).copper).toBeGreaterThan(0);
  });

  it('round trip through a save', () => {
    const { s, id } = ready();
    foundColony(s, id, T0, rng(s));
    s.crews.miner = { n: 1 };
    const k = nameKobold(s, 'miner', 't', 'x', T0, rng(s))!;
    addTalent(k, { job: 'miner', mult: 1.25, name: 'Seam-finder' });
    k.epithet = 'mines like a dragon';
    k.artWork = 123;
    s.dragon.boons = 2;
    s.dragon.boosts = [{ job: 'miner', until: 99 }];
    s.settings.goal = false;
    expect(deserialize(serialize(s, T0), T0)).toEqual(s);
  });
});

describe('the next-goal line', () => {
  it('points at hatching, then food, then the next molt', () => {
    const s = game();
    expect(nextGoal(s)).toMatch(/hatches the egg/);
    s.stage = 1;
    expect(nextGoal(s)).toMatch(/crab wrangling/);
    const f = fed();
    expect(nextGoal(f)).toMatch(/^Next molt/);
    s.chief = null;
    expect(nextGoal(s)).toBeNull();
  });
});

describe('quiet facts', () => {
  it('workers counts named diggers too', () => {
    const s = game();
    s.idle = 2;
    assignDig(s, 'den', 2);
    nameKobold(s, 'digger', 't', 'x', T0, rng(s));
    expect(workers(s, 'digger')).toBe(2);
  });
});

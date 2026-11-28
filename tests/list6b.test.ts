// List 6, part B: the dragon's stats, hunters and monster meat, raids, and
// the elder and ancient stages with their growing tastes.
import { describe, expect, it } from 'vitest';
import type { Chief } from '../src/game/chief';
import { DRAGON_STAGES } from '../src/game/data';
import { dragonAppeal, dragonJobMult, dragonStat, moltNeeds, MOLTS, setHerd, STAT, trainCap } from '../src/game/dragon';
import { appeal, assign, jobDef, jobOpen, tick } from '../src/game/economy';
import { HUNT, huntStep, meatOnHand, monsterDef, setQuarry } from '../src/game/hunting';
import { nextRaid, RAID, raidStep, raidTarget } from '../src/game/raids';
import { canResearch, researchDef } from '../src/game/research';
import { normalize } from '../src/game/save';
import { newGame, rng, type GameState } from '../src/game/state';

const T0 = 1_700_000_000_000;
const chief: Chief = { name: 'Snik', cunning: 0, voice: 0, nerve: 0, quirk: 'none' };

function game(stage = 2): GameState {
  const s = newGame(T0);
  s.chief = { ...chief };
  s.newcomerJob = 'idle';
  s.seed = 777;
  s.stage = stage;
  s.research.done.push('crab-wrangling');
  s.dragon.hungry = false;
  s.dragon.size = 100;
  s.res.meat = 1e3;
  return s;
}

describe("the dragon's stats", () => {
  it('each stage has a base, and training on top is held to a cap that grows with it', () => {
    const s = game(1);
    expect(dragonStat(s, 'might')).toBe(STAT.baseByStage[1]);
    s.dragon.trained.might = 1_000;
    expect(dragonStat(s, 'might')).toBe(STAT.baseByStage[1] + STAT.capByStage[1]);
    s.stage = 3;
    expect(dragonStat(s, 'might')).toBe(STAT.baseByStage[3] + STAT.capByStage[3]);
    expect(dragonStat(newGame(T0), 'might')).toBe(0);
  });

  it('Presence draws kobolds and Fire heats the forge', () => {
    const s = game(2);
    const a = appeal(s);
    const d = dragonAppeal(s);
    s.dragon.trained.presence = 40;
    expect(dragonAppeal(s) - d).toBeCloseTo(40 * STAT.presenceAppeal);
    expect(appeal(s)).toBeGreaterThan(a);
    const forge = dragonJobMult(s, 'blacksmith');
    s.dragon.trained.fire = 40;
    expect(dragonJobMult(s, 'blacksmith') / forge).toBeCloseTo((1 + 65 * STAT.fireForge) / (1 + 25 * STAT.fireForge));
  });
});

describe('hunting', () => {
  it('hunters need monster tracking, and it needs a hatched dragon', () => {
    const s = game(0);
    const def = researchDef('monster-tracking')!;
    expect(canResearch(s, def)).toBe(false);
    s.stage = 1;
    expect(canResearch(s, def)).toBe(true);
    expect(jobOpen(s, jobDef('hunter')!)).toBe(false);
    s.research.done.push('monster-tracking');
    expect(jobOpen(s, jobDef('hunter')!)).toBe(true);
  });

  it('hunters bring back monster meat and larder meat, and enough kills open farming', () => {
    const s = game(1);
    s.research.done.push('monster-tracking');
    s.dragon.hungry = true; // not eating it yet
    s.idle = 20;
    assign(s, 'hunter', 20);
    const farm = researchDef('bear-taming')!;
    expect(canResearch(s, farm)).toBe(false);
    const rand = rng(s);
    const lines: string[] = [];
    for (let i = 0; i < 2_000 && (s.hunt.hunted['cave-bear'] ?? 0) < 25; i++) lines.push(...huntStep(s, 60, T0, rand));
    expect(s.hunt.hunted['cave-bear']).toBe(25);
    expect(s.hunt.meat['cave-bear'].wild).toBe(Math.min(HUNT.maxMeat, 25 * HUNT.meatPerKill));
    expect(lines.some((l) => l.includes('first cave bear'))).toBe(true);
    expect(lines.some((l) => l.includes('Bear taming'))).toBe(true);
    expect(s.oddities['hunting-trophies']?.count).toBe(2);
    expect(canResearch(s, farm)).toBe(true);
  });

  it('deep and dangerous monsters wait for a bigger dragon and a deep room', () => {
    const s = game(2);
    expect(setQuarry(s, 'basilisk')).toBe(false);
    s.stage = 3;
    expect(setQuarry(s, 'basilisk')).toBe(false);
    s.rooms.den.volume = 1_500;
    expect(setQuarry(s, 'basilisk')).toBe(true);
    expect(setQuarry(s, 'wyvern')).toBe(false);
  });

  it('the dragon eats a bite now and then, wild first, training its stat up to the cap', () => {
    const s = game(1);
    s.hunt.meat['cave-bear'] = { wild: 2, farmed: 50 };
    huntStep(s, HUNT.eatSeconds * 2, T0, rng(s));
    expect(s.hunt.meat['cave-bear']).toEqual({ wild: 0, farmed: 50 });
    expect(s.dragon.trained.might).toBeCloseTo(2 * HUNT.wildGain);
    huntStep(s, HUNT.eatSeconds, T0, rng(s));
    expect(s.dragon.trained.might).toBeCloseTo(2 * HUNT.wildGain + HUNT.farmedGain);
    s.dragon.trained.might = trainCap(s);
    const lines = huntStep(s, HUNT.eatSeconds * 10, T0, rng(s));
    expect(s.hunt.meat['cave-bear'].farmed).toBe(49);
    expect(lines).toEqual([]);
    expect(meatOnHand(s)).toBe(49);
  });

  it('a monster raised in the pasture puts by farmed meat', () => {
    const s = game(1);
    s.research.done.push('monster-tracking', 'bear-taming');
    s.rooms.pasture.volume = 400;
    s.idle = 5;
    assign(s, 'herder', 5);
    expect(setHerd(s, 'cave-bear')).toBe(true);
    s.dragon.hungry = true;
    huntStep(s, 3600, T0, rng(s));
    expect(s.hunt.meat['cave-bear'].farmed).toBeGreaterThan(0);
    expect(monsterDef('cave-bear')!.stat).toBe('might');
  });
});

describe('raids', () => {
  it('the young dragon picks the richest place its Might allows', () => {
    const s = game(1);
    expect(raidTarget(s)).toBeNull();
    s.stage = 2;
    expect(raidTarget(s)!.id).toBe('farmstead');
    expect(nextRaid(s)!.needs[0]).toContain('Might 30');
    s.dragon.trained.might = 10;
    expect(raidTarget(s)!.id).toBe('village');
    s.dragon.trained.might = 50;
    expect(raidTarget(s)!.id).toBe('town');
    expect(nextRaid(s)!.needs).toContain('a bigger dragon');
  });

  it('it goes on its own, eats nothing while away, and comes home with loot and kobolds', () => {
    const s = game(2);
    s.dragon.trained.might = 10;
    s.rooms.hoard.volume = 2_000;
    s.rooms.den.volume = 400;
    const rand = rng(s);
    raidStep(s, T0, rand);
    expect(s.dragon.nextRaidAt).toBe(s.dragon.clock + RAID.firstSeconds);
    s.dragon.clock = s.dragon.nextRaidAt;
    s.dragon.nextRequestAt = 1e12;
    const start = raidStep(s, T0, rand);
    expect(start[0]).toContain('raid a village');
    expect(s.dragon.raid?.target).toBe('village');
    const meat = s.res.meat;
    const copper = s.res.copper;
    tick(s, 3 * 3600 + 20, T0);
    expect(s.dragon.raid).toBeNull();
    expect(s.dragon.raided.village).toBe(1);
    expect(s.res.copper).toBeGreaterThan(copper + 1_000);
    expect(s.res.meat).toBeGreaterThan(meat - 10); // it didn't eat while away (a little after)
    expect(s.oddities['raid-banners']?.count).toBe(1);
    expect(s.dragon.nextRaidAt).toBeGreaterThan(s.dragon.clock + RAID.everySeconds * 0.7);
  });

  it('a lieutenant may ride along and becomes a Dragon-rider', () => {
    const s = game(2);
    s.named.push({ id: 1, name: 'Grek', title: '', hat: 0, job: 'scavenger', loves: 'scavenger', hates: 'digger', traits: [], history: [], lieutenant: true } as any);
    s.dragon.nextRaidAt = 1;
    s.dragon.clock = 10;
    s.dragon.nextRequestAt = 1e12;
    let rode = false;
    for (let i = 0; i < 20 && !rode; i++) {
      s.seed = 100 + i;
      s.dragon.raid = null;
      s.dragon.nextRaidAt = 1;
      raidStep(s, T0, rng(s));
      const raid = s.dragon.raid as GameState['dragon']['raid'];
      if (raid?.rider === 1) {
        s.dragon.clock = raid.until;
        const back = raidStep(s, T0, rng(s));
        expect(back[0]).toContain('rode on its back');
        rode = true;
      }
    }
    expect(rode).toBe(true);
    expect(s.named[0].traits).toContain('Dragon-rider');
  });
});

describe('the elder and ancient dragon', () => {
  it('there are two more stages, and their molts want finer things', () => {
    expect(DRAGON_STAGES.map((d) => d.id)).toEqual(['egg', 'wyrmling', 'young', 'adult', 'elder', 'ancient']);
    const s = game(3);
    const labels = moltNeeds(s)!.map((n) => n.label);
    expect(labels.some((l) => l.includes('gold'))).toBe(true);
    expect(labels.some((l) => l.includes('kinds of gem'))).toBe(true);
    s.stage = 4;
    const elder = moltNeeds(s)!;
    const raid = elder.find((n) => n.label.includes('raid on a city'))!;
    expect(raid.met).toBe(false);
    s.dragon.raided.city = 1;
    expect(moltNeeds(s)!.find((n) => n.label.includes('raid on a city'))!.met).toBe(true);
    expect(MOLTS.find((m) => m.from === 5)).toBeUndefined();
  });

  it('old saves get a fresh hunt, and the dragon keeps its training', () => {
    const s = game(2);
    s.dragon.trained.fire = 12;
    s.hunt.hunted['salamander'] = 3;
    const raw = JSON.parse(JSON.stringify(s));
    const back = normalize(raw, T0);
    expect(back.dragon.trained.fire).toBe(12);
    expect(back.hunt.hunted.salamander).toBe(3);
    delete raw.hunt;
    expect(normalize(raw, T0).hunt.quarry).toBe('cave-bear');
  });
});

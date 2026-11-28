// Hunting: hunters work the hunting grounds the scouts have found (see
// areas.ts), best first, each up to so many kills an hour, and bring back meat. The dragon eats it a bite at a time, and each kind trains one of its
// stats. Hunt enough of one kind and the researchers work out how to keep it
// in the pasture, where it gives a steadier, weaker meat. Pure functions over
// GameState; they return chronicle lines.

import { ANIMALS, thriving, trainCap, type StatId } from './dragon';
import { areaName, fills, found } from './areas';
import { jobDef, jobOutput, store, workers } from './economy';
import { addHistory, fullName, namedIn } from './kobolds';
import { RESEARCH } from './research';
import type { GameState } from './state';

export interface MonsterDef {
  id: string;
  name: string;
  /** Plural, lower case, for lines like "18 cave bears hunted". */
  plural: string;
  /** The stat its meat trains, or all three. */
  stat: StatId | 'all';
  /** Training per bite of wild meat, times HUNT.wildGain. */
  gain: number;
  /** Hunting work to bring one down. */
  work: number;
  /** The first time one is brought down. */
  firstText: string;
}

export const MONSTERS: MonsterDef[] = [
  { id: 'cave-bear', name: 'Cave bear', plural: 'cave bears', stat: 'might', gain: 1, work: 1_800, firstText: 'The hunters dragged home their first cave bear. The dragon ate it in one go and looked bigger for it.' },
  { id: 'salamander', name: 'Salamander', plural: 'salamanders', stat: 'fire', gain: 1, work: 1_800, firstText: 'The hunters brought back a salamander, still smouldering. The dragon hiccupped a little flame.' },
  { id: 'glow-eel', name: 'Glow-eel', plural: 'glow-eels', stat: 'presence', gain: 1, work: 1_500, firstText: 'The hunters netted a glow-eel. The dragon ate it and glowed faintly green for an hour.' },
  { id: 'basilisk', name: 'Basilisk', plural: 'basilisks', stat: 'might', gain: 2, work: 6_000, firstText: 'The hunters brought down a basilisk, looking at it only in a polished shield. The dragon was very impressed.' },
  { id: 'wyvern', name: 'Wyvern', plural: 'wyverns', stat: 'fire', gain: 2, work: 10_000, firstText: 'The hunters brought down a wyvern. The dragon ate it and breathed fire for the first time in a week.' },
  { id: 'elder', name: 'Elder thing', plural: 'elder things', stat: 'all', gain: 3, work: 20_000, firstText: 'The hunters brought something up out of the elder deeps. Nobody will say what it looked like. The dragon ate it and was quiet for a long time.' },
];

export const HUNT = {
  /** Chance a hunt that reaches its quarry brings it down. */
  success: 0.8,
  /** Bites of monster meat per kill. */
  meatPerKill: 4,
  /** And ordinary meat for the larder, per kill. */
  larderPerKill: 15,
  /** Most bites of one monster's meat kept. */
  maxMeat: 200,
  /** The dragon takes a bite of monster meat this often, while thriving and home. */
  eatSeconds: 600,
  /** Stat training per bite: wild meat, and farmed (raised in the pasture). */
  wildGain: 0.25,
  farmedGain: 0.1,
  /** Herders raising a monster put by this much of their meat as monster meat. */
  farmShare: 0.05,
  /** Bones per kill, times the monster's gain, for the shamans. */
  bonesPerKill: 3,
  /** Most bones kept. */
  maxBones: 300,
  /** Kills that put a trophy on the shelf. */
  trophyEvery: 10,
};

export const monsterDef = (id: string) => MONSTERS.find((m) => m.id === id);

/** Hunting work per second, before the grounds' limits. */
export function huntRate(state: GameState): number {
  return fills(state, 'monsters').raw;
}

/** Monsters living on the grounds found so far. */
export function huntableMonsters(state: GameState): MonsterDef[] {
  const ids = new Set(found(state, 'monsters').flatMap((g) => g.monsters ?? []));
  return MONSTERS.filter((m) => ids.has(m.id));
}

/** The research a monster opens once enough are hunted, if any. */
export function farmResearch(monster: string) {
  return RESEARCH.find((r) => r.hunted?.monster === monster);
}

/** Monster meat waiting, all kinds. */
export function meatOnHand(state: GameState): number {
  return Object.values(state.hunt.meat).reduce((a, m) => a + m.wild + m.farmed, 0);
}

function meatOf(state: GameState, id: string) {
  return (state.hunt.meat[id] ??= { wild: 0, farmed: 0 });
}

/** A short note for the hunter row: kills an hour, and how close the next monster is to being kept in the pasture. */
export function huntHint(state: GameState): string | null {
  const f = fills(state, 'monsters');
  let kills = 0;
  for (const x of f.fills) if (x.area) kills += (x.used * 3600) / (x.area.killWork ?? 1);
  for (const m of huntableMonsters(state)) {
    const n = state.hunt.hunted[m.id] ?? 0;
    const farm = farmResearch(m.id);
    if (farm?.hunted && n < farm.hunted.n && !state.research.done.includes(farm.id))
      return `About ${kills < 10 ? Math.round(kills * 10) / 10 : Math.round(kills)} kills an hour. ${m.plural[0].toUpperCase()}${m.plural.slice(1)}: ${n} of ${farm.hunted.n} hunted, then the researchers can work out how to keep them.`;
  }
  return f.raw > 0 ? `About ${kills < 10 ? Math.round(kills * 10) / 10 : Math.round(kills)} kills an hour across ${f.fills.filter((x) => x.used > 0).length} hunting grounds.` : null;
}

/** Let `dt` seconds pass: hunters hunt, pastured monsters breed, and the dragon eats. Returns chronicle lines. */
export function huntStep(state: GameState, dt: number, t: number, rand: () => number): string[] {
  const lines: string[] = [];
  const h = state.hunt;

  // the hunt: each ground worked toward its next kill
  for (const fl of fills(state, 'monsters').fills) {
    const g = fl.area;
    if (!g?.monsters?.length || fl.used <= 0) continue;
    const work = g.killWork ?? 1;
    const prog = (state.explore.progress[g.id] ?? 0) + fl.used * dt;
    state.explore.progress[g.id] = prog;
    for (let guard = 0; guard < 20 && state.explore.progress[g.id] >= work; guard++) {
      state.explore.progress[g.id] -= work;
      if (rand() >= HUNT.success) continue; // it got away
      const m = monsterDef(g.monsters[Math.floor(rand() * g.monsters.length) % g.monsters.length]);
      if (!m) continue;
      const before = h.hunted[m.id] ?? 0;
      h.hunted[m.id] = before + 1;
      const meat = meatOf(state, m.id);
      meat.wild = Math.min(HUNT.maxMeat, meat.wild + HUNT.meatPerKill * (g.meatMult ?? 1));
      store(state, 'meat', HUNT.larderPerKill);
      state.magic.bones = Math.min(HUNT.maxBones, state.magic.bones + HUNT.bonesPerKill * m.gain);
      if (before === 0) {
        const named = namedIn(state, 'hunter');
        const k = named.length ? named[Math.floor(rand() * named.length) % named.length] : null;
        if (k) addHistory(k, t, `Was on the hunt that brought down the first ${m.name.toLowerCase()}, in ${areaName(state, g).replace(/^The /, 'the ')}.`);
        lines.push(k ? `${m.firstText} ${fullName(k)} led the hunt.` : m.firstText);
      }
      const farm = farmResearch(m.id);
      if (farm?.hunted && before + 1 === farm.hunted.n)
        lines.push(`The hunters know ${m.plural} well now. The researchers think they could be kept in the pasture (${farm.name}).`);
      if ((before + 1) % HUNT.trophyEvery === 0) {
        const rec = state.oddities['hunting-trophies'];
        if (rec) rec.count++;
        else {
          state.oddities['hunting-trophies'] = { count: 1, firstAt: t };
          lines.push(`The hunters hung a ${m.name.toLowerCase()} skull over the den door. It is the first of many trophies.`);
        }
      }
    }
  }

  // monsters raised in the pasture
  const animal = ANIMALS.find((a) => a.id === state.herd);
  if (animal?.monster && workers(state, 'herder') > 0) {
    const herder = jobDef('herder');
    const made = herder ? jobOutput(state, herder) * dt * HUNT.farmShare : 0;
    const meat = meatOf(state, animal.monster);
    meat.farmed = Math.min(HUNT.maxMeat, meat.farmed + made);
  }

  // the dragon eats a bite now and then, while it's home and content
  if (thriving(state) && !state.dragon.raid && meatOnHand(state) > 0) {
    h.eatClock += dt;
    for (let guard = 0; guard < 20 && h.eatClock >= HUNT.eatSeconds; guard++) {
      h.eatClock -= HUNT.eatSeconds;
      const line = bite(state);
      if (line) lines.push(line);
    }
  }
  return lines;
}

/** One bite: wild meat first, of whichever stat has the most room to grow. */
function bite(state: GameState): string | null {
  const d = state.dragon;
  const cap = trainCap(state);
  let best: { id: string; wild: boolean; room: number } | null = null;
  for (const [id, meat] of Object.entries(state.hunt.meat)) {
    const mon = monsterDef(id);
    if (!mon) continue;
    const room = mon.stat === 'all' ? Math.max(...(['might', 'fire', 'presence'] as StatId[]).map((x) => cap - d.trained[x])) : cap - d.trained[mon.stat];
    if (room <= 1e-9) continue;
    const wild = meat.wild >= 1;
    if (!wild && meat.farmed < 1) continue;
    if (!best || (wild && !best.wild) || (wild === best.wild && room > best.room)) best = { id, wild, room };
  }
  if (!best) return null;
  const mon = monsterDef(best.id)!;
  const meat = state.hunt.meat[best.id];
  if (best.wild) meat.wild -= 1;
  else meat.farmed -= 1;
  const gain = (best.wild ? HUNT.wildGain * mon.gain : HUNT.farmedGain * mon.gain);
  const stats: StatId[] = mon.stat === 'all' ? ['might', 'fire', 'presence'] : [mon.stat];
  const lines: string[] = [];
  for (const st of stats) {
    const was = d.trained[st];
    d.trained[st] = Math.min(cap, was + gain);
    if (was < cap && d.trained[st] >= cap - 1e-9) {
      const name = st === 'might' ? 'Might' : st === 'fire' ? 'Fire' : 'Presence';
      lines.push(`The dragon's ${name} is as high as it can go at this size. It will need to molt to grow stronger.`);
    }
  }
  return lines.length ? lines.join(' ') : null;
}

// Things that happen on their own as the warren works: digging turns things
// up, kobolds find they have a knack for their job, and the very best of them
// earn an epithet. Pure functions over GameState; they return chronicle lines.

import { IDLE, JOBS, type RoomDef } from './data';
import { beds, jobOpen, population, resourceOpen, store, workers } from './economy';
import { addHistory, addTalent, canName, EPITHET_MULT, fullName, nameKobold, nameOrCredit, namedIn, personalMult, type NamedKobold } from './kobolds';
import type { GameState } from './state';

function pick<T>(xs: T[], rand: () => number): T {
  return xs[Math.floor(rand() * xs.length) % xs.length];
}

function addOddity(state: GameState, id: string, n: number, t: number) {
  const rec = state.oddities[id];
  if (rec) rec.count += n;
  else state.oddities[id] = { count: n, firstAt: t };
}

// ---------- digging finds ----------

export const FIND = {
  /** Chance of a find for each cubic pace dug. */
  perPace: 1 / 250,
  /** Chance the digger who found it is named (or, if a named digger, gains an experience). */
  credit: 0.5,
};

interface FindDef {
  id: string;
  weight: number;
  /** Does what it does and returns the line, or null if it can't happen now. {room} and {kobold} are filled in. */
  apply: (state: GameState, room: RoomDef, rand: () => number, t: number) => string | null;
}

export const FINDS: FindDef[] = [
  {
    id: 'coins',
    weight: 4,
    apply: (s, _room, rand) => {
      const n = Math.round(100 + rand() * 400) * Math.max(1, s.stage);
      const kept = store(s, 'copper', n);
      return kept >= 1 ? `{kobold} dug into a forgotten stash of copper in the {room}. (+${Math.floor(kept).toLocaleString('en-US')} copper)` : null;
    },
  },
  {
    id: 'ore',
    weight: 3,
    apply: (s, _room, rand) => {
      if (!resourceOpen(s, 'ore')) return null;
      const kept = store(s, 'ore', Math.round(20 + rand() * 60));
      return kept >= 1 ? `{kobold} hit a pocket of iron ore while digging the {room}. (+${Math.floor(kept)} iron ore)` : null;
    },
  },
  {
    id: 'bones',
    weight: 3,
    apply: (s, _room, _rand, t) => {
      addOddity(s, 'old-bones', 1, t);
      return `{kobold} dug up some very old bones in the {room}. Everyone agrees they belonged to something enormous, and that it's definitely gone.`;
    },
  },
  {
    id: 'side-cave',
    weight: 2,
    apply: (s, room, rand) => {
      const add = Math.round(10 + rand() * 30);
      const r = (s.rooms[room.id] ??= { volume: room.start });
      r.volume += add;
      return `{kobold} broke through into a forgotten side cave off the {room}. (+${add} cubic paces, free)`;
    },
  },
  {
    id: 'lost-kobold',
    weight: 2,
    apply: (s) => {
      if (population(s) >= beds(s)) return null;
      s.idle += 1;
      return `{kobold} dug into a lost kobold who had been living in the walls of the {room} for weeks. They've moved into the den.`;
    },
  },
];

/** Maybe turn something up while digging `paces` of a room. Returns a chronicle line, or null. */
export function digFinds(state: GameState, room: RoomDef, paces: number, rand: () => number, t: number): string | null {
  if (!state.chief || !(paces > 0) || rand() >= paces * FIND.perPace) return null;
  const total = FINDS.reduce((a, f) => a + f.weight, 0);
  let roll = rand() * total;
  const f = FINDS.find((x) => (roll -= x.weight) < 0) ?? FINDS[0];
  const line = f.apply(state, room, rand, t);
  if (!line) return null;
  // who found it: a named digger, someone from the crew who earns a name, or just "a digger"
  let who = 'A digger';
  let k: NamedKobold | null = null;
  const named = namedIn(state, 'digger');
  if (rand() < FIND.credit) {
    if (named.length && rand() < 0.5) {
      k = pick(named, rand);
      who = fullName(k);
    } else if ((state.crews.digger?.n ?? 0) > 0 || named.length) {
      const got = nameOrCredit(state, 'digger', pick(['Lucky-pick', 'the Finder', 'Deepnose', 'Rubble-rummager'], rand), t, rand);
      if (got) {
        k = got.k;
        who = got.fresh ? `A digger, now ${fullName(k)},` : fullName(k);
      }
    }
  }
  const text = line.replaceAll('{room}', room.name.toLowerCase()).replaceAll('{kobold}', who);
  if (k) addHistory(k, t, line.replaceAll('{room}', room.name.toLowerCase()).replaceAll('{kobold}', k.name));
  return text;
}

// ---------- discovered talents ----------

export const TALENT = {
  /**
   * Someone in a crew finds a knack about once in this many hours, divided by
   * the square root of the crew's size: bigger crews find more, but not in proportion.
   */
  crowdHours: 24 * 3,
  /** ...and a named one, who is paying more attention, once in this many. */
  namedHours: 24 * 3,
  /** Kobolds who love their job find a knack this much more often. */
  loveMult: 2,
  /** How much better a talent makes them at the job. */
  mult: 1.25,
};

/** Knacks for each job: [name, how it showed up]. */
export const TALENTS: Record<string, [string, string][]> = {
  scavenger: [
    ['Magpie eyes', 'spotted a coin glinting from across the whole cavern'],
    ['Deep pockets', 'turned out to have pockets nobody knew about'],
    ['Coin-sniffer', 'could smell copper through a wall'],
  ],
  woodcutter: [
    ['Mushroom-whisperer', 'found the giant mushrooms just fall over for them'],
    ['Steady-handed', 'felled a whole stalk without a single wobble'],
  ],
  quarrier: [
    ['Stone-reader', 'knew exactly where the stone would split'],
    ['Rockjaw', 'could break a block just by glaring at it'],
  ],
  digger: [
    ['Tunnel-sense', 'always knew which way the soft earth was'],
    ['Shovel-hands', 'dug faster with their claws than with the shovel'],
  ],
  researcher: [
    ['Bright spark', 'had an idea so good it went off like a firework, but quietly'],
    ['Note-keeper', 'kept notes nobody else could read, which were always right'],
  ],
  miner: [
    ['Seam-finder', 'followed an ore seam by ear'],
    ['Dark-eyed', 'turned out to see fine in the deepest tunnels'],
  ],
  herder: [
    ['Crab-charmer', 'had the whole herd following them about'],
    ['Soft-voiced', 'could settle any animal with a hum'],
  ],
  alchemist: [['Steady pour', 'never spilled a drop, which is a first for the lab']],
  blacksmith: [
    ['Fire-proof', 'turned out not to mind the heat of the forge at all'],
    ['True-hammer', 'never missed the anvil, not once'],
  ],
};

/** The epithet a kobold earns for being remarkable at a job. */
export const EPITHETS: Record<string, string> = {
  scavenger: 'finds coins like a dragon',
  woodcutter: 'fells mushrooms like a dragon',
  quarrier: 'breaks stone like a dragon',
  digger: 'digs like a dragon',
  researcher: 'thinks like a dragon',
  miner: 'mines like a dragon',
  herder: 'herds like a dragon',
  alchemist: 'brews like a dragon',
  blacksmith: 'breathes on the forge like a dragon',
};

/** Let `dt` seconds of work happen: some kobolds find they have a knack for their job. */
export function talentStep(state: GameState, dt: number, t: number, rand: () => number): string[] {
  if (!state.chief) return [];
  const lines: string[] = [];
  for (const def of JOBS) {
    const list = TALENTS[def.id];
    if (!list || !jobOpen(state, def)) continue;
    // a named kobold in the job
    for (const k of namedIn(state, def.id)) {
      const chance = (dt / (TALENT.namedHours * 3600)) * (k.loves === def.id ? TALENT.loveMult : 1);
      if (rand() >= chance) continue;
      const [name, how] = pick(list, rand);
      if (!addTalent(k, { job: def.id, mult: TALENT.mult, name })) continue;
      addHistory(k, t, `Found they had a knack for the work: they ${how}. (${name})`);
      lines.push(`${fullName(k)} ${how}. They have a knack for it: ${name}.`);
    }
    // someone from the crowd crew, who earns a name for it
    const n = state.crews[def.id]?.n ?? 0;
    if (n < 1 || rand() >= (Math.sqrt(n) * dt) / (TALENT.crowdHours * 3600)) continue;
    const [name, how] = pick(list, rand);
    if (canName(state)) {
      const k = nameKobold(state, def.id, titleFor(name), '', t, rand);
      if (!k) continue;
      k.history = [];
      addTalent(k, { job: def.id, mult: TALENT.mult, name });
      addHistory(k, t, `Found they had a knack for the work: they ${how}. (${name})`);
      lines.push(`One of the ${def.name.toLowerCase()}s ${how}. From now on they are ${fullName(k)}.`);
      continue;
    }
    // the warren has all the names it needs: a named kobold on the job picks up the knack instead
    const named = namedIn(state, def.id).filter((k) => !(k.talents ?? []).some((x) => x.name === name));
    if (!named.length) continue;
    const k = pick(named, rand);
    addTalent(k, { job: def.id, mult: TALENT.mult, name });
    addHistory(k, t, `Found they had a knack for the work: they ${how}. (${name})`);
    lines.push(`${fullName(k)} ${how}. They have a knack for it: ${name}.`);
  }
  return lines;
}

/** A title from a talent: "Magpie eyes" makes "the Magpie-eyes". */
function titleFor(talent: string): string {
  return `the ${talent.replace(/ /g, '-')}`;
}

/** Give an epithet to anyone remarkable enough at their job. Returns chronicle lines. */
export function epithetStep(state: GameState, t: number): string[] {
  const lines: string[] = [];
  for (const k of state.named) {
    if (k.epithet || k.job === IDLE || !EPITHETS[k.job] || workers(state, k.job) === 0) continue;
    if (personalMult(k) < EPITHET_MULT) continue;
    k.epithet = EPITHETS[k.job];
    addHistory(k, t, `Became known as the kobold who ${k.epithet}.`);
    lines.push(`Word has got round the warren: ${fullName(k)} ${k.epithet}.`);
  }
  return lines;
}

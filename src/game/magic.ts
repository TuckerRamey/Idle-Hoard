// Shaman magic: shamans draw mana out of monster bones (from the hunters) and
// dragon dust (ground from shed scales and skins), and spend it on rituals.
// From the elder dragon on, it now and then casts a spell of its own. Pure
// functions over GameState; they return chronicle lines.

import { GEMS } from './data';
import { thriving } from './dragon';
import { assign, beds, jobDef, jobOpen, jobOutput, population, store } from './economy';
import { IDLE } from './data';
import type { GameState } from './state';

export const MAGIC = {
  /** Mana from one bone, and from one pinch of dust (dust is richer, and used first). */
  manaPerBone: 5,
  manaPerDust: 10,
  /** Most mana held at once. */
  maxMana: 200,
  /** Dust ground from each shed scale or skin. */
  dustPerScale: 5,
  /** Stone-song: diggers work this much faster. */
  stoneSongMult: 2,
  /** Bless the dragon: its stats count this much more for its next raid. */
  blessMult: 1.25,
  /** An elder dragon casts a spell of its own about this often, the first a few hours after it molts. */
  spellSeconds: 18 * 3600,
  firstSpellSeconds: 6 * 3600,
};

export interface RitualDef {
  id: 'bless' | 'stone-song' | 'read-bones' | 'charm';
  name: string;
  cost: number;
  text: string;
  /** Said in the chronicle when it's done. */
  line: string;
}

export const RITUALS: RitualDef[] = [
  {
    id: 'bless',
    name: 'Bless the dragon',
    cost: 60,
    text: 'All its stats count 25% more for its next raid, so it can reach a richer place early and brings back more.',
    line: 'The shamans painted runes on the dragon’s scales while it slept. It woke up feeling braver than usual.',
  },
  {
    id: 'stone-song',
    name: 'Stone-song',
    cost: 40,
    text: 'The shamans sing to the stone, and it gives way: digging goes twice as fast for an hour.',
    line: 'The shamans started the stone-song. The walls are humming, and the diggers can hardly keep up.',
  },
  {
    id: 'read-bones',
    name: 'Read the bones',
    cost: 30,
    text: 'For a day, the bones show what the dragon will crave next, and where it will raid and what it might bring back.',
    line: 'The shamans threw the bones. They say they can see a whole day ahead now, which mostly means they keep saying "I knew it".',
  },
  {
    id: 'charm',
    name: 'Lucky charm',
    cost: 50,
    text: 'The next 3 finds by diggers and miners are at least uncommon.',
    line: 'The shamans hung lucky charms in the tunnels. Everyone is touching them on the way past.',
  },
];

export const ritualDef = (id: string) => RITUALS.find((r) => r.id === id);

/** Is the shaman job open, so rituals can be done at all? */
export function magicOpen(state: GameState): boolean {
  const def = jobDef('shaman');
  return !!def && jobOpen(state, def);
}

/** Why a ritual can't be done right now, or null if it can. */
export function ritualBlocked(state: GameState, r: RitualDef): string | null {
  const m = state.magic;
  if (!magicOpen(state)) return 'Needs shamans';
  if (r.id === 'bless') {
    if (state.stage < 2) return 'The dragon is too young to raid';
    if (m.blessed) return 'Already blessed for its next raid';
  }
  if (r.id === 'stone-song' && m.stoneSong > 0) return 'Already singing';
  if (r.id === 'read-bones' && m.vision > 0) return 'Already read';
  if (m.mana < r.cost) return `Needs ${r.cost} mana`;
  return null;
}

/** Do a ritual. Returns its chronicle line, or null if it can't be done. */
export function performRitual(state: GameState, id: string): string | null {
  const r = ritualDef(id);
  if (!r || ritualBlocked(state, r)) return null;
  const m = state.magic;
  m.mana -= r.cost;
  if (r.id === 'bless') m.blessed = true;
  else if (r.id === 'stone-song') m.stoneSong = 3600;
  else if (r.id === 'read-bones') m.vision = 86_400;
  else m.charms += 3;
  return r.line;
}

/** Mana the shamans draw per second, at full pace. */
export function manaRate(state: GameState): number {
  const def = jobDef('shaman');
  return def && jobOpen(state, def) ? jobOutput(state, def) : 0;
}

/** A short note for the shaman row. */
export function shamanHint(state: GameState): string | null {
  const m = state.magic;
  if (manaRate(state) <= 0) return null;
  if (m.mana >= MAGIC.maxMana - 1e-6) return `Mana is full (${MAGIC.maxMana}). Spend some on a ritual in the Leadership tab.`;
  if (m.bones < 1 && m.dust < 1) return 'Out of bones and dragon dust. Hunters bring back bones; the dragon’s shed scales grind into dust.';
  return `${Math.floor(m.bones)} bones and ${Math.floor(m.dust)} dragon dust to work with. Rituals are on the Leadership tab.`;
}

// ---------- the dragon's own spells ----------

interface SpellDef {
  id: string;
  stage: number;
  cast: (state: GameState, rand: () => number) => string | null;
}

const SPELLS: SpellDef[] = [
  {
    id: 'ember-gift',
    stage: 4,
    cast: (state) => {
      const m = state.magic;
      if (!magicOpen(state)) return null;
      m.mana = Math.min(MAGIC.maxMana, m.mana + 100);
      return 'The dragon breathed on the shamans’ fire, very gently. It burned blue all night. (+100 mana)';
    },
  },
  {
    id: 'golden-breath',
    stage: 4,
    cast: (state) => {
      const c = Math.min(state.res.copper * 0.05, 500_000);
      if (c < 100) return null;
      state.res.copper -= c;
      const kept = store(state, 'gold', c / 50);
      return `The dragon breathed over the copper in its sleep, and some of it came out gold. (+${Math.floor(kept).toLocaleString('en-US')} gold)`;
    },
  },
  {
    id: 'hoard-call',
    stage: 5,
    cast: (state) => {
      const n = Math.min(10, beds(state) - population(state));
      if (n < 1) return null;
      state.idle += n;
      const job = jobDef(state.newcomerJob);
      if (state.newcomerJob !== IDLE && job && jobOpen(state, job)) assign(state, state.newcomerJob, n);
      return `The dragon called out in its sleep, a sound you feel more than hear. By morning ${n} kobold${n === 1 ? ' had' : 's had'} found their way to the hoard.`;
    },
  },
  {
    id: 'dream-gem',
    stage: 5,
    cast: (state, rand) => {
      const pool = GEMS.filter((g) => g.rarity === 'rare' || g.rarity === 'very rare');
      const g = pool[Math.floor(rand() * pool.length) % pool.length];
      state.gems[g.id] = (state.gems[g.id] ?? 0) + 1;
      return `The dragon dreamed of a ${g.name.toLowerCase()}, and when it woke, there it was on the hoard. (+${g.value.toLocaleString('en-US')} worth)`;
    },
  },
];

/** Let `dt` seconds pass: dust is ground, shamans draw mana, rituals wear off, and an old dragon casts spells. */
export function magicStep(state: GameState, dt: number, _t: number, rand: () => number): string[] {
  const lines: string[] = [];
  const m = state.magic;

  // shed scales and skins are ground into dust
  const scales = (state.oddities['shed-scales']?.count ?? 0) + (state.oddities['shed-skins']?.count ?? 0);
  if (scales > m.ground) {
    m.dust += (scales - m.ground) * MAGIC.dustPerScale;
    m.ground = scales;
  }

  // shamans draw mana, dust first
  let want = Math.min(manaRate(state) * dt, MAGIC.maxMana - m.mana);
  if (want > 0) {
    const fromDust = Math.min(want, m.dust * MAGIC.manaPerDust);
    m.dust -= fromDust / MAGIC.manaPerDust;
    want -= fromDust;
    const fromBones = Math.min(want, m.bones * MAGIC.manaPerBone);
    m.bones -= fromBones / MAGIC.manaPerBone;
    m.mana += fromDust + fromBones;
  }

  // rituals wear off
  if (m.stoneSong > 0) {
    m.stoneSong = Math.max(0, m.stoneSong - dt);
    if (m.stoneSong === 0) lines.push('The stone-song has ended. The walls have gone quiet again.');
  }
  if (m.vision > 0) m.vision = Math.max(0, m.vision - dt);

  // an elder dragon casts spells of its own
  const d = state.dragon;
  if (state.stage >= 4 && !d.raid && thriving(state)) {
    if (!m.nextSpellAt) m.nextSpellAt = d.clock + MAGIC.firstSpellSeconds;
    else if (d.clock >= m.nextSpellAt) {
      m.nextSpellAt = d.clock + MAGIC.spellSeconds * (0.75 + rand() * 0.5);
      const open = SPELLS.filter((s) => state.stage >= s.stage);
      // try a couple, in case one has nothing to work with
      for (let i = 0; i < 3; i++) {
        const line = open[Math.floor(rand() * open.length) % open.length].cast(state, rand);
        if (line) {
          lines.push(line);
          break;
        }
      }
    }
  }
  return lines;
}

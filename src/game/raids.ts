// Raids: from the young dragon on, it flies off now and then on its own to
// raid the richest place it's strong enough for. Might decides where it dares
// to go, Fire how much it brings back, and Presence how many kobolds follow it
// home. Pure functions over GameState; they return chronicle lines.

import { GEMS, type ResourceId } from './data';
import { dragonStat, thriving, type StatId } from './dragon';
import { MAGIC } from './magic';
import { assign, beds, jobDef, jobOpen, population, store } from './economy';
import { addHistory, findNamed, fullName, lieutenants, type NamedKobold } from './kobolds';
import type { GameState } from './state';
import { IDLE } from './data';

type Range = [number, number];

export interface RaidDef {
  id: string;
  /** Lower case, as in "a raid on a village". */
  name: string;
  might: number;
  fire?: number;
  minStage: number;
  hours: number;
  loot: Partial<Record<ResourceId, Range>>;
  /** Chance of a gem, and how rare. */
  gems?: { n: number; chance: number; rarity: 'uncommon' | 'rare' | 'very rare'; better?: number };
  /** A rare metal, now and then. */
  adamantChance?: number;
  /** Kobolds who follow it home, before Presence. */
  recruits: Range;
  /** A one-off thing for the shelf, the first time. */
  oddity?: string;
  /** How it went. {dragon} is "The dragon". */
  text: string;
}

export const RAIDS: RaidDef[] = [
  {
    id: 'farmstead', name: 'farmstead', might: 0, minStage: 2, hours: 2,
    loot: { copper: [300, 800], silver: [0, 20] }, recruits: [0, 1],
    text: 'The dragon came back from a farmstead with a cart, the cart\'s contents, and most of a fence.',
  },
  {
    id: 'village', name: 'village', might: 30, minStage: 2, hours: 3,
    loot: { copper: [2_000, 5_000], silver: [100, 300] }, gems: { n: 1, chance: 0.3, rarity: 'uncommon' }, recruits: [1, 3],
    text: 'The dragon came back from a village with the tithe barn\'s strongbox. The villagers may never come out of their cellars.',
  },
  {
    id: 'town', name: 'town', might: 60, minStage: 2, hours: 4,
    loot: { copper: [5_000, 15_000], silver: [500, 1_500], gold: [20, 80] }, gems: { n: 1, chance: 0.4, rarity: 'rare' }, recruits: [2, 5], oddity: 'town-bell',
    text: 'The dragon came back from a town with the treasury, the mayor\'s chain and, for some reason, the town bell.',
  },
  {
    id: 'dwarf-hold', name: 'dwarf hold', might: 100, minStage: 3, hours: 5,
    loot: { silver: [2_000, 5_000], gold: [200, 600], mithril: [2, 6] }, gems: { n: 1, chance: 1, rarity: 'rare' }, adamantChance: 0.25, recruits: [0, 2],
    text: 'The dragon came back from a dwarf hold with its hoard in its claws. The dwarves had a great deal to say about it.',
  },
  {
    id: 'city', name: 'city', might: 160, minStage: 4, hours: 6,
    loot: { silver: [5_000, 15_000], gold: [2_000, 6_000] }, gems: { n: 2, chance: 1, rarity: 'rare', better: 0.15 }, recruits: [5, 10],
    text: 'The dragon came back from a city. The sky over it was orange for a day. It brought home the royal treasury, and the kobolds who lived in its sewers.',
  },
  {
    id: 'wizard-tower', name: "wizard's tower", might: 220, fire: 150, minStage: 4, hours: 6,
    loot: { gold: [3_000, 8_000], mithril: [5, 15] }, gems: { n: 2, chance: 1, rarity: 'rare', better: 0.5 }, adamantChance: 0.5, recruits: [0, 0], oddity: 'wizard-hat',
    text: 'The dragon came back from a wizard\'s tower singed, sparkling, and very pleased with itself.',
  },
];

export const RAID = {
  /** Stage it starts raiding at (young). */
  fromStage: 2,
  /** The first raid comes this long after it's able, then about this often (give or take a quarter). */
  firstSeconds: 2 * 3600,
  everySeconds: 12 * 3600,
  /** Loot times (1 + Fire × this), and kobolds who follow it times (1 + Presence × this). */
  firePerPoint: 1 / 300,
  presencePerPoint: 1 / 100,
  /** Chance a kobold rides along, when there's one who could. */
  riderChance: 0.6,
};

export const raidDef = (id: string) => RAIDS.find((r) => r.id === id);

/** A stat as it counts for the next raid: a shaman's blessing makes it count for more. */
export function raidStat(state: GameState, id: StatId, blessed = state.magic.blessed): number {
  return Math.floor(dragonStat(state, id) * (blessed ? MAGIC.blessMult : 1));
}

export function raidOpen(state: GameState, r: RaidDef): boolean {
  return state.stage >= r.minStage && raidStat(state, 'might') >= r.might && raidStat(state, 'fire') >= (r.fire ?? 0);
}

/** The richest place it would raid now. */
export function raidTarget(state: GameState): RaidDef | null {
  if (state.stage < RAID.fromStage) return null;
  let best: RaidDef | null = null;
  for (const r of RAIDS) if (raidOpen(state, r)) best = r;
  return best;
}

/** The next place up, and what it still needs. */
export function nextRaid(state: GameState): { def: RaidDef; needs: string[] } | null {
  const cur = raidTarget(state);
  const i = cur ? RAIDS.indexOf(cur) : -1;
  const def = RAIDS[i + 1];
  if (!def) return null;
  const needs: string[] = [];
  const might = raidStat(state, 'might');
  const fire = raidStat(state, 'fire');
  if (state.stage < def.minStage) needs.push('a bigger dragon');
  if (might < def.might) needs.push(`Might ${def.might} (has ${might})`);
  if (def.fire && fire < def.fire) needs.push(`Fire ${def.fire} (has ${fire})`);
  return { def, needs };
}

/** What the bones say a raid will bring back: each loot range at today's Fire. */
export function raidForecast(state: GameState, def: RaidDef): string {
  const mult = 1 + raidStat(state, 'fire') * RAID.firePerPoint;
  const parts = (Object.entries(def.loot) as [ResourceId, Range][]).map(
    ([res, [a, b]]) => `${fmt(a * mult * 0.7)} to ${fmt(b * mult * 1.3)} ${res === 'ore' ? 'iron ore' : res}`,
  );
  if (def.gems) parts.push(def.gems.chance >= 1 ? `${def.gems.n === 1 ? 'a gem' : `${def.gems.n} gems`}` : 'maybe a gem');
  if (def.adamantChance) parts.push('maybe adamant');
  return parts.join(', ');
}

function roll([a, b]: Range, rand: () => number): number {
  return a + rand() * (b - a);
}

function pickRider(state: GameState, rand: () => number): NamedKobold | null {
  const riders = state.named.filter((k) => k.traits.includes('Dragon-rider'));
  const pool = riders.length ? riders : lieutenants(state);
  if (!pool.length || rand() >= RAID.riderChance) return null;
  return pool[Math.floor(rand() * pool.length) % pool.length];
}

function addGem(state: GameState, rarity: 'uncommon' | 'rare' | 'very rare', rand: () => number, t: number): string {
  const pool = GEMS.filter((g) => g.rarity === rarity);
  const g = pool[Math.floor(rand() * pool.length) % pool.length];
  if (!state.gems[g.id]) {
    const rec = state.oddities['first-gems'];
    if (rec) rec.count++;
    else state.oddities['first-gems'] = { count: 1, firstAt: t };
  }
  state.gems[g.id] = (state.gems[g.id] ?? 0) + 1;
  return g.name.toLowerCase();
}

const fmt = (n: number) => Math.floor(n).toLocaleString('en-US');

/** Bring the loot home. Returns the lines. */
function comeHome(state: GameState, def: RaidDef, rider: NamedKobold | null, blessed: boolean, t: number, rand: () => number): string[] {
  const mult = (1 + raidStat(state, 'fire', blessed) * RAID.firePerPoint) * (0.7 + rand() * 0.6);
  const got: string[] = [];
  let lost = false;
  for (const [res, range] of Object.entries(def.loot) as [ResourceId, Range][]) {
    const n = Math.round(roll(range, rand) * mult);
    if (n < 1) continue;
    if ((res === 'mithril' || res === 'adamant') && !state.discovered.includes(res)) state.discovered.push(res);
    const kept = store(state, res, n);
    if (kept < n - 0.5) lost = true;
    if (kept >= 1) got.push(`${fmt(kept)} ${res === 'ore' ? 'iron ore' : res}`);
  }
  if (def.adamantChance && rand() < def.adamantChance) {
    if (!state.discovered.includes('adamant')) state.discovered.push('adamant');
    if (store(state, 'adamant', 1) >= 1) got.push('a lump of adamant');
  }
  if (def.gems)
    for (let i = 0; i < def.gems.n; i++) {
      if (rand() >= def.gems.chance) continue;
      const rarity = def.gems.better && rand() < def.gems.better ? 'very rare' : def.gems.rarity;
      got.push(`a ${addGem(state, rarity, rand, t)}`);
    }
  // kobolds who follow it home, as long as there are beds
  const want = Math.round(roll(def.recruits, rand) * (1 + raidStat(state, 'presence', blessed) * RAID.presencePerPoint));
  const n = Math.max(0, Math.min(want, beds(state) - population(state)));
  if (n > 0) {
    state.idle += n;
    const job = jobDef(state.newcomerJob);
    if (state.newcomerJob !== IDLE && job && jobOpen(state, job)) assign(state, state.newcomerJob, n);
  }
  // keepsakes
  const banners = state.oddities['raid-banners'];
  if (banners) banners.count++;
  else state.oddities['raid-banners'] = { count: 1, firstAt: t };
  if (def.oddity && !state.oddities[def.oddity]) state.oddities[def.oddity] = { count: 1, firstAt: t };
  state.dragon.raided[def.id] = (state.dragon.raided[def.id] ?? 0) + 1;

  let line = def.text;
  if (got.length) line += ` (${got.join(', ')}${lost ? '; the hoard room was too full for the rest' : ''})`;
  if (n > 0) line += ` ${n === 1 ? 'A kobold' : `${n} kobolds`} followed it home and moved in.`;
  else if (want > 0) line += ' Some kobolds followed it home, but there were no beds, so they went away again.';
  if (rider) {
    line += ` ${fullName(rider)} rode on its back the whole way.`;
    addHistory(rider, t, `Rode the dragon on a raid on a ${def.name}.`);
    if (!rider.traits.includes('Dragon-rider')) rider.traits.push('Dragon-rider');
  }
  return [line];
}

/** Let `dt` seconds pass for raiding (after dragonStep has moved the dragon's clock). Returns chronicle lines. */
export function raidStep(state: GameState, t: number, rand: () => number): string[] {
  const d = state.dragon;
  if (state.stage < RAID.fromStage) return [];
  if (d.raid) {
    if (d.clock < d.raid.until) return [];
    const def = raidDef(d.raid.target);
    const rider = d.raid.rider !== null ? (findNamed(state, d.raid.rider) ?? null) : null;
    const blessed = d.raid.blessed === true;
    d.raid = null;
    d.nextRaidAt = d.clock + RAID.everySeconds * (0.75 + rand() * 0.5);
    return def ? comeHome(state, def, rider, blessed, t, rand) : [];
  }
  if (!d.nextRaidAt) {
    d.nextRaidAt = d.clock + RAID.firstSeconds;
    return [];
  }
  if (d.clock < d.nextRaidAt || !thriving(state)) return [];
  const def = raidTarget(state);
  if (!def) return [];
  const rider = pickRider(state, rand);
  const blessed = state.magic.blessed;
  state.magic.blessed = false;
  d.raid = { target: def.id, until: d.clock + def.hours * 3600, rider: rider?.id ?? null, ...(blessed ? { blessed } : {}) };
  const first = Object.values(d.raided).reduce((a, n) => a + n, 0) === 0;
  return [
    `${first ? 'For the first time, the dragon' : 'The dragon'} stretched its wings and flew off to raid a ${def.name}${blessed ? ', the shamans’ runes still glowing on its scales' : ''}${rider ? `, with ${fullName(rider)} clinging to its back` : ''}. It should be back in about ${def.hours} hours.`,
  ];
}

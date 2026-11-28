// Gathering areas and exploring. Woodcutters, miners and scavengers work
// areas, and hunters work hunting grounds. Each gives at most so much a
// second (or kills an hour), with its own mix of what comes out. Kobolds fill
// the best areas first; once all of a kind are giving their most, more
// kobolds add nothing. Scouts find more by exploring. Pure functions over
// GameState; steps return chronicle lines.

import { CROP_FINDS, discoverCrop } from './farms';
import type { ResourceId } from './data';
import { capacity, jobDef, jobOpen, jobOutput, resourceOpen, store, workers } from './economy';
import { WORK_FINDS } from './finds';
import { addHistory, fullName, namedIn } from './kobolds';
import { givePiece, piece } from './gear';
import { opened, researchEffects } from './research';
import type { GameState } from './state';

export type AreaKind = 'wood' | 'stone' | 'copper' | 'monsters';

export interface AreaDef {
  id: string;
  kind: AreaKind;
  name: string;
  /** The most it gives: per second for gathering, kills an hour for hunting grounds. */
  cap: number;
  /** What share of its output comes out as each resource (gathering). */
  mix?: Partial<Record<ResourceId, number>>;
  /** Monsters living there (hunting grounds), one picked at random per kill. */
  monsters?: string[];
  /** Hunting work for one kill here. */
  killWork?: number;
  /** Monster meat per kill, times this (bigger monsters). */
  meatMult?: number;
  /** Now and then, per unit gathered: a common gem, mana, mithril, adamant, or a weapon for the shelf. */
  extras?: { amber?: number; mana?: number; mithril?: number; adamant?: number; weapon?: number };
  /** Rare finds are this much likelier for the miners while they work it. */
  luck?: number;
  /** Dragon stage before it can be found. */
  minStage?: number;
  /** Only past a deep room. */
  deep?: boolean;
  /** What it says in the chronicle when it's found. */
  foundText: string;
}

/** Worst first within each kind: kobolds fill them from the end of the list. */
export const AREAS: AreaDef[] = [
  // woodland
  { id: 'grove', kind: 'wood', name: 'The grove outside the hoard', cap: 6, mix: { wood: 1 }, foundText: 'The scouts found a grove of giant mushrooms just outside the hoard. Woodcutters can work it now.' },
  { id: 'mushroom-thicket', kind: 'wood', name: 'Mushroom thicket', cap: 8, mix: { wood: 1 }, foundText: 'The scouts found a mushroom thicket so dense they had to chew their way out.' },
  { id: 'petrified-grove', kind: 'wood', name: 'Petrified grove', cap: 8, mix: { wood: 0.7, stone: 0.3 }, foundText: 'The scouts found a petrified grove: half mushroom, half stone, all heavy.' },
  { id: 'glowcap-forest', kind: 'wood', name: 'Glowcap forest', cap: 10, mix: { wood: 1 }, extras: { mana: 0.0005 }, minStage: 2, foundText: 'The scouts found a forest of glowcaps. The shamans say the light in them is good for something.' },
  { id: 'old-growth', kind: 'wood', name: 'Old-growth stand', cap: 20, mix: { wood: 1 }, extras: { amber: 1 / 5000 }, minStage: 3, foundText: 'The scouts found an old-growth stand. Some of the stalks drip amber.' },
  // stone
  { id: 'rubble-cave', kind: 'stone', name: 'The rubble cave', cap: 6, mix: { stone: 1 }, foundText: 'The scouts found a cave full of loose rubble. Miners can work it now.' },
  { id: 'granite-face', kind: 'stone', name: 'Granite face', cap: 8, mix: { stone: 0.8, ore: 0.2 }, foundText: 'The scouts found a granite face with rusty streaks in it.' },
  { id: 'iron-seam', kind: 'stone', name: 'Iron seam', cap: 8, mix: { stone: 0.5, ore: 0.5 }, foundText: 'The scouts found an iron seam. It smells exactly like the lab.' },
  { id: 'gem-pocket', kind: 'stone', name: 'Gem pocket', cap: 4, mix: { stone: 1 }, luck: 3, minStage: 1, foundText: 'The scouts found a gem pocket. Small, but it glitters.' },
  { id: 'silver-lode', kind: 'stone', name: 'Silver lode', cap: 6, mix: { stone: 0.5, ore: 0.3, silver: 0.2 }, minStage: 2, foundText: 'The scouts found a silver lode. The dragon pretended not to be interested.' },
  { id: 'deep-vein', kind: 'stone', name: 'The deep vein', cap: 15, mix: { ore: 0.6, stone: 0.4 }, extras: { mithril: 1 / 3000 }, minStage: 3, deep: true, foundText: 'Down past the deepest room, the miners found the deep vein. Something in it rings like a bell.' },
  { id: 'adamant-shelf', kind: 'stone', name: 'Adamant shelf', cap: 6, mix: { ore: 1 }, extras: { adamant: 1 / 20000 }, minStage: 4, deep: true, foundText: 'The scouts found a shelf of black rock that blunted every pick they had. Adamant.' },
  // copper
  { id: 'near-tunnels', kind: 'copper', name: 'The near tunnels', cap: 15, mix: { copper: 1 }, foundText: '' },
  { id: 'collapsed-mine', kind: 'copper', name: 'Collapsed mine', cap: 20, mix: { copper: 0.9, ore: 0.1 }, foundText: 'The scouts found a collapsed mine, left by someone long gone, with copper still in the carts.' },
  { id: 'old-battlefield', kind: 'copper', name: 'Old battlefield', cap: 30, mix: { copper: 0.9, steel: 0.1 }, extras: { weapon: 1 / 20000 }, minStage: 1, foundText: 'The scouts found an old battlefield, all rusty armor and dropped purses.' },
  { id: 'drowned-treasury', kind: 'copper', name: 'Drowned treasury', cap: 60, mix: { copper: 0.85, silver: 0.12, gold: 0.03 }, minStage: 4, foundText: 'The scouts found a drowned treasury. Something lives in the water, but it took one look at the dragon and left.' },
  // hunting grounds
  { id: 'bear-caves', kind: 'monsters', name: 'The bear caves', cap: 2, monsters: ['cave-bear'], killWork: 1_800, minStage: 1, foundText: 'The scouts found caves that smell of bear. Hunters can go after them now.' },
  { id: 'ember-pits', kind: 'monsters', name: 'The ember pits', cap: 2, monsters: ['salamander'], killWork: 1_800, minStage: 1, foundText: 'The scouts found pits of glowing embers with salamanders basking in them. Hunters can go after them now.' },
  { id: 'glow-pools', kind: 'monsters', name: 'The glow pools', cap: 2, monsters: ['glow-eel'], killWork: 1_500, minStage: 1, foundText: 'The scouts found pools lit from below by glow-eels. Hunters can go after them now.' },
  { id: 'deep-warrens', kind: 'monsters', name: 'The deep warrens', cap: 3, monsters: ['cave-bear', 'salamander', 'glow-eel'], killWork: 2_400, meatMult: 1.5, minStage: 2, foundText: 'The scouts found the deep warrens, where everything grows bigger.' },
  { id: 'basilisk-maze', kind: 'monsters', name: "The basilisk's maze", cap: 1, monsters: ['basilisk'], killWork: 6_000, minStage: 3, deep: true, foundText: "The scouts found a maze full of very lifelike statues. They came back walking backwards. It's a basilisk's." },
  { id: 'wyvern-cliffs', kind: 'monsters', name: 'The wyvern cliffs', cap: 1, monsters: ['wyvern'], killWork: 10_000, minStage: 4, foundText: 'The scouts found cliffs where wyverns nest. One of them chased the hunters all the way home.' },
  { id: 'elder-deeps', kind: 'monsters', name: 'The elder deeps', cap: 1, monsters: ['elder'], killWork: 20_000, minStage: 5, deep: true, foundText: 'The scouts found the elder deeps. Something old and nameless moved down there. The dragon wants it.' },
];

export const areaDef = (id: string) => AREAS.find((a) => a.id === id);

/** "woodland", "stone areas", "hunting grounds". */
export function kindWords(kind: AreaKind): string {
  return kind === 'wood' ? 'woodland' : kind === 'monsters' ? 'hunting grounds' : `${kind} areas`;
}

export const KINDS: { id: AreaKind; name: string; job: string; base?: ResourceId }[] = [
  { id: 'wood', name: 'Woodland', job: 'woodcutter', base: 'wood' },
  { id: 'stone', name: 'Stone', job: 'miner', base: 'stone' },
  { id: 'copper', name: 'Copper', job: 'scavenger', base: 'copper' },
  { id: 'monsters', name: 'Monsters', job: 'hunter' },
];

export const kindDef = (id: AreaKind) => KINDS.find((k) => k.id === id)!;
export const kindOfJob = (job: string) => KINDS.find((k) => k.job === job)?.id;

export const EXPLORE = {
  /** Exploring points for the first find of each kind; each one after costs `growth` times the last. */
  firstCost: { wood: 60, stone: 60, copper: 400, monsters: 300 } as Record<AreaKind, number>,
  growth: 2.5,
  /** Each area found of a kind is this many times bigger than its listed size for every one found before it. */
  sizeGrowth: 2,
  /** Exploring points a second from each kobold with no room to work, out looking for more. */
  perSearcher: 0.1,
  /** Chance a find is named after a named kobold who found it. */
  nameChance: 0.5,
};

/** The share of miners' ore that full stone yards still give, as ore only. */
export const FULL_YARD_ORE = 0.5;

// ---------- what's found ----------

export function found(state: GameState, kind?: AreaKind): AreaDef[] {
  return state.explore.found.map(areaDef).filter((a): a is AreaDef => !!a && (!kind || a.kind === kind));
}

export function kindKnown(state: GameState, kind: AreaKind): boolean {
  return state.explore.found.some((id) => areaDef(id)?.kind === kind) || (state.explore.bonus[kind] ?? 0) > 0;
}

/**
 * The most an area gives now: per second for gathering, kills an hour for
 * hunting grounds. Later finds of a kind are bigger: twice per find before it.
 */
export function areaCap(state: GameState, a: AreaDef): number {
  const i = found(state, a.kind).indexOf(a);
  return a.cap * EXPLORE.sizeGrowth ** Math.max(0, i);
}

/** The name the warren uses for an area: after whoever found it, if they were named. */
export function areaName(state: GameState, a: AreaDef): string {
  return state.explore.names[a.id] ?? a.name;
}

function deepRoom(state: GameState): boolean {
  return Object.values(state.rooms).some((r) => r.volume >= WORK_FINDS.deepPaces);
}

/** Can searchers turn this one up now? */
export function findable(state: GameState, a: AreaDef): boolean {
  if (state.explore.found.includes(a.id)) return false;
  if (state.stage < (a.minStage ?? 0)) return false;
  if (a.deep && !deepRoom(state)) return false;
  if (a.kind === 'monsters' && !opened(state, 'monster-tracking')) return false;
  return true;
}

/** Kinds whose job is open, so kobolds can look for more of them. */
export function exploreKinds(state: GameState): AreaKind[] {
  return KINDS.filter((k) => {
    const def = jobDef(k.job);
    return !!def && jobOpen(state, def);
  }).map((k) => k.id);
}

/** Exploring points for the next find of a kind. */
export function findCost(state: GameState, kind: AreaKind): number {
  const n = state.explore.found.filter((id) => areaDef(id)?.kind === kind && areaDef(id)!.foundText !== '').length;
  return EXPLORE.firstCost[kind] * EXPLORE.growth ** n;
}

/** Why kobolds looking for more of this kind will find nothing, or null. */
export function exploreBlocked(state: GameState, kind: AreaKind): string | null {
  if (AREAS.some((a) => a.kind === kind && findable(state, a))) return null;
  const left = AREAS.filter((a) => a.kind === kind && !state.explore.found.includes(a.id));
  const what = kindWords(kind);
  if (!left.length) return `Every one of the ${what} has been found.`;
  if (kind === 'monsters' && !opened(state, 'monster-tracking')) return 'The hunters need monster tracking to know what to look for.';
  if (left.some((a) => a.deep && !deepRoom(state) && state.stage >= (a.minStage ?? 0))) return `The next ${what} lie deeper. Dig a room past ${WORK_FINDS.deepPaces.toLocaleString('en-US')} paces.`;
  return `Nobody will go further for ${what} until the dragon is bigger.`;
}

// ---------- the mix ----------

/** Ore boost from research: seam reading and deep seams make every area's ore part bigger. */
export function oreBoost(state: GameState): number {
  let m = 1;
  for (const e of researchEffects(state)) if (e.kind === 'oreBoost') m = Math.max(m, e.mult);
  return m;
}

/**
 * What an area gives, by share, right now: research makes the ore part
 * bigger, anything the warren doesn't know yet comes out as the plain thing
 * instead, and a full stone yard sends an iron-bearing area's stone to ore
 * at half pace.
 */
export function areaMix(state: GameState, a: AreaDef): Partial<Record<ResourceId, number>> {
  const base = kindDef(a.kind).base;
  if (!a.mix || !base) return {};
  const mix: Partial<Record<ResourceId, number>> = { ...a.mix };
  if (mix.ore && resourceOpen(state, 'ore')) {
    const ore = Math.min(1, mix.ore * oreBoost(state));
    const extra = ore - mix.ore;
    const fromStone = Math.min(extra, mix.stone ?? 0);
    mix.ore = mix.ore + fromStone;
    if (mix.stone) mix.stone -= fromStone;
  }
  for (const [r, n] of Object.entries(mix) as [ResourceId, number][]) {
    if (r === base || resourceOpen(state, r)) continue;
    delete mix[r];
    mix[base] = (mix[base] ?? 0) + n;
  }
  if (a.kind === 'stone' && (mix.ore ?? 0) > 0 && (mix.stone ?? 0) > 0 && state.res.stone >= capacity(state, 'stone') - 1e-6) {
    mix.ore = (mix.ore ?? 0) + mix.stone! * FULL_YARD_ORE;
    delete mix.stone;
  }
  return mix;
}

/** Is the stone yard full, with miners digging only for ore? */
export function yardFull(state: GameState): boolean {
  return resourceOpen(state, 'ore') && state.res.stone >= capacity(state, 'stone') - 1e-6 && found(state, 'stone').some((a) => (a.mix?.ore ?? 0) > 0);
}

/** An area's most, in the job's work units a second (kills an hour become hunting work). */
function capWork(state: GameState, a: AreaDef): number {
  const cap = areaCap(state, a);
  return a.kind === 'monsters' ? (cap * (a.killWork ?? 1)) / 3600 : cap;
}

export interface Fill {
  area: AreaDef | null;
  /** Work going into it, per second. */
  used: number;
  /** Its most. */
  cap: number;
}

/**
 * How a job's work spreads over the areas found for it: the best first, each
 * up to its most. Old saves can have a little extra room ("the old workings")
 * so nothing they made before drops. Also returns the work with nowhere to go.
 */
export function fills(state: GameState, kind: AreaKind, work?: number): { fills: Fill[]; spare: number; raw: number } {
  const def = jobDef(kindDef(kind).job);
  const raw = work ?? (def ? jobOutput(state, def) : 0);
  let left = raw;
  const out: Fill[] = [];
  const list = found(state, kind).sort((x, y) => AREAS.indexOf(y) - AREAS.indexOf(x));
  for (const a of list) {
    const cap = capWork(state, a);
    const used = Math.min(left, cap);
    out.push({ area: a, used, cap });
    left -= used;
  }
  const bonus = state.explore.bonus[kind] ?? 0;
  if (bonus > 0) {
    const used = Math.min(left, bonus);
    out.push({ area: null, used, cap: bonus });
    left -= used;
  }
  return { fills: out, spare: Math.max(0, left), raw };
}

/** The most a kind's areas give in all, per second (or kills an hour for grounds). */
export function kindCap(state: GameState, kind: AreaKind): number {
  return found(state, kind).reduce((a, x) => a + areaCap(state, x), 0) + (kind === 'monsters' ? 0 : (state.explore.bonus[kind] ?? 0));
}

/** What a gathering job makes per second, by resource, after its areas' limits. */
export function gathered(state: GameState, kind: AreaKind): Partial<Record<ResourceId, number>> {
  const out: Partial<Record<ResourceId, number>> = {};
  const base = kindDef(kind).base;
  if (!base) return out;
  for (const f of fills(state, kind).fills) {
    if (f.used <= 0) continue;
    const mix = f.area ? areaMix(state, f.area) : { [base]: 1 };
    for (const [r, n] of Object.entries(mix) as [ResourceId, number][]) out[r] = (out[r] ?? 0) + f.used * n;
  }
  return out;
}

/** "The grove gives at most 6 wood a second. Explore for more woodland." when a job's areas are all full, else null. */
export function capHint(state: GameState, kind: AreaKind): string | null {
  const f = fills(state, kind);
  if (f.raw <= 0 || f.spare < f.raw * 0.02 + 1e-9) return null;
  const k = kindDef(kind);
  const what = kindWords(kind);
  const job = jobDef(k.job)!;
  const each = f.raw / Math.max(1, workers(state, k.job));
  const idle = Math.floor(f.spare / Math.max(1e-9, each));
  const blocked = exploreBlocked(state, kind);
  const more = idle > 0 ? (blocked ? ` About ${idle} of the ${job.name.toLowerCase()}s have nothing to do: ${blocked.charAt(0).toLowerCase()}${blocked.slice(1)}` : ` About ${idle} of the ${job.name.toLowerCase()}s are out looking for more ${what}.`) : '';
  if (kind === 'monsters') return `Every hunting ground is hunted as much as it can be (${formatCap(f.fills.reduce((a, x) => a + (x.area ? areaCap(state, x.area) : 0), 0))} kills an hour).${more}`;
  const one = f.fills.length === 1 && f.fills[0].area;
  const unit = k.base === 'food' ? 'food' : k.base === 'copper' ? 'copper' : k.base === 'wood' ? 'wood' : 'stone';
  if (one) return `${areaName(state, one)} gives at most ${formatCap(areaCap(state, one))} ${unit} a second.${more}`;
  return `Every one of the ${kindWords(kind)} found is giving all it can (${formatCap(kindCap(state, kind))} a second).${more}`;
}

const formatCap = (n: number) => Math.round(n).toLocaleString('en-US');

// ---------- exploring ----------

/** Kobolds of a kind's job with no room to work: they go looking for more. */
export function searchers(state: GameState, kind: AreaKind): number {
  const def = jobDef(kindDef(kind).job);
  if (!def || !jobOpen(state, def)) return 0;
  const f = fills(state, kind);
  if (f.raw <= 0 || f.spare <= 1e-9) return 0;
  return (workers(state, def.id) * f.spare) / f.raw;
}

/** Exploring points a second for a kind: from its searchers, while there's anything left to find. */
export function exploreRate(state: GameState, kind: AreaKind): number {
  if (exploreBlocked(state, kind)) return 0;
  return searchers(state, kind) * EXPLORE.perSearcher;
}

/** The area turned up next, or null. Ore sniffing makes sure the next stone find has iron in it. */
function draw(state: GameState, kind: AreaKind, rand: () => number): AreaDef | null {
  const first = AREAS.find((a) => a.kind === kind);
  if (first && findable(state, first)) return first; // the first of each kind is always the plain one
  let pool = AREAS.filter((a) => a.kind === kind && findable(state, a));
  if (kind === 'stone' && resourceOpen(state, 'ore') && !found(state, 'stone').some((a) => a.mix?.ore)) {
    const iron = pool.filter((a) => a.mix?.ore);
    if (iron.length) pool = iron;
  }
  if (!pool.length) return null;
  return pool[Math.floor(rand() * pool.length) % pool.length];
}

/** Mark an area found. Returns the chronicle line. */
export function addArea(state: GameState, id: string): string | null {
  const a = areaDef(id);
  if (!a || state.explore.found.includes(id)) return null;
  state.explore.found.push(id);
  return a.foundText;
}

/** Let `dt` seconds of looking around pass, for every kind with kobolds out of room. Returns chronicle lines. */
export function exploreStep(state: GameState, dt: number, t: number, rand: () => number): string[] {
  const lines: string[] = [];
  const ex = state.explore;
  for (const k of KINDS) {
    const kind = k.id;
    const rate = exploreRate(state, kind);
    if (rate <= 0) continue;
    ex.points[kind] = (ex.points[kind] ?? 0) + rate * dt;
    const cost = findCost(state, kind);
    if (ex.points[kind]! < cost) continue;
    const a = draw(state, kind, rand);
    if (!a) continue;
    ex.points[kind]! -= cost;
    const job = jobDef(k.job)!.name.toLowerCase();
    let line = addArea(state, a.id)!.replace(/^The scouts/, `The ${job}s`) || `The ${job}s found ${a.name.replace(/^The /, 'the ')}.`;
    // a named kobold on that job gets the credit
    const named = namedIn(state, k.job);
    if (named.length) {
      const who = named[Math.floor(rand() * named.length) % named.length];
      addHistory(who, t, `Was first into ${a.name.replace(/^The /, 'the ').replace(/^([A-Z])(?=[a-z])/, (c) => c.toLowerCase())}.`);
      if (rand() < EXPLORE.nameChance && a.id !== AREAS.find((x) => x.kind === a.kind)?.id) {
        ex.names[a.id] = `${who.name}'s ${a.name.replace(/^The /, '').replace(/^([A-Z])(?=[a-z])/, (c) => c.toLowerCase())}`;
        line += ` They're calling it ${ex.names[a.id]}, after ${fullName(who)}, who was first in.`;
      } else line += ` ${fullName(who)} was first in.`;
      // first in sometimes means coming back with something
      if (!piece(who, 'trinket') && rand() < 0.25)
        givePiece(who, 'trinket', { tier: 'stone', marks: 1, look: 'keepsake stone', origin: `brought back from ${a.name.replace(/^The /, 'the ')}` }, `Brought back a stone from ${a.name.replace(/^The /, 'the ')} as a keepsake, and has carried it since.`, t);
    }
    lines.push(line);
    // new woodland past the first sometimes has puffballs growing in it
    if (kind === 'wood' && state.explore.found.filter((id) => areaDef(id)?.kind === 'wood').length >= 2 && rand() < CROP_FINDS.puffballs) {
      const seed = discoverCrop(state, 'puffballs');
      if (seed) lines.push(`The ${job}s came back from ${a.name.replace(/^The /, 'the ')} with a sack of puffballs. ${seed}`);
    }
  }
  return lines;
}

// ---------- extras ----------

/** Now and then, while an area is worked: amber, mana, mithril, adamant, a weapon for the shelf. */
export function areaExtrasStep(state: GameState, dt: number, t: number, rand: () => number): string[] {
  const lines: string[] = [];
  for (const k of KINDS) {
    if (k.id === 'monsters') continue;
    for (const f of fills(state, k.id).fills) {
      const x = f.area?.extras;
      if (!x || f.used <= 0) continue;
      const units = f.used * dt;
      if (x.mana && state.magic) state.magic.mana = Math.min(200, state.magic.mana + units * x.mana);
      if (x.amber && rand() < units * x.amber) {
        state.gems.amber = (state.gems.amber ?? 0) + 1;
        lines.push(`The woodcutters in ${areaName(state, f.area!)} brought back a lump of amber with a beetle in it.`);
      }
      if (x.mithril && rand() < units * x.mithril) {
        if (!state.discovered.includes('mithril')) state.discovered.push('mithril');
        if (store(state, 'mithril', 1) > 0) lines.push(`The miners in ${areaName(state, f.area!)} cut out a lump of mithril.`);
      }
      if (x.adamant && rand() < units * x.adamant) {
        if (!state.discovered.includes('adamant')) state.discovered.push('adamant');
        if (store(state, 'adamant', 1) > 0) lines.push(`The miners on ${areaName(state, f.area!).replace(/^The /, 'the ')} pried loose a sliver of adamant.`);
      }
      if (x.weapon && rand() < units * x.weapon) {
        const rec = state.oddities['battlefield-weapons'];
        if (rec) rec.count++;
        else state.oddities['battlefield-weapons'] = { count: 1, firstAt: t };
        lines.push('The scavengers on the old battlefield found a sword still sharp enough to shave with. It went on the shelf.');
      }
    }
  }
  return lines;
}

/** Find luck for the miners: the gem pocket triples it while anyone works it. */
export function areaLuck(state: GameState, job: string): number {
  const kind = kindOfJob(job);
  if (!kind) return 1;
  let l = 1;
  for (const f of fills(state, kind).fills) if (f.used > 0 && f.area?.luck) l = Math.max(l, f.area.luck);
  return l;
}

// ---------- old saves ----------

/**
 * Old saves had no areas. Give them the plain area of every kind they had,
 * an iron seam if they could sniff out ore, the hunting grounds they could
 * already reach, and then enough more (and, if that isn't enough, some extra
 * room in "the old workings") that nothing they made before drops.
 */
export function legacyAreas(state: GameState) {
  for (const id of ['near-tunnels', 'grove', 'rubble-cave']) addArea(state, id);
  if (opened(state, 'ore-sniffing')) addArea(state, 'iron-seam');
  if (opened(state, 'monster-tracking') && state.stage >= 1) {
    for (const id of ['bear-caves', 'ember-pits', 'glow-pools']) addArea(state, id);
    if (state.stage >= 3 && deepRoom(state)) addArea(state, 'basilisk-maze');
    if (state.stage >= 4) addArea(state, 'wyvern-cliffs');
  }
  for (const k of KINDS) {
    if (k.id === 'monsters') continue;
    const need = () => fills(state, k.id).spare;
    for (const a of AREAS) {
      if (a.kind !== k.id || need() <= 1e-9) continue;
      if (findable(state, a)) addArea(state, a.id);
    }
    const short = need();
    if (short > 1e-9) state.explore.bonus[k.id] = Math.ceil(short * 1.1);
  }
}

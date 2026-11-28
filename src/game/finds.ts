// Rare finds while working: diggers and miners (and now and then a
// scavenger) turn up something extra. Most finds are small; a few are gems,
// rare metals or things for the shelf. Luck (talents, the Lucky trait, a
// lieutenant on the crew) makes the better ones likelier. Pure functions over
// GameState; they return chronicle lines.

import { GEMS, type GemDef, type ResourceId } from './data';
import { jobOpen, jobDef, resourceOpen, store, workers } from './economy';
import { areaLuck } from './areas';
import { addTool, bestTier, TIERS, TOOL_NAMES } from './forge';
import { addHistory, fullName, namedIn, type NamedKobold } from './kobolds';
import { researchEffect } from './research';
import type { GameState } from './state';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'very rare';

export const WORK_FINDS = {
  /** Each kobold on a finding job turns something up about once in this many hours of work. */
  hours: 30,
  /** Scavengers only pick through loose rubble: this much as often, and nothing deep. */
  scavengerShare: 0.3,
  /** Chance of each rarity, before luck. Very rare needs a deep room. */
  odds: { uncommon: 0.22, rare: 0.07, 'very rare': 0.01 } as Record<Exclude<Rarity, 'common'>, number>,
  /** A room this big counts as deep, for very rare finds. */
  deepPaces: 1_500,
  /** Luck for a kobold with a fitting talent or the Lucky trait: uncommon and better are this much likelier. */
  luck: 2,
  /** A lieutenant on the crew shares a little luck with everyone on it. */
  lieutenantLuck: 1.25,
};

/** The jobs that turn things up. */
export const FINDING_JOBS = ['digger', 'miner', 'scavenger'];

/** Talents that make a kobold luckier at their job's finds. */
export const LUCKY_TALENTS: Record<string, string[]> = {
  miner: ['Seam-finder', 'Dark-eyed', 'Dark-sighted', 'Stone-reader'],
  digger: ['Tunnel-sense'],
  scavenger: ['Magpie eyes', 'Coin-sniffer'],
};

function pick<T>(xs: T[], rand: () => number): T {
  return xs[Math.floor(rand() * xs.length) % xs.length];
}

/** How lucky this kobold is at this job (1 = ordinary). */
export function luckOf(k: NamedKobold, job: string): number {
  let l = 1;
  if (k.traits.includes('Lucky')) l *= WORK_FINDS.luck;
  const names = LUCKY_TALENTS[job] ?? [];
  if ((k.talents ?? []).some((t) => t.job === job && names.some((n) => t.name.startsWith(n)))) l *= WORK_FINDS.luck;
  return l;
}

function deep(state: GameState): boolean {
  return Object.values(state.rooms).some((r) => r.volume >= WORK_FINDS.deepPaces);
}

/** Roll a rarity. Luck makes everything above common likelier. */
export function rollRarity(state: GameState, luck: number, rand: () => number, job: string): Rarity {
  const x = rand();
  let acc = 0;
  const top: Rarity[] = job === 'scavenger' ? ['uncommon'] : deep(state) ? ['very rare', 'rare', 'uncommon'] : ['rare', 'uncommon'];
  for (const r of top) {
    acc += WORK_FINDS.odds[r as Exclude<Rarity, 'common'>] * luck;
    if (x < acc) return r;
  }
  return 'common';
}

interface Found {
  /** The line, with {kobold} for whoever found it. */
  text: string;
}

function gem(state: GameState, rarity: Rarity, rand: () => number, t: number): Found {
  const g: GemDef = pick(
    GEMS.filter((x) => x.rarity === rarity),
    rand,
  );
  const first = !state.gems[g.id];
  state.gems[g.id] = (state.gems[g.id] ?? 0) + 1;
  if (first) {
    const rec = state.oddities['first-gems'];
    if (rec) rec.count++;
    else state.oddities['first-gems'] = { count: 1, firstAt: t };
  }
  const a = /^[AEIOU]/.test(g.name) ? 'an' : 'a';
  return { text: `{kobold} found ${a} ${g.name.toLowerCase()} and put it on the hoard${first ? '. The first one ever: the dragon sniffed it for a long time' : ''}. (+${g.value.toLocaleString('en-US')} worth)` };
}

function metal(state: GameState, res: ResourceId, n: number, line: string): Found | null {
  if (!state.discovered.includes(res) && (res === 'mithril' || res === 'adamant')) state.discovered.push(res);
  if (!resourceOpen(state, res)) return null;
  const kept = store(state, res, n);
  if (kept < 1) return null;
  return { text: `${line} (+${Math.floor(kept).toLocaleString('en-US')} ${res === 'ore' ? 'iron ore' : res})` };
}

/** What turns up, for a job and a rarity. Returns null if nothing fitting can happen now. */
function findFor(state: GameState, job: string, rarity: Rarity, rand: () => number, t: number): Found | null {
  if (rarity === 'common') {
    if (rand() < 0.35) return gem(state, 'common', rand, t);
    if (job === 'scavenger') return metal(state, 'copper', Math.round(50 + rand() * 150) * Math.max(1, state.stage), '{kobold} found a handful of copper in the rubble.');
    if (rand() < 0.5 && resourceOpen(state, 'ore')) return metal(state, 'ore', Math.round(20 + rand() * 40), '{kobold} pried out a fat lump of iron ore.');
    return metal(state, 'stone', Math.round(30 + rand() * 50), '{kobold} split off a perfect block of stone.');
  }
  if (rarity === 'uncommon') {
    const x = rand();
    if (x < 0.4) return gem(state, 'uncommon', rand, t);
    if (x < 0.75 && state.stage >= 1) return metal(state, 'silver', Math.round(5 + rand() * 15), '{kobold} found a silver nugget and carried it to the hoard.');
    const rec = state.oddities.fossil;
    if (rec) rec.count++;
    else state.oddities.fossil = { count: 1, firstAt: t };
    return { text: '{kobold} found a fossil: a stone shell from something that lived down here before anyone. It went on the shelf.' };
  }
  if (rarity === 'rare') {
    const x = rand();
    if (x < 0.35) return gem(state, 'rare', rand, t);
    if (x < 0.6 && job !== 'scavenger' && researchEffect(state, 'mithrilFinds')) return metal(state, 'mithril', 1 + Math.floor(rand() * 3), '{kobold} found a vein of something pale that rings like a bell: mithril.');
    if (x < 0.8 && state.stage >= 2) return metal(state, 'gold', Math.round(2 + rand() * 6), '{kobold} found a gold nugget. The whole crew went to look.');
    // a dwarf-made tool, the best kind the forge knows, or steel
    if (!TOOL_NAMES[job]) return null;
    const tier = bestTier(state)?.id ?? 'steel';
    const best = TIERS.findIndex((x) => x.id === tier) >= TIERS.findIndex((x) => x.id === 'steel') ? tier : 'steel';
    addTool(state, best);
    const rec = state.oddities['dwarf-tools'];
    if (rec) rec.count++;
    else state.oddities['dwarf-tools'] = { count: 1, firstAt: t };
    return { text: `{kobold} found a set of dwarf-made ${TOOL_NAMES[job]} in a sealed niche, still sharp. They went on the rack: one more ${best} tool.` };
  }
  // very rare
  if (rand() < 0.5) return gem(state, 'very rare', rand, t);
  return metal(state, 'adamant', 1, '{kobold} found a sliver of adamant, so hard it scratched the pick that found it.');
}

/** Let `dt` seconds of work happen: now and then someone turns something up. Returns chronicle lines (uncommon or better). */
export function findStep(state: GameState, dt: number, t: number, rand: () => number): string[] {
  if (!state.chief) return [];
  const lines: string[] = [];
  for (const job of FINDING_JOBS) {
    const def = jobDef(job);
    if (!def || !jobOpen(state, def)) continue;
    const n = workers(state, job);
    if (n < 1) continue;
    const rate = (n * dt) / (WORK_FINDS.hours * 3600) * (job === 'scavenger' ? WORK_FINDS.scavengerShare : 1);
    if (rand() >= rate) continue;
    // who found it: a named kobold on the job (with their own luck), or someone from the crew
    const named = namedIn(state, job);
    const k = named.length && rand() < named.length / n ? pick(named, rand) : null;
    let luck = (k ? luckOf(k, job) : 1) * (researchEffect(state, 'findLuck')?.mult ?? 1) * areaLuck(state, job);
    if (named.some((x) => x.lieutenant)) luck *= WORK_FINDS.lieutenantLuck;
    let rarity = rollRarity(state, luck, rand, job);
    // a shaman's lucky charm: the next few finds are at least uncommon
    if (state.magic.charms > 0 && job !== 'scavenger') {
      if (rarity === 'common') rarity = 'uncommon';
      state.magic.charms--;
    }
    const found = findFor(state, job, rarity, rand, t);
    if (!found || rarity === 'common') continue;
    // the crew's finds go in the story of a named kobold on the job, if there is one
    const credit = k ?? (named.length ? pick(named, rand) : null);
    const who = credit ? fullName(credit) : `One of the ${def.name.toLowerCase()}s`;
    if (credit) addHistory(credit, t, found.text.replaceAll('{kobold}', credit.name));
    lines.push(found.text.replaceAll('{kobold}', who));
  }
  return lines;
}

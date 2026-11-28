// Personal gear for named kobolds: a tool, armor and a trinket. Pieces are
// never handed out: each one turns up as an experience in the kobold's story
// (found on the job, earned in a scrape, given by the dragon), and then the
// forge can upgrade it through the tiers, three marks at a time. Gear goes
// with its owner from job to job. Pure functions over GameState.

import { JOBS } from './data';
import { bestTier, TIERS, type ToolTier } from './forge';
import { addHistory, fullName, type NamedKobold } from './kobolds';
import type { GameState } from './state';

export type Slot = 'tool' | 'armor' | 'trinket';
export const SLOTS: Slot[] = ['tool', 'armor', 'trinket'];

export interface GearPiece {
  tier: ToolTier;
  /** 0 to 3 within its tier. */
  marks: number;
  /** What it is, if not the usual look for the slot: "hat", "lantern". */
  look?: string;
  /** A masterwork's name, or one given in the story that earned it. */
  name?: string;
  /** Where it came from, for the card: "found in the rubble cave". */
  origin: string;
}

export const GEAR = {
  maxMarks: 3,
  /** Work bonus per mark on a personal tool, on top of its tier. */
  markBonus: 0.05,
  /** Armor: chance a bad hurt is turned aside, by tier, and more per mark. Rests are shorter by as much. */
  armorProtect: { stone: 0.2, iron: 0.3, steel: 0.4, mithril: 0.5, adamant: 0.6 } as Record<ToolTier, number>,
  armorPerMark: 0.05,
  /** Trinket: find luck per tier step (stone is 1) and per mark; a lieutenant's crew lift per tier step. */
  trinketLuck: 0.1,
  trinketLuckPerMark: 0.05,
  trinketLift: 0.01,
  /** A piece turns up on the job about this often for each empty slot, so the first comes in a day or so and all three in about a week. */
  findSeconds: 2.5 * 86_400,
  /** Named kobolds with this many experiences and no gear find their first piece twice as fast (old favourites catch up). */
  veteranExperiences: 4,
  /** Chance a lucky hat takes a blow meant for a kobold with no trinket. */
  luckyHat: 0.3,
  /** Chance a named miner or digger breaks into a monster's den, per working hour (once the dragon has hatched). */
  denPerHour: 1 / 400,
  /** Commission costs: a new tier is this many tools' worth; marks cost 2, 3 and 4. */
  tierCost: 4,
};

/** What a tool looks like for each job. */
export const TOOL_LOOK: Record<string, string> = {
  scavenger: 'sack',
  woodcutter: 'axe',
  digger: 'shovel',
  miner: 'pick',
  researcher: 'goggles',
  herder: 'crook',
  hunter: 'spear',
  farmer: 'hoe',
  shaman: 'rattle',
  alchemist: 'tongs',
  blacksmith: 'hammer',
};

const SLOT_LOOK: Record<Exclude<Slot, 'tool'>, string> = { armor: 'armor', trinket: 'charm' };

const tierIndex = (t: ToolTier) => TIERS.findIndex((x) => x.id === t);
const tierName = (t: ToolTier) => TIERS[tierIndex(t)].name.toLowerCase();

export function piece(k: NamedKobold, slot: Slot): GearPiece | undefined {
  return k.gear?.[slot];
}

/** "steel pick", "iron armor", "stone hat": what a piece is now. A tool's look follows its owner's job. */
export function pieceLook(k: NamedKobold, slot: Slot, p: GearPiece): string {
  const look = p.look ?? (slot === 'tool' ? (TOOL_LOOK[k.job] ?? 'tool') : SLOT_LOOK[slot]);
  return `${tierName(p.tier)} ${look}`;
}

/** "Old Biter, steel pick ✦✦" or "iron armor". */
export function pieceText(k: NamedKobold, slot: Slot, p: GearPiece): string {
  const marks = p.marks > 0 ? ` ${'✦'.repeat(p.marks)}` : '';
  return `${p.name ? `${p.name}, ` : ''}${pieceLook(k, slot, p)}${marks}`;
}

/** The one gear line on a named card. */
export function gearLine(k: NamedKobold): string {
  return SLOTS.map((s) => {
    const p = piece(k, s);
    return p ? pieceText(k, s, p) : `no ${s}`;
  }).join(' · ');
}

// ---------- what gear does ----------

/** A personal tool's work multiplier, or null without one. */
export function toolMult(k: NamedKobold): number | null {
  const p = piece(k, 'tool');
  if (!p) return null;
  return TIERS[tierIndex(p.tier)].mult * (1 + GEAR.markBonus * p.marks);
}

/** Armor: the chance a bad hurt is turned aside, and how much shorter a rest is. */
export function armorProtect(k: NamedKobold): number {
  const p = piece(k, 'armor');
  if (!p) return 0;
  return Math.min(0.8, GEAR.armorProtect[p.tier] + GEAR.armorPerMark * p.marks);
}

/** Trinket: how much luckier their finds are. */
export function trinketLuck(k: NamedKobold): number {
  const p = piece(k, 'trinket');
  if (!p) return 1;
  return 1 + GEAR.trinketLuck * (tierIndex(p.tier) + 1) + GEAR.trinketLuckPerMark * p.marks;
}

/** Trinket: extra crew lift for a lieutenant. */
export function trinketLift(k: NamedKobold): number {
  const p = piece(k, 'trinket');
  return p && k.lieutenant ? GEAR.trinketLift * (tierIndex(p.tier) + 1) : 0;
}

// ---------- getting pieces ----------

const MASTER_FIRST = ['Old', 'Long', 'Grim', 'Bright', 'Quiet', 'Red', 'Lucky', 'Deep', 'Stubborn', 'Little'];
const MASTER_LAST: Record<Slot, string[]> = {
  tool: ['Biter', 'Song', 'Tooth', 'Reach', 'Spark', 'Mutter', 'Knock'],
  armor: ['Shell', 'Hide', 'Wall', 'Back', 'Coat', 'Scale'],
  trinket: ['Light', 'Charm', 'Wink', 'Eye', 'Luck', 'Glint'],
};

function pick<T>(xs: T[], rand: () => number): T {
  return xs[Math.floor(rand() * xs.length) % xs.length];
}

export function masterName(slot: Slot, rand: () => number): string {
  return `${pick(MASTER_FIRST, rand)} ${pick(MASTER_LAST[slot], rand)}`;
}

/** Give a kobold a piece for an empty slot, with the story that goes with it. Returns false if the slot is taken. */
export function givePiece(k: NamedKobold, slot: Slot, p: GearPiece, story: string, t: number): boolean {
  k.gear ??= {};
  if (k.gear[slot]) return false;
  k.gear[slot] = p;
  addHistory(k, t, story);
  return true;
}

export function emptySlots(k: NamedKobold): Slot[] {
  return SLOTS.filter((s) => !piece(k, s));
}

/** What turns up on the job, by slot: the story, and a look if it isn't the usual. */
const FOUND: Record<Slot, { text: string; look?: string }[]> = {
  tool: [
    { text: 'found an old {look} wedged in the rock, better made than anything in the warren, and kept it' },
    { text: 'traded a week of mushroom rations for a {look} that fits their hand just right' },
    { text: 'dug a forgotten {look} out of a collapsed side tunnel and claimed it' },
  ],
  armor: [
    { text: 'found a dented helmet in an old tunnel and has worn it ever since', look: 'helmet' },
    { text: 'stitched themselves a jerkin out of beetle shell', look: 'jerkin' },
    { text: 'found a coat of rusty rings on a skeleton and decided the skeleton would not mind', look: 'mail coat' },
  ],
  trinket: [
    { text: 'found a smooth stone with a hole in it and wears it on a string for luck', look: 'lucky stone' },
    { text: 'keeps a tooth from something they would rather not talk about', look: 'tooth charm' },
    { text: 'found a ring in the rubble, far too big, and wears it as a bracelet', look: 'ring' },
  ],
};

/** The tier a found piece starts at: mostly stone, sometimes better, never past what the forge knows (or iron). */
function foundTier(state: GameState, rand: () => number): ToolTier {
  const best = Math.max(1, tierIndex(bestTier(state)?.id ?? 'stone'));
  const x = rand();
  const i = x < 0.6 ? 0 : x < 0.9 ? Math.min(1, best) : Math.min(2, best);
  return TIERS[i].id;
}

/** Let `dt` seconds pass: working named kobolds now and then come by a piece, or earn one. Returns chronicle lines. */
export function gearStep(state: GameState, dt: number, t: number, rand: () => number): string[] {
  const lines: string[] = [];
  for (const k of state.named) {
    if (!JOBS.some((j) => j.id === k.job) || (k.restLeft ?? 0) > 0) continue;
    const empty = emptySlots(k);
    // a pick that drives off a monster
    if ((k.job === 'miner' || k.job === 'digger') && !piece(k, 'tool') && state.stage >= 1 && rand() < (dt / 3600) * GEAR.denPerHour) {
      const look = TOOL_LOOK[k.job];
      const name = k.job === 'miner' ? 'Bear-Breaker' : 'Den-Digger';
      givePiece(k, 'tool', { tier: foundTier(state, rand), marks: 1, name, origin: 'drove off a cave bear with it' }, `Broke into a cave bear's den and drove it off with nothing but their ${look}. The ${look} is called ${name} now.`, t);
      lines.push(`${fullName(k)} broke into a cave bear's den and drove it off with their ${look}. They've named it ${name}.`);
      continue;
    }
    if (!empty.length) continue;
    const veteran = !k.gear || !Object.keys(k.gear).length ? (k.history.length >= GEAR.veteranExperiences ? 2 : 1) : 1;
    if (rand() >= (empty.length * dt * veteran) / GEAR.findSeconds) continue;
    const slot = pick(empty, rand);
    const f = pick(FOUND[slot], rand);
    const look = f.look ?? (slot === 'tool' ? (TOOL_LOOK[k.job] ?? 'tool') : SLOT_LOOK[slot as Exclude<Slot, 'tool'>]);
    const p: GearPiece = { tier: foundTier(state, rand), marks: rand() < 0.2 ? 1 : 0, origin: `found while ${jobVerb(k.job)}`, ...(f.look ? { look: f.look } : {}) };
    const story = f.text.replace('{look}', look);
    givePiece(k, slot, p, `${story[0].toUpperCase()}${story.slice(1)}.`, t);
    lines.push(`${fullName(k)} ${story}.`);
  }
  return lines;
}

function jobVerb(job: string): string {
  const v: Record<string, string> = {
    scavenger: 'scavenging',
    woodcutter: 'cutting wood',
    digger: 'digging',
    miner: 'mining',
    researcher: 'in the lab',
    herder: 'herding',
    hunter: 'hunting',
    farmer: 'farming',
    shaman: 'reading bones',
    alchemist: 'at the alchemy bench',
    blacksmith: 'at the forge',
  };
  return v[job] ?? 'working';
}

/** A lucky hat: a kobold with no trinket who'd have been hurt sometimes isn't, and keeps the hat. */
export function luckyHat(k: NamedKobold, t: number, rand: () => number): string | null {
  if (piece(k, 'trinket') || rand() >= GEAR.luckyHat) return null;
  givePiece(k, 'trinket', { tier: 'stone', marks: 1, look: 'hat', name: 'The Dented Hat', origin: 'took a blow meant for them' }, 'Should have been badly hurt, but their hat took the blow. They will never take it off now.', t);
  return `${fullName(k)} should have been badly hurt, but their hat took the blow. It has a dent in it now, and a name: the Dented Hat.`;
}

// ---------- the forge: commissions ----------

export interface Commission {
  kobold: number;
  slot: Slot;
}

/** What the next upgrade of a piece is: another mark, or the next tier up (marks start again). Null if it can't go further. */
export function nextUpgrade(state: GameState, p: GearPiece): { tier: ToolTier; marks: number; work: number; cost: Partial<Record<string, number>>; label: string } | null {
  const i = tierIndex(p.tier);
  if (p.marks < GEAR.maxMarks) {
    const def = TIERS[i];
    const times = p.marks + 2;
    return { tier: p.tier, marks: p.marks + 1, work: def.work * times, cost: scale(def.cost, times), label: `mark ${p.marks + 1}` };
  }
  const best = tierIndex(bestTier(state)?.id ?? 'stone');
  if (i + 1 > best || i + 1 >= TIERS.length) return null;
  const def = TIERS[i + 1];
  return { tier: def.id, marks: 0, work: def.work * GEAR.tierCost, cost: scale(def.cost, GEAR.tierCost), label: `to ${def.name.toLowerCase()}` };
}

function scale(cost: Partial<Record<string, number>>, n: number): Partial<Record<string, number>> {
  return Object.fromEntries(Object.entries(cost).map(([r, x]) => [r, (x ?? 0) * n]));
}

/** Why a piece can't be commissioned, or null. */
export function commissionBlocked(state: GameState, k: NamedKobold, slot: Slot): string | null {
  const p = piece(k, slot);
  if (!p) return `No ${slot} yet. It has to turn up first.`;
  if (state.forge.commissions.some((c) => c.kobold === k.id && c.slot === slot)) return 'Already waiting at the forge.';
  if (!nextUpgrade(state, p)) return 'As good as the forge can make it.';
  return null;
}

export function commission(state: GameState, k: NamedKobold, slot: Slot): boolean {
  if (commissionBlocked(state, k, slot)) return false;
  state.forge.commissions.push({ kobold: k.id, slot });
  return true;
}

export function cancelCommission(state: GameState, index: number): boolean {
  if (!state.forge.commissions[index]) return false;
  state.forge.commissions.splice(index, 1);
  if (index === 0) for (const s of state.forge.slots) if (s.order === 'commissions') s.progress = 0;
  return true;
}

/** Drop commissions for kobolds who've left or pieces that can't go further. */
export function tidyCommissions(state: GameState) {
  state.forge.commissions = state.forge.commissions.filter((c) => {
    const k = state.named.find((x) => x.id === c.kobold);
    const p = k && piece(k, c.slot);
    return !!p && !!nextUpgrade(state, p);
  });
}

/** Finish the first commission: the piece gets its mark or tier. Returns the chronicle line. */
export function finishCommission(state: GameState, t: number, rand: () => number): string | null {
  const c = state.forge.commissions.shift();
  if (!c) return null;
  const k = state.named.find((x) => x.id === c.kobold);
  const p = k && piece(k, c.slot);
  const up = p && nextUpgrade(state, p);
  if (!k || !p || !up) return null;
  p.tier = up.tier;
  p.marks = up.marks;
  let line = `The forge finished ${k.name}'s ${pieceLook(k, c.slot, p)}${up.marks ? ` (${up.label})` : ''}.`;
  if (p.marks === GEAR.maxMarks && tierIndex(p.tier) >= tierIndex('steel') && !p.name) {
    p.name = masterName(c.slot, rand);
    addHistory(k, t, `Was given back their ${pieceLook(k, c.slot, p)} from the forge, finished so well it got a name: ${p.name}.`);
    line = `The blacksmiths finished ${fullName(k)}'s ${pieceLook(k, c.slot, p)} so well it got a name: ${p.name}.`;
  }
  return line;
}

/** When a named kobold puts down their tools for good, their named pieces go on the shelf. */
export function hangUpGear(state: GameState, k: NamedKobold, t: number) {
  const named = SLOTS.filter((s) => piece(k, s)?.name).length;
  if (!named) return;
  const rec = state.oddities.heirlooms;
  if (rec) rec.count += named;
  else state.oddities.heirlooms = { count: named, firstAt: t };
  for (const s of SLOTS) if (piece(k, s)?.name) delete k.gear![s];
}

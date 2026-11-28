// Founder traits: how good a named kobold would be at starting a colony.
// Three small traits from −2 to +2 (Pull, Green thumb, Head for trade), set
// when they're named and nudged up by their story, and now and then a knack
// the colony keeps. They're hidden until the kobold has a couple of
// experiences (or is a lieutenant), and shown as words, not numbers.

import { piece } from './gear';
import type { NamedKobold } from './kobolds';

export type FounderTrait = 'pull' | 'green' | 'trade';
export type Knack = 'mining' | 'shrine' | 'stubborn' | 'market';

export interface Founder {
  pull: number;
  green: number;
  trade: number;
  knack?: Knack;
}

export const FOUNDER = {
  /** Settlers per point of Pull, growth per point of Green thumb, tribute per point of Head for trade. */
  settlersPerPull: 1,
  growthPerGreen: 0.2,
  tributePerTrade: 0.15,
  /** Experiences before the traits show (lieutenants show at once). */
  revealExperiences: 2,
  /** About one founder in five has a knack. */
  knackChance: 0.2,
};

export const TRAIT_NAMES: Record<FounderTrait, string> = { pull: 'Pull', green: 'Green thumb', trade: 'Head for trade' };

export const KNACKS: Record<Knack, { name: string; text: string }> = {
  mining: { name: 'Mining colony', text: 'some tribute comes as stone and iron ore' },
  shrine: { name: 'Shrine colony', text: 'sends a little mana for the shamans' },
  stubborn: { name: 'Stubborn', text: 'grows slowly, but never stops at 200' },
  market: { name: 'Market town', text: 'tribute is a third bigger' },
};

/** A small, steady hash of the kobold, so traits are fixed from the start and old saves get them too. */
function roll(k: NamedKobold, salt: number): number {
  let h = (k.id * 2654435761 + salt * 40503) >>> 0;
  for (const c of k.name) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4_294_967_296;
}

/** −2..2, mostly around 0. */
function base(k: NamedKobold, salt: number): number {
  const x = roll(k, salt);
  return x < 0.08 ? -2 : x < 0.3 ? -1 : x < 0.7 ? 0 : x < 0.92 ? 1 : 2;
}

/** The traits as they stand: what they were born with, nudged by their story. */
export function founder(k: NamedKobold): Founder {
  const clamp = (n: number) => Math.max(-2, Math.min(2, n));
  let pull = base(k, 1);
  let green = base(k, 2);
  let trade = base(k, 3);
  if (k.lieutenant) pull += 1;
  if (piece(k, 'trinket') && ['steel', 'mithril', 'adamant'].includes(piece(k, 'trinket')!.tier)) pull += 1;
  if ((k.talents ?? []).some((t) => t.job === 'herder' || t.job === 'digger')) green += 1;
  if (k.gifts.length) trade += 1;
  const x = roll(k, 4);
  const knacks = Object.keys(KNACKS) as Knack[];
  const knack = x < FOUNDER.knackChance ? knacks[Math.floor((x / FOUNDER.knackChance) * knacks.length) % knacks.length] : undefined;
  return { pull: clamp(pull), green: clamp(green), trade: clamp(trade), ...(knack ? { knack } : {}) };
}

export function founderRevealed(k: NamedKobold): boolean {
  return k.lieutenant || k.history.length >= FOUNDER.revealExperiences;
}

export function traitWord(n: number): string {
  return n <= -2 ? 'very poor' : n === -1 ? 'poor' : n === 0 ? 'ordinary' : n === 1 ? 'strong' : 'remarkable';
}

/** "Pull: strong · Green thumb: ordinary · Head for trade: poor · Knack: mining colony", or the hidden version. */
export function founderLine(k: NamedKobold): string {
  if (!founderRevealed(k)) return `Founder: ? · shows after ${FOUNDER.revealExperiences} experiences`;
  const f = founder(k);
  const parts = (Object.keys(TRAIT_NAMES) as FounderTrait[]).map((t) => `${TRAIT_NAMES[t]}: ${traitWord(f[t])}`);
  if (f.knack) parts.push(`Knack: ${KNACKS[f.knack].name.toLowerCase()}`);
  return `Founder: ${parts.join(' · ')}`;
}

/** What their colony would start with, for the button: "7 settlers, grows a little fast". */
export function founderPreview(k: NamedKobold, settlers: number): string {
  const f = founder(k);
  const n = Math.max(2, settlers + f.pull * FOUNDER.settlersPerPull);
  if (!founderRevealed(k)) return `${n} settlers go with them.`;
  const speed = f.green > 0 ? (f.green > 1 ? 'grows fast' : 'grows a little fast') : f.green < 0 ? (f.green < -1 ? 'grows slowly' : 'grows a little slowly') : 'grows at an ordinary pace';
  const trade = f.trade > 0 ? ', good at trade' : f.trade < 0 ? ', poor at trade' : '';
  return `${n} settlers, ${speed}${trade}${f.knack ? `. ${KNACKS[f.knack].name}: ${KNACKS[f.knack].text}` : ''}.`;
}

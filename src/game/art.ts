// Artisans and the art in the hoard room. An experienced named kobold can
// give up their job to make art. Every so often they finish a signed piece,
// using some materials; it goes on display in the hoard room and draws
// kobolds. The hoard room's size limits how many pieces fit on show.

import { hangUpGear } from './gear';
import type { ResourceId } from './data';
import { resourceOpen, roomVolume } from './economy';
import { addHistory, fullName, LIEUTENANT_EXPERIENCES, type NamedKobold } from './kobolds';
import { opened } from './research';
import type { GameState } from './state';

/** The job id a named kobold has while they're an artisan. */
export const ARTISAN = 'artisan';

export const ART = {
  /** Hours of work for one piece. */
  hours: 10,
  /** Experiences needed to become an artisan. */
  experiences: LIEUTENANT_EXPERIENCES,
  /** Cubic paces of hoard room per piece on display (at least `minShown`). */
  pacesPerPiece: 100,
  minShown: 2,
};

export interface MaterialDef {
  id: string;
  /** What it's called: "a stone carving". */
  noun: string;
  cost: Partial<Record<ResourceId, number>>;
  appeal: number;
  /** A job whose lovers make this best. */
  job: string;
}

export const ART_MATERIALS: MaterialDef[] = [
  { id: 'statue', noun: 'an iron statue', cost: { bars: 50 }, appeal: 10, job: 'blacksmith' },
  { id: 'carving', noun: 'a stone carving', cost: { stone: 200 }, appeal: 6, job: 'miner' },
  { id: 'totem', noun: 'a mushroom-wood totem', cost: { wood: 300 }, appeal: 5, job: 'woodcutter' },
];

const SUBJECTS = ['the dragon', 'the Chief', 'the egg, before it hatched', 'a very large crab', 'the Kogoat', 'the hoard itself', 'themselves'];
const MOODS = ['slightly lopsided', 'surprisingly good', 'very serious', 'rather smug', 'enormous', 'tiny but proud'];

export interface ArtPiece {
  id: number;
  title: string;
  /** Who made it, or '' for an unsigned piece. */
  by: string;
  material: string;
  appeal: number;
  t: number;
}

export function artOpen(state: GameState): boolean {
  return opened(state, 'artistry');
}

export function artisans(state: GameState): NamedKobold[] {
  return state.named.filter((k) => k.job === ARTISAN);
}

export function canBecomeArtisan(state: GameState, k: NamedKobold): boolean {
  return artOpen(state) && k.job !== ARTISAN && k.history.length >= ART.experiences;
}

/** Make a named kobold an artisan. They leave their job (and stop being a lieutenant). */
export function makeArtisan(state: GameState, id: number, t: number): boolean {
  const k = state.named.find((x) => x.id === id);
  if (!k || !canBecomeArtisan(state, k)) return false;
  k.job = ARTISAN;
  k.lieutenant = false;
  k.artWork = 0;
  addHistory(k, t, 'Put down their tools to make art for the hoard room.');
  hangUpGear(state, k, t);
  return true;
}

/** How many pieces fit on show in the hoard room. */
export function displaySlots(state: GameState): number {
  return Math.max(ART.minShown, Math.floor(roomVolume(state, 'hoard') / ART.pacesPerPiece));
}

/** Appeal from the art on display. */
export function artAppeal(state: GameState): number {
  return state.art.pieces.reduce((a, p) => a + p.appeal, 0);
}

function canPay(state: GameState, cost: Partial<Record<ResourceId, number>>): boolean {
  return Object.entries(cost).every(([r, n]) => resourceOpen(state, r as ResourceId) && state.res[r as ResourceId] >= (n ?? 0));
}

/** The material an artisan will use next: what they love if possible, else the best they can get. */
export function nextMaterial(state: GameState, k: NamedKobold): MaterialDef | undefined {
  const usable = ART_MATERIALS.filter((m) => Object.keys(m.cost).every((r) => resourceOpen(state, r as ResourceId)));
  return usable.find((m) => m.job === k.loves && canPay(state, m.cost)) ?? usable.find((m) => canPay(state, m.cost));
}

/** How good a piece by this kobold in this material is. */
export function pieceAppeal(k: NamedKobold, m: MaterialDef): number {
  const skill = 1 + 0.1 * Math.min(10, Math.max(0, k.history.length - ART.experiences));
  const love = k.loves === m.job ? 1.5 : 1;
  return Math.round(m.appeal * skill * love * 10) / 10;
}

function pick<T>(xs: T[], rand: () => number): T {
  return xs[Math.floor(rand() * xs.length) % xs.length];
}

/** Put a piece on show. If the room is full, it replaces the weakest piece, if it's better. Returns false if it didn't fit. */
export function display(state: GameState, piece: ArtPiece): boolean {
  const pieces = state.art.pieces;
  if (pieces.length < displaySlots(state)) {
    pieces.push(piece);
    return true;
  }
  let weakest = 0;
  pieces.forEach((p, i) => {
    if (p.appeal < pieces[weakest].appeal) weakest = i;
  });
  if (!pieces.length || pieces[weakest].appeal >= piece.appeal) return false;
  pieces.splice(weakest, 1, piece);
  return true;
}

/** Let `dt` seconds of art happen. Returns chronicle lines. */
export function artStep(state: GameState, dt: number, t: number, rand: () => number): string[] {
  const lines: string[] = [];
  for (const k of artisans(state)) {
    k.artWork = Math.min(ART.hours * 3600, (k.artWork ?? 0) + dt);
    if (k.artWork < ART.hours * 3600) continue;
    const m = nextMaterial(state, k);
    if (!m) continue; // waiting for materials
    for (const [r, n] of Object.entries(m.cost)) state.res[r as ResourceId] -= n ?? 0;
    k.artWork = 0;
    const subject = pick(SUBJECTS, rand).replace('themselves', `${k.name} themselves`);
    const trait = k.traits.length ? ` It is, somehow, ${pick(k.traits, rand).toLowerCase()}.` : '';
    const title = `${m.noun} of ${subject}, ${pick(MOODS, rand)}`;
    const piece: ArtPiece = { id: state.art.nextId++, title, by: fullName(k), material: m.id, appeal: pieceAppeal(k, m), t };
    const shown = display(state, piece);
    addHistory(k, t, `Finished ${title}.`);
    lines.push(
      `${fullName(k)} finished ${title}.${trait} ${shown ? `It's on display in the hoard room (appeal +${piece.appeal}).` : 'The hoard room is full of better pieces, so it went in a cupboard.'}`,
    );
  }
  return lines;
}

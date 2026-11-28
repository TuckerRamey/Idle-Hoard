// Farming: farm caverns are rooms the kobolds dig, one after another. Each is
// planted with one crop. Crops are found in different ways (research, digging,
// woodland, hunting, raids), and each grows a different amount of food, some
// with a small perk on top. Farmers fill the best-yielding caverns first; any
// left over with no room to farm dig the caverns bigger.

import { ROOMS, type RoomDef } from './data';
import { globalMultiplier, jobDef, roomCapacity, roomOpen, workers } from './economy';
import { opened } from './research';
import type { GameState } from './state';

export type CropPerk = 'research' | 'appeal' | 'granary';

export interface CropDef {
  id: string;
  name: string;
  /** Food per farmer, times the farmer's usual rate. */
  yield: number;
  /** For each cavern of it with farmers working: this kind of bonus, times `mult`. */
  perk?: { kind: CropPerk; mult: number };
  description: string;
  /** Where it comes from, in a few words, for crops the warren doesn't know yet. */
  how: string;
  /** Known once this research is done. */
  research?: string;
}

export const CROPS: CropDef[] = [
  { id: 'cave-moss', name: 'Cave moss', yield: 1, description: 'Grey, damp and filling. It grows on anything.', how: '' },
  {
    id: 'blindroot',
    name: 'Blindroot',
    yield: 1.3,
    research: 'root-farming',
    description: 'Pale roots that grow in the pitch dark. More filling than moss.',
    how: 'research',
  },
  {
    id: 'glowcaps',
    name: 'Glowcaps',
    yield: 1.1,
    perk: { kind: 'research', mult: 1.05 },
    description: 'Mushrooms that glow. The researchers read by them: research +5% for each cavern of them.',
    how: 'dug up now and then in big rooms',
  },
  {
    id: 'puffballs',
    name: 'Puffballs',
    yield: 1.2,
    perk: { kind: 'granary', mult: 1.25 },
    description: 'They dry well and keep for ages. The granary holds 25% more food for each cavern of them.',
    how: 'woodcutters finding new woodland',
  },
  {
    id: 'sweet-tubers',
    name: 'Sweet tubers',
    yield: 1.4,
    perk: { kind: 'appeal', mult: 1.1 },
    description: 'Surface food. Kobolds come a long way for a sweet tuber: appeal +10% for each cavern of them.',
    how: 'a raid on a farm',
  },
  {
    id: 'fire-peppers',
    name: 'Fire peppers',
    yield: 1.8,
    description: 'Hot enough to make a kobold cry, and very filling.',
    how: 'hunting salamanders',
  },
];

/** Odds of finding a crop each time the chance comes up. */
export const CROP_FINDS = {
  /** Per cubic pace dug in a room at least `glowcapPaces` big. */
  glowcapsPerPace: 1 / 2_000,
  glowcapPaces: 150,
  /** Each time the woodcutters find woodland after the first. */
  puffballs: 0.5,
  /** Each salamander brought down. */
  firePeppers: 0.15,
};

export const cropDef = (id: string) => CROPS.find((c) => c.id === id);

export const FARM_ROOMS: RoomDef[] = ROOMS.filter((r) => r.holds === 'farmers');

export function cropKnown(state: GameState, id: string): boolean {
  const c = cropDef(id);
  if (!c) return false;
  if (id === 'cave-moss') return true;
  if (c.research && opened(state, c.research)) return true;
  return state.farms.known.includes(id);
}

export function knownCrops(state: GameState): CropDef[] {
  return CROPS.filter((c) => cropKnown(state, c.id));
}

/** Learn a crop. Returns a sentence to add to the chronicle line, or null if it was known already. */
export function discoverCrop(state: GameState, id: string): string | null {
  const c = cropDef(id);
  if (!c || cropKnown(state, id)) return null;
  state.farms.known.push(id);
  return `The farmers can plant ${c.name.toLowerCase()} now (Rooms tab).`;
}

/** What a cavern is planted with. */
export function cropOf(state: GameState, roomId: string): CropDef {
  const c = cropDef(state.farms.crops[roomId] ?? '');
  return c && cropKnown(state, c.id) ? c : CROPS[0];
}

export function plant(state: GameState, roomId: string, cropId: string): boolean {
  if (!FARM_ROOMS.some((r) => r.id === roomId) || !cropKnown(state, cropId)) return false;
  state.farms.crops[roomId] = cropId;
  return true;
}

export interface Field {
  room: RoomDef;
  crop: CropDef;
  fit: number;
  working: number;
}

/** The open farm caverns, best crop first, with how many farmers each has. */
export function fields(state: GameState): Field[] {
  const open = FARM_ROOMS.filter((r) => roomOpen(state, r)).map((room) => ({ room, crop: cropOf(state, room.id), fit: roomCapacity(state, room), working: 0 }));
  const sorted = [...open].sort((a, b) => b.crop.yield - a.crop.yield);
  let left = workers(state, 'farmer');
  for (const f of sorted) {
    f.working = Math.min(f.fit, left);
    left -= f.working;
  }
  return open;
}

export function farmersFit(state: GameState): number {
  return fields(state).reduce((a, f) => a + f.fit, 0);
}

/** Farmers with no room in the caverns. */
export function spareFarmers(state: GameState): number {
  return Math.max(0, workers(state, 'farmer') - farmersFit(state));
}

/** Average yield per farmer: crops times room to work, over the whole crew. */
export function farmFactor(state: GameState): number {
  const n = workers(state, 'farmer');
  if (n === 0) return 1;
  return fields(state).reduce((a, f) => a + f.working * f.crop.yield, 0) / n;
}

/** The cavern spare farmers dig: the newest one open. */
export function farmDigRoom(state: GameState): string | null {
  const open = FARM_ROOMS.filter((r) => roomOpen(state, r));
  return open.length ? open[open.length - 1].id : null;
}

/** Dig work per second from farmers with no room to farm. */
export function farmerDig(state: GameState): number {
  const dig = jobDef('digger');
  const spare = spareFarmers(state);
  if (!dig?.digs || spare <= 0) return 0;
  return spare * dig.digs * globalMultiplier(state);
}

/** A crop perk, multiplied over every cavern of that crop with farmers in it. */
export function cropPerk(state: GameState, kind: CropPerk): number {
  if (!state.farms) return 1;
  let m = 1;
  for (const f of fields(state)) if (f.crop.perk?.kind === kind && f.working >= 1) m *= f.crop.perk.mult;
  return m;
}

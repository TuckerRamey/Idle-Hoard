import type { Chief } from './chief';
import type { DragonRequest } from './dragon';
import type { NamedKobold } from './kobolds';
import { ROOMS, type ResourceId } from './data';

export type MotionSetting = 'normal' | 'low';

export interface Settings {
  /** 'low' animates at about 1 frame per second, for very quiet side screens. */
  motion: MotionSetting;
}

export interface ChronicleEntry {
  /** Epoch ms. */
  t: number;
  text: string;
}

/** Most chronicle entries kept in the save. */
export const CHRONICLE_MAX = 40;

/** A crew: how many kobolds work a job, and their average experience in hours. */
export interface Crew {
  n: number;
  exp: number;
}

export interface RoomState {
  size: number;
  /** Dig work done toward the next size. */
  progress: number;
}

/** Everything that is saved. Keep it plain JSON. */
export interface GameState {
  /** Resources held. Copper is in the hoard room, the rest in the storehouse. */
  res: Record<ResourceId, number>;
  /** Lifetime copper buried. Drives dragon growth; never goes down. */
  totalEarned: number;
  /** Kobolds with no job. */
  idle: number;
  /** Crews by job id. Unknown ids are kept so a newer save isn't damaged. */
  crews: Record<string, Crew>;
  /** Where kobolds who wander in go: a job id, or 'idle'. */
  newcomerJob: string;
  rooms: Record<string, RoomState>;
  /** The room the diggers are working on, or null. */
  digging: string | null;
  /** Ids of bought upgrades and displays. */
  upgrades: string[];
  /** Highest dragon stage reached (index into DRAGON_STAGES). */
  stage: number;
  /** Epoch ms of the last time progress was credited. */
  lastTick: number;
  createdAt: number;
  settings: Settings;
  /** null until the player has named their Chief. */
  chief: Chief | null;
  /** Newest last. */
  chronicle: ChronicleEntry[];
  /** Seconds of progress toward the next kobold arriving. */
  arrivalProgress: number;
  /** Oddities found, by id. */
  oddities: Record<string, OddityRecord>;
  /** `progress` is points put in, per project. */
  research: { done: string[]; current: string | null; progress: Record<string, number> };
  /** The stars of the crowd. They count toward population but not crew counts. */
  named: NamedKobold[];
  nextNamedId: number;
  /** The animal the pasture raises, and seconds left while a new herd settles in. */
  herd: string;
  herdSettle: number;
  /** The alchemist's recipe. */
  recipe: string;
  dragon: DragonState;
  /** For the game's own dice (mishaps, requests), so runs replay the same in tests. */
  seed: number;
}

export interface DragonState {
  /** Seconds since hatching, counting time away. */
  clock: number;
  craving: string;
  /** What it will crave next, once hinted. */
  next: string;
  changeAt: number;
  warned: boolean;
  hungry: boolean;
  /** Seconds fed and content since the last molt. */
  content: number;
  /** Requests granted since the last molt. */
  granted: number;
  /** Requests granted ever. */
  favor: number;
  request: DragonRequest | null;
  nextRequestAt: number;
  /** Meat eaten since the last molt, by animal ('jerky' for the alchemist's). */
  fed: Record<string, number>;
  traits: string[];
}

export function newDragon(): DragonState {
  return {
    clock: 0,
    craving: 'crab',
    next: 'crab',
    changeAt: 2 * 86_400,
    warned: false,
    hungry: true,
    content: 0,
    granted: 0,
    favor: 0,
    request: null,
    nextRequestAt: 1_800,
    fed: {},
    traits: [],
  };
}

export interface OddityRecord {
  count: number;
  /** Epoch ms it was first found. */
  firstAt: number;
}

export function newGame(now: number): GameState {
  const rooms: Record<string, RoomState> = {};
  for (const r of ROOMS) rooms[r.id] = { size: 1, progress: 0 };
  return {
    res: { copper: 0, wood: 0, stone: 0, iron: 0, meat: 0 },
    totalEarned: 0,
    idle: 0,
    crews: {},
    newcomerJob: 'scavenger',
    rooms,
    digging: 'den',
    upgrades: [],
    stage: 0,
    lastTick: now,
    createdAt: now,
    settings: { motion: 'normal' },
    chief: null,
    chronicle: [],
    arrivalProgress: 0,
    oddities: {},
    research: { done: [], current: 'ore-sniffing', progress: {} },
    named: [],
    nextNamedId: 1,
    herd: 'crab',
    herdSettle: 0,
    recipe: 'stone-to-iron',
    dragon: newDragon(),
    seed: (now % 2_147_483_647) || 1,
  };
}

/** The game's own dice: a small seeded generator kept in the save. */
export function rng(state: GameState): () => number {
  // mulberry32
  return () => {
    let t = (state.seed = (state.seed + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function addChronicle(state: GameState, t: number, text: string) {
  state.chronicle.push({ t, text });
  if (state.chronicle.length > CHRONICLE_MAX) state.chronicle.splice(0, state.chronicle.length - CHRONICLE_MAX);
}

import type { Chief } from './chief';
import type { DragonRequest } from './dragon';
import type { ArtPiece } from './art';
import type { ForgeSlot, ToolStock } from './forge';
import type { NamedKobold } from './kobolds';
import type { Colony } from './colonies';
import { ROOMS, type ResourceId } from './data';

export type MotionSetting = 'normal' | 'low';

export interface Settings {
  /** 'low' animates at about 1 frame per second, for very quiet side screens. */
  motion: MotionSetting;
  /** Show the next-goal line under the dragon. */
  goal: boolean;
}

export interface ChronicleEntry {
  /** Epoch ms. */
  t: number;
  text: string;
}

/** Most chronicle entries kept in the save. */
export const CHRONICLE_MAX = 40;

/** A crew: how many crowd kobolds work a job. */
export interface Crew {
  n: number;
}

export interface RoomState {
  /** Cubic paces. */
  volume: number;
}

/** Everything that is saved. Keep it plain JSON. */
export interface GameState {
  /** Resources held, each in its own store (copper in the hoard room). */
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
  /** Crowd diggers working each room, by room id. They add up to the digger crew. */
  dig: Record<string, number>;
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
  /** Art on display in the hoard room. */
  art: { pieces: ArtPiece[]; nextId: number };
  /** How many Chief pips each steady source has given, so none is given twice. */
  chiefMarks: { oddities: number; events: string[]; pending: number };
  /** Small colonies founded by named kobolds. They run on their own and send tribute. */
  colonies: Colony[];
  nextColonyId: number;
  /** The forge's order slots, and what tool orders have been using lately (per second, smoothed). */
  forge: { slots: ForgeSlot[]; toolUse: Partial<Record<ResourceId, number>> };
  /** The tool rack every job takes from, by tier: in use and spare alike. */
  rack: Partial<Record<'stone' | 'iron' | 'steel' | 'mithril' | 'adamant', ToolStock>>;
  /** The job first in line for tools, or null to share them out evenly. */
  toolFirst: string | null;
  /** Gems on the hoard, by kind. Treasure: never spent, worth adds to the hoard. */
  gems: Record<string, number>;
  /** Things only ever found, never made (mithril, adamant), once the first turns up. */
  discovered: string[];
  /** Hunting: the monster the hunters are after, work toward the next kill, kills ever, and meat waiting for the dragon. */
  hunt: HuntState;
  /** Shaman magic: what they work with, mana, and rituals running. */
  magic: MagicState;
  /** Kobolds lost on dangerous work and wandered off, and the clocks toward the next. */
  losses: LossState;
  /** Exploring: what the scouts look for, their points toward the next find of each kind, and the areas found. */
  explore: ExploreState;
  /** For the game's own dice (mishaps, requests), so runs replay the same in tests. */
  seed: number;
}

export interface ExploreState {
  target: 'wood' | 'stone' | 'copper' | 'monsters' | null;
  points: Partial<Record<'wood' | 'stone' | 'copper' | 'monsters', number>>;
  /** Area ids, in the order found. */
  found: string[];
  /** Areas named after the scout who found them. */
  names: Record<string, string>;
  /** Old saves only: extra room per kind, so nothing they made before drops ("the old workings"). */
  bonus: Partial<Record<'wood' | 'stone' | 'copper' | 'monsters', number>>;
  /** Hunting work toward the next kill on each ground. */
  progress: Record<string, number>;
}

export interface LossState {
  /** Toward the next loss on each dangerous job. */
  acc: Record<string, number>;
  /** Seconds there have been idle kobolds without a break, and toward the next one wandering off. */
  idleFor: number;
  wanderAcc: number;
  died: number;
  wandered: number;
}

export function newLosses(): LossState {
  return { acc: {}, idleFor: 0, wanderAcc: 0, died: 0, wandered: 0 };
}

export function newExplore(): ExploreState {
  return { target: 'wood', points: {}, found: ['near-tunnels'], names: {}, bonus: {}, progress: {} };
}

export interface HuntState {
  hunted: Record<string, number>;
  /** Monster meat in the larder, by monster: wild (hunted) and farmed (raised in the pasture). */
  meat: Record<string, { wild: number; farmed: number }>;
  /** Seconds toward the dragon's next bite of monster meat. */
  eatClock: number;
}

export interface MagicState {
  /** Bones from hunts, and dragon dust ground from shed scales and skins. */
  bones: number;
  dust: number;
  mana: number;
  /** Scales and skins already ground into dust. */
  ground: number;
  /** The next raid goes with the dragon blessed. */
  blessed: boolean;
  /** Seconds left of stone-song (digging twice as fast) and of reading the bones (seeing a day ahead). */
  stoneSong: number;
  vision: number;
  /** Finds still to come up at least uncommon. */
  charms: number;
  /** Dragon clock seconds when an elder dragon next casts a spell of its own. */
  nextSpellAt: number;
}

export function newMagic(): MagicState {
  return { bones: 0, dust: 0, mana: 0, ground: 0, blessed: false, stoneSong: 0, vision: 0, charms: 0, nextSpellAt: 0 };
}

export function newHunt(): HuntState {
  return { hunted: {}, meat: {}, eatClock: 0 };
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
  /** Favors it owes you, to spend on its help. */
  boons: number;
  /** Help it's giving right now: a job working faster until `until` (dragon clock seconds). */
  boosts: { job: string; until: number }[];
  request: DragonRequest | null;
  nextRequestAt: number;
  /** Meat eaten since the last molt, by animal ('jerky' for the alchemist's). */
  fed: Record<string, number>;
  traits: string[];
  /** Cubic paces. It grows into the hoard room while content, taking up space there. */
  size: number;
  /** Stats trained by eating monster meat, on top of each stage's base. */
  trained: { might: number; fire: number; presence: number };
  /** A raid it's on: where, when it's back (dragon clock seconds), and who rode along. */
  raid: { target: string; until: number; rider: number | null; blessed?: boolean } | null;
  /** Dragon clock seconds when it next goes raiding. */
  nextRaidAt: number;
  /** Raids on each kind of place, ever. */
  raided: Record<string, number>;
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
    boons: 0,
    boosts: [],
    request: null,
    nextRequestAt: 1_800,
    fed: {},
    traits: [],
    size: 0,
    trained: { might: 0, fire: 0, presence: 0 },
    raid: null,
    nextRaidAt: 0,
    raided: {},
  };
}

export interface OddityRecord {
  count: number;
  /** Epoch ms it was first found. */
  firstAt: number;
}

export function newGame(now: number): GameState {
  const rooms: Record<string, RoomState> = {};
  for (const r of ROOMS) rooms[r.id] = { volume: r.start };
  return {
    res: { copper: 0, silver: 0, gold: 0, wood: 0, stone: 0, ore: 0, bars: 0, steel: 0, mithril: 0, adamant: 0, meat: 0 },
    totalEarned: 0,
    idle: 0,
    crews: {},
    newcomerJob: 'scavenger',
    rooms,
    dig: {},
    stage: 0,
    lastTick: now,
    createdAt: now,
    settings: { motion: 'normal', goal: true },
    chief: null,
    chronicle: [],
    arrivalProgress: 0,
    oddities: {},
    research: { done: [], current: 'ore-sniffing', progress: {} },
    named: [],
    nextNamedId: 1,
    herd: 'crab',
    herdSettle: 0,
    recipe: 'stone-to-ore',
    dragon: newDragon(),
    art: { pieces: [], nextId: 1 },
    chiefMarks: { oddities: 0, events: [], pending: 0 },
    colonies: [],
    nextColonyId: 1,
    forge: { slots: [], toolUse: {} },
    rack: {},
    toolFirst: null,
    gems: {},
    discovered: [],
    hunt: newHunt(),
    magic: newMagic(),
    explore: newExplore(),
    losses: newLosses(),
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

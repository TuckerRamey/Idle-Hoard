import type { Chief } from './chief';
import { CONFIG } from './data';

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

/** Everything that is saved. Keep it plain JSON. */
export interface GameState {
  /** Copper currently in the hoard (spendable). */
  copper: number;
  /** Lifetime copper buried. Drives dragon growth and hoard size; never goes down. */
  totalEarned: number;
  /** Owned count per worker id. Unknown ids are kept so a newer save isn't damaged. */
  workers: Record<string, number>;
  /** Ids of bought upgrades. */
  upgrades: string[];
  /** Highest dragon stage reached (index into DRAGON_STAGES). */
  stage: number;
  /** Epoch ms of the last time income was credited. */
  lastTick: number;
  createdAt: number;
  settings: Settings;
  /** null until the player has named their Chief. */
  chief: Chief | null;
  /** Ids of learned Chief skills. */
  skills: string[];
  /** Newest last. */
  chronicle: ChronicleEntry[];
  /** Seconds of progress toward the next kobold arriving. */
  arrivalProgress: number;
  /** Oddities found, by id. */
  oddities: Record<string, OddityRecord>;
}

export interface OddityRecord {
  count: number;
  /** Epoch ms it was first found. */
  firstAt: number;
}

export function newGame(now: number): GameState {
  return {
    copper: 0,
    totalEarned: 0,
    workers: { ...CONFIG.startingWorkers },
    upgrades: [],
    stage: 0,
    lastTick: now,
    createdAt: now,
    settings: { motion: 'normal' },
    chief: null,
    skills: [],
    chronicle: [],
    arrivalProgress: 0,
    oddities: {},
  };
}

export function addChronicle(state: GameState, t: number, text: string) {
  state.chronicle.push({ t, text });
  if (state.chronicle.length > CHRONICLE_MAX) state.chronicle.splice(0, state.chronicle.length - CHRONICLE_MAX);
}

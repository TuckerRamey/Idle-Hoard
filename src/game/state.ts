import { CONFIG } from './data';

export type MotionSetting = 'normal' | 'low';

export interface Settings {
  /** 'low' animates at about 1 frame per second, for very quiet side screens. */
  motion: MotionSetting;
}

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
  };
}

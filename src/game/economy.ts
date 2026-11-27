import {
  CONFIG,
  DRAGON_STAGES,
  HOARD_SIZE_THRESHOLDS,
  UPGRADES,
  WORKERS,
  type UpgradeDef,
  type WorkerDef,
} from './data';
import type { GameState } from './state';

export function owned(state: GameState, workerId: string): number {
  return state.workers[workerId] ?? 0;
}

export function workerCost(def: WorkerDef, count: number): number {
  return Math.ceil(def.baseCost * Math.pow(def.costGrowth, count));
}

export function workerMultiplier(state: GameState, workerId: string): number {
  let m = 1;
  for (const u of UPGRADES) {
    if (!state.upgrades.includes(u.id)) continue;
    if (u.effect.kind === 'workerMult' && u.effect.worker === workerId) m *= u.effect.mult;
  }
  return m;
}

export function globalMultiplier(state: GameState): number {
  let m = DRAGON_STAGES[state.stage]?.incomeMult ?? 1;
  for (const u of UPGRADES) {
    if (state.upgrades.includes(u.id) && u.effect.kind === 'globalMult') m *= u.effect.mult;
  }
  return m;
}

/** Copper per second for one worker type. */
export function workerRate(state: GameState, def: WorkerDef): number {
  return def.rate * owned(state, def.id) * workerMultiplier(state, def.id) * globalMultiplier(state);
}

/** Total copper per second. */
export function incomePerSecond(state: GameState): number {
  let total = 0;
  for (const def of WORKERS) total += workerRate(state, def);
  return total;
}

/** The dragon stage a lifetime total has earned. Stages never go backwards. */
export function stageFor(totalEarned: number): number {
  let s = 0;
  DRAGON_STAGES.forEach((d, i) => {
    if (totalEarned >= d.threshold) s = i;
  });
  return s;
}

export function hoardSize(totalEarned: number): number {
  let s = 0;
  HOARD_SIZE_THRESHOLDS.forEach((t, i) => {
    if (totalEarned >= t) s = i;
  });
  return s;
}

/**
 * Add income for `seconds` of time. Pure apart from mutating `state`.
 * Returns the copper gained and any stage reached.
 */
export function tick(state: GameState, seconds: number): { gained: number; newStage: number | null } {
  if (!(seconds > 0)) return { gained: 0, newStage: null };
  // Income is constant between purchases, so one multiply is exact. If a stage
  // with a higher income multiplier is crossed part way through, the rest of
  // the time is credited at the new rate.
  let gained = 0;
  let remaining = seconds;
  let newStage: number | null = null;
  // At most one pass per stage plus one, so this always terminates.
  for (let pass = 0; pass <= DRAGON_STAGES.length && remaining > 0; pass++) {
    const rate = incomePerSecond(state);
    if (rate <= 0) break;
    const next = DRAGON_STAGES[state.stage + 1];
    let step = remaining;
    let crossing = false;
    if (next) {
      const toNext = (next.threshold - state.totalEarned) / rate;
      if (toNext < remaining) {
        step = Math.max(toNext, 0);
        crossing = true;
      }
    }
    const g = rate * step;
    state.copper += g;
    state.totalEarned += g;
    gained += g;
    remaining -= step;
    if (crossing && next && state.totalEarned < next.threshold) {
      // floating point fell a hair short of the threshold; snap it
      const diff = next.threshold - state.totalEarned;
      state.copper += diff;
      state.totalEarned += diff;
      gained += diff;
    }
    const s = stageFor(state.totalEarned);
    if (s > state.stage) {
      state.stage = s;
      newStage = s;
    }
  }
  return { gained, newStage };
}

/**
 * Credit all time since `state.lastTick`, capped at the offline cap.
 * Used every tick, so a sleeping laptop, a hidden tab and a closed game
 * all work the same way. A clock that went backwards credits nothing.
 */
export function advanceTo(state: GameState, now: number) {
  const elapsed = Math.max(0, (now - state.lastTick) / 1000);
  const credited = Math.min(elapsed, CONFIG.offlineCapSeconds);
  state.lastTick = Math.max(state.lastTick, now);
  const result = tick(state, credited);
  return { ...result, elapsed, credited };
}

export function canHire(state: GameState, def: WorkerDef): boolean {
  return state.stage >= def.unlockStage;
}

export function hire(state: GameState, workerId: string): boolean {
  const def = WORKERS.find((w) => w.id === workerId);
  if (!def || !canHire(state, def)) return false;
  const cost = workerCost(def, owned(state, def.id));
  if (state.copper < cost) return false;
  state.copper -= cost;
  state.workers[def.id] = owned(state, def.id) + 1;
  return true;
}

export function upgradeVisible(state: GameState, u: UpgradeDef): boolean {
  if (state.upgrades.includes(u.id)) return false;
  const r = u.requires;
  if (r.stage !== undefined && state.stage < r.stage) return false;
  if (r.worker && owned(state, r.worker) < (r.count ?? 1)) return false;
  return true;
}

export function buyUpgrade(state: GameState, upgradeId: string): boolean {
  const u = UPGRADES.find((x) => x.id === upgradeId);
  if (!u || !upgradeVisible(state, u) || state.copper < u.cost) return false;
  state.copper -= u.cost;
  state.upgrades.push(u.id);
  return true;
}

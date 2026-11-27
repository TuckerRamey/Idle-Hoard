import { BRANCHES, quirkOf, RENOWN_BASE, RENOWN_STEP, SKILLS, type SkillDef } from './chief';
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

function learned(state: GameState): SkillDef[] {
  return SKILLS.filter((s) => state.skills.includes(s.id));
}

/** Price multiplier for hiring: Voice, quirk and skills. */
export function costMultiplier(state: GameState): number {
  let m = 1;
  if (state.chief) m *= Math.max(0.5, 1 - 0.03 * state.chief.voice);
  const q = quirkOf(state.chief);
  if (q?.effect.kind === 'costMult') m *= q.effect.mult;
  for (const s of learned(state)) if (s.effect.kind === 'costMult') m *= s.effect.mult;
  return m;
}

/** Base price before the Chief's discounts. */
export function workerBaseCost(def: WorkerDef, count: number): number {
  return def.baseCost * Math.pow(def.costGrowth, count);
}

export function workerCost(state: GameState, def: WorkerDef): number {
  return Math.ceil(workerBaseCost(def, owned(state, def.id)) * costMultiplier(state));
}

export function workerMultiplier(state: GameState, workerId: string): number {
  let m = 1;
  for (const u of UPGRADES) {
    if (!state.upgrades.includes(u.id)) continue;
    if (u.effect.kind === 'workerMult' && u.effect.worker === workerId) m *= u.effect.mult;
  }
  const q = quirkOf(state.chief);
  if (q?.effect.kind === 'workerMult' && q.effect.worker === workerId) m *= q.effect.mult;
  for (const s of learned(state))
    if (s.effect.kind === 'crewScaling') m *= 1 + Math.floor(owned(state, workerId) / s.effect.per) * s.effect.bonus;
  return m;
}

export function globalMultiplier(state: GameState): number {
  let m = DRAGON_STAGES[state.stage]?.incomeMult ?? 1;
  for (const u of UPGRADES) {
    if (state.upgrades.includes(u.id) && u.effect.kind === 'globalMult') m *= u.effect.mult;
  }
  if (state.chief) m *= 1 + 0.05 * state.chief.nerve;
  for (const s of learned(state)) if (s.effect.kind === 'globalMult') m *= s.effect.mult;
  return m;
}

/** Copper per second for one worker type. */
export function workerRate(state: GameState, def: WorkerDef): number {
  return def.rate * owned(state, def.id) * workerMultiplier(state, def.id) * globalMultiplier(state);
}

/** Copper per second the Chief brings in personally. */
export function chiefRate(state: GameState): number {
  return state.chief ? CONFIG.chiefRate * globalMultiplier(state) : 0;
}

/** Total copper per second. */
export function incomePerSecond(state: GameState): number {
  let total = chiefRate(state);
  for (const def of WORKERS) total += workerRate(state, def);
  return total;
}

/** Longest absence that earns progress, in seconds. */
export function offlineCap(state: GameState): number {
  let h = 0;
  for (const s of learned(state)) if (s.effect.kind === 'offlineHours') h += s.effect.hours;
  return CONFIG.offlineCapSeconds + h * 3600;
}

// ---------- renown and skill points ----------

/** Renown grows with lifetime copper, faster with Cunning and some quirks. */
export function renown(state: GameState): number {
  if (!state.chief) return 0;
  let m = 1 + 0.1 * state.chief.cunning;
  const q = quirkOf(state.chief);
  if (q?.effect.kind === 'renownMult') m *= q.effect.mult;
  return state.totalEarned * m;
}

/** Renown needed for the nth renown point (n from 1). */
export function renownForPoint(n: number): number {
  return RENOWN_BASE * Math.pow(RENOWN_STEP, n - 1);
}

/** Points from renown, plus one for each dragon stage reached. */
export function skillPointsEarned(state: GameState): number {
  const r = renown(state);
  const fromRenown = r < RENOWN_BASE ? 0 : Math.floor(Math.log(r / RENOWN_BASE) / Math.log(RENOWN_STEP) + 1e-9) + 1;
  return fromRenown + state.stage;
}

export function skillPointsSpent(state: GameState): number {
  return learned(state).reduce((sum, s) => sum + s.cost, 0);
}

export function skillPointsFree(state: GameState): number {
  return skillPointsEarned(state) - skillPointsSpent(state);
}

export function canLearn(state: GameState, skill: SkillDef): boolean {
  if (!state.chief || state.skills.includes(skill.id)) return false;
  if (!BRANCHES.find((b) => b.id === skill.branch)?.available) return false;
  if (!skill.requires.every((r) => state.skills.includes(r))) return false;
  return skillPointsFree(state) >= skill.cost;
}

export function learnSkill(state: GameState, skillId: string): boolean {
  const skill = SKILLS.find((s) => s.id === skillId);
  if (!skill || !canLearn(state, skill)) return false;
  state.skills.push(skill.id);
  return true;
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
  const credited = Math.min(elapsed, offlineCap(state));
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
  const cost = workerCost(state, def);
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

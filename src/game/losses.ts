// Fewer kobolds: idle kobolds with nothing to do for a day or more wander
// off, and hunters and deep miners now and then don't come back.
// Only the crowd can die: a named kobold on dangerous work is only badly
// hurt, and sits by the hoard for a few hours. Nobody is ever hurt in the lab.
// Pure functions over GameState; the step returns chronicle lines.

import { fills } from './areas';
import { crew, flows, population, workers } from './economy';
import { toolMults } from './forge';
import { addHistory, fullName, namedIn, takeDigger } from './kobolds';
import { armorProtect, luckyHat } from './gear';
import { researchMult } from './research';
import type { GameState } from './state';

export const LOSSES = {
  /** Idle kobolds start to drift off once there have been idle kobolds this long... */
  idleGraceSeconds: 86_400,
  /** ...and then each one leaves after about this long, on average. */
  wanderSeconds: 2 * 86_400,
  /** Working hours for each crowd loss, on average, on each dangerous job. */
  hoursPerLoss: { hunter: 40, miner: 150 } as Record<string, number>,
  /** A named kobold who'd have been lost is hurt instead, and rests this long. */
  restSeconds: 4 * 3600,
};

export const DANGER_JOBS = Object.keys(LOSSES.hoursPerLoss);

/** Lines for the chronicle, by job. {who} is "A hunter" or the like. */
const DEATHS: Record<string, string[]> = {
  hunter: [
    '{who} was caught by the hunt instead of the other way round.',
    '{who} went after a kill that was not quite dead.',
    '{who} fell from a ledge chasing something quick.',
  ],
  miner: [
    '{who} was lost when the deep rock shifted.',
    '{who} broke into a pocket of bad air down in the deep workings.',
  ],
};

const HURTS: Record<string, string> = {
  hunter: 'was mauled on a hunt',
  miner: 'was caught in a small cave-in in the deep workings',
};

const JOB_NAMES: Record<string, string> = { hunter: 'A hunter', miner: 'A miner' };

/** Is a named kobold resting after being hurt? Resting kobolds don't work. */
export function resting(k: { restLeft?: number }): boolean {
  return (k.restLeft ?? 0) > 0;
}

/**
 * Of a job's workers, how many are actually out doing the dangerous work: only
 * those kobolds face it. Hunters past what the grounds can take go looking
 * for more (safely enough), and miners are only
 * in danger in the deep workings.
 */
export function exposed(state: GameState, job: string): number {
  const n = workers(state, job);
  if (n === 0) return 0;
  if (job === 'hunter' || job === 'miner') {
    const f = fills(state, job === 'hunter' ? 'monsters' : 'stone');
    if (f.raw <= 0) return 0;
    const out = f.fills.reduce((a, x) => a + (job === 'miner' && !x.area?.deep ? 0 : x.used), 0);
    return (n * out) / f.raw;
  }
  return n;
}

/** How much safer research and gear make a job: lower is safer. Better tools mean better ropes, lanterns and armor. */
export function dangerMult(state: GameState, job: string): number {
  const gear = toolMults(state, job).crew;
  return researchMult(state, 'dangerMult', (e) => !e.job || e.job === job) / gear;
}

/** Expected crowd losses an hour on a job right now. */
export function lossesPerHour(state: GameState, job: string): number {
  const hrs = LOSSES.hoursPerLoss[job];
  if (!hrs) return 0;
  return (exposed(state, job) / hrs) * dangerMult(state, job);
}

function pick<T>(xs: T[], rand: () => number): T {
  return xs[Math.floor(rand() * xs.length) % xs.length];
}

/** Let `dt` seconds pass. Returns chronicle lines, and how many were lost and wandered off. */
export function lossStep(state: GameState, dt: number, t: number, rand: () => number): { lines: string[]; died: Record<string, number>; wandered: number } {
  const lines: string[] = [];
  const died: Record<string, number> = {};
  const L = state.losses;

  // named kobolds healing
  for (const k of state.named) if (resting(k)) k.restLeft = Math.max(0, k.restLeft! - dt);

  // danger on the job
  for (const job of DANGER_JOBS) {
    const rate = lossesPerHour(state, job);
    if (rate <= 0) continue;
    L.acc[job] = (L.acc[job] ?? 0) + (rate * dt) / 3600;
    // a steady clock with a little luck either way, so losses are spread out rather than all at once
    while (L.acc[job] >= 1) {
      L.acc[job] -= 0.5 + rand();
      const named = namedIn(state, job);
      const total = workers(state, job);
      if (total <= 0) break;
      if (named.length && rand() < named.length / total) {
        const k = pick(named, rand);
        // good armor turns some blows aside; a kobold with no trinket might be saved by their hat
        const guard = armorProtect(k);
        if (guard > 0 && rand() < guard) {
          addHistory(k, t, `Walked away from a bad fall while ${job === 'hunter' ? 'hunting' : 'mining deep'}, thanks to their armor.`);
          lines.push(`${fullName(k)} should have been badly hurt, but their armor took it.`);
          continue;
        }
        const hat = luckyHat(k, t, rand);
        if (hat) {
          lines.push(hat);
          continue;
        }
        k.restLeft = LOSSES.restSeconds * (1 - guard);
        addHistory(k, t, `${HURTS[job].replace(/^./, (ch) => ch.toUpperCase())}, and spent a few hours by the hoard getting better.`);
        lines.push(`${fullName(k)} ${HURTS[job]}. They're resting by the hoard for a few hours.`);
        continue;
      }
      const c = crew(state, job);
      if (c.n <= 0) continue;
      state.crews[job] = { ...c, n: c.n - 1 };
      died[job] = (died[job] ?? 0) + 1;
      L.died += 1;
      const rec = state.oddities['memorial-wall'];
      if (rec) rec.count++;
      else state.oddities['memorial-wall'] = { count: 1, firstAt: t };
      lines.push(pick(DEATHS[job], rand).replace('{who}', JOB_NAMES[job]));
    }
  }

  // idle kobolds drifting off
  let wandered = 0;
  if (state.idle > 0 && state.chief) {
    L.idleFor += dt;
    if (L.idleFor >= LOSSES.idleGraceSeconds) {
      L.wanderAcc += (state.idle * dt) / LOSSES.wanderSeconds;
      while (L.wanderAcc >= 1 && state.idle > 0) {
        L.wanderAcc -= 1;
        state.idle -= 1;
        wandered++;
      }
    }
  } else {
    L.idleFor = 0;
    L.wanderAcc = 0;
  }
  if (wandered) {
    L.wandered += wandered;
    lines.push(wandered === 1 ? 'An idle kobold got bored of waiting for work and wandered off.' : `${wandered} idle kobolds got bored of waiting for work and wandered off.`);
  }
  return { lines, died, wandered };
}

// ---------- food ----------

export const FOOD = {
  /** Food each kobold eats a second (about 180 an hour). */
  perKobold: 0.05,
  /** The warren can go short this long before anyone leaves. */
  graceSeconds: 3600,
  /** Then each kobold going hungry leaves after about this long, on average. */
  leaveSeconds: 6 * 3600,
};

/** Food the warren eats a second: every kobold, crowd and named. */
export function foodNeed(state: GameState): number {
  return population(state) * FOOD.perKobold;
}

/** Kobolds going hungry right now: those the food coming in and on hand can't feed. */
export function hungry(state: GameState): number {
  if (state.res.food >= 1) return 0;
  const f = flows(state).food;
  return Math.max(0, Math.round((foodNeed(state) - f.in) / FOOD.perKobold));
}

/** Kobolds eat. Short of food for a while, some leave to find it elsewhere: idle ones first. Returns lines and how many left. */
export function eatStep(state: GameState, dt: number): { lines: string[]; left: number } {
  if (!state.chief) return { lines: [], left: 0 };
  const L = state.losses;
  const need = foodNeed(state) * dt;
  const ate = Math.min(need, state.res.food);
  state.res.food -= ate;
  const short = need > 0 ? (need - ate) / need : 0;
  if (short <= 1e-9) {
    L.hungryFor = 0;
    L.starveAcc = 0;
    return { lines: [], left: 0 };
  }
  L.hungryFor = (L.hungryFor ?? 0) + dt;
  if (L.hungryFor < FOOD.graceSeconds) return { lines: [], left: 0 };
  L.starveAcc = (L.starveAcc ?? 0) + (population(state) * short * dt) / FOOD.leaveSeconds;
  let left = 0;
  while (L.starveAcc >= 1 && leaveOne(state)) {
    L.starveAcc -= 1;
    left++;
  }
  if (!left) return { lines: [], left: 0 };
  L.starved = (L.starved ?? 0) + left;
  return { lines: [left === 1 ? 'A hungry kobold left to find food somewhere else.' : `${left} hungry kobolds left to find food somewhere else.`], left };
}

/** One crowd kobold leaves: an idle one if there is one, else one from the biggest crew. */
function leaveOne(state: GameState): boolean {
  if (state.idle > 0) {
    state.idle -= 1;
    return true;
  }
  let best: string | null = null;
  for (const [job, c] of Object.entries(state.crews)) if (c.n > 0 && (best === null || c.n > state.crews[best].n)) best = job;
  if (!best) return false;
  if (best === 'digger') takeDigger(state);
  state.crews[best] = { ...state.crews[best], n: state.crews[best].n - 1 };
  return true;
}

/** A note for the Idle row: why they're idle, and that they won't wait for ever. */
export function idleNote(state: GameState): string | null {
  if (state.idle <= 0) return null;
  const L = state.losses;
  if (L.idleFor >= LOSSES.idleGraceSeconds) return 'They have had nothing to do for a day, and are starting to wander off. Find them work: digging always needs hands, and gatherers with no room go looking for more.';
  return 'Idle kobolds who have nothing to do for a day start to wander off. Digging always needs hands, and gatherers with no room go looking for more places.';
}

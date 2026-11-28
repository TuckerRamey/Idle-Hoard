// Fewer kobolds: idle kobolds with nothing to do for a day or more wander
// off, and scouts, hunters and deep miners now and then don't come back.
// Only the crowd can die: a named kobold on dangerous work is only badly
// hurt, and sits by the hoard for a few hours. Nobody is ever hurt in the lab.
// Pure functions over GameState; the step returns chronicle lines.

import { fills } from './areas';
import { crew, workers } from './economy';
import { toolMults } from './forge';
import { addHistory, fullName, namedIn } from './kobolds';
import { researchMult } from './research';
import type { GameState } from './state';

export const LOSSES = {
  /** Idle kobolds start to drift off once there have been idle kobolds this long... */
  idleGraceSeconds: 86_400,
  /** ...and then each one leaves after about this long, on average. */
  wanderSeconds: 2 * 86_400,
  /** Working hours for each crowd loss, on average, on each dangerous job. */
  hoursPerLoss: { scout: 10, hunter: 100, miner: 400 } as Record<string, number>,
  /** A named kobold who'd have been lost is hurt instead, and rests this long. */
  restSeconds: 4 * 3600,
};

export const DANGER_JOBS = Object.keys(LOSSES.hoursPerLoss);

/** Lines for the chronicle, by job. {who} is "A scout" or the like. */
const DEATHS: Record<string, string[]> = {
  scout: [
    '{who} went down a crack to see where it went, and did not come back.',
    '{who} took a wrong turn in the dark. The others waited a day, then came home.',
    '{who} was lost in a cave-in. The scouts marked the spot with a pile of stones.',
    '{who} met something with too many teeth. The map they were drawing came back without them.',
  ],
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
  scout: 'was badly hurt in a fall while scouting',
  hunter: 'was mauled on a hunt',
  miner: 'was caught in a small cave-in in the deep workings',
};

const JOB_NAMES: Record<string, string> = { scout: 'A scout', hunter: 'A hunter', miner: 'A miner' };

/** Is a named kobold resting after being hurt? Resting kobolds don't work. */
export function resting(k: { restLeft?: number }): boolean {
  return (k.restLeft ?? 0) > 0;
}

/** Of a job's workers, the share in danger: everyone for scouts and hunters, only those in the deep workings for miners. */
function exposed(state: GameState, job: string): number {
  const n = workers(state, job);
  if (job !== 'miner' || n === 0) return n;
  const f = fills(state, 'stone');
  if (f.raw <= 0) return 0;
  const deep = f.fills.reduce((a, x) => a + (x.area?.deep ? x.used : 0), 0);
  return (n * deep) / f.raw;
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
        k.restLeft = LOSSES.restSeconds;
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

/** A note for the Idle row: why they're idle, and that they won't wait for ever. */
export function idleNote(state: GameState): string | null {
  if (state.idle <= 0) return null;
  const L = state.losses;
  if (L.idleFor >= LOSSES.idleGraceSeconds) return 'They have had nothing to do for a day, and are starting to wander off. Find them work: scouting, digging, or a new area.';
  return 'Idle kobolds who have nothing to do for a day start to wander off. Scouting always needs hands.';
}

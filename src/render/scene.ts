// Works out what to draw at a given moment. Pure: no DOM, no canvas.
// The renderer compares the result with the previous one and only redraws
// the canvas when something actually changed.

import { DRAGON_STAGES, WORKERS } from '../game/data';
import { hoardSize, owned } from '../game/economy';
import type { GameState, MotionSetting } from '../game/state';
import { SCENE_W, SPRITES } from './manifest';

export interface DrawOp {
  sprite: string;
  anim: string;
  frame: number;
  x: number;
  y: number;
  flip?: boolean;
}

/** Most kobolds of one kind drawn at once, to keep the scene readable and cheap. */
export const MAX_VISIBLE_PER_WORKER = 6;
const HOARD_X = 160; // centre of the hoard
const HOARD_BOTTOM = 137;
const TUNNEL_X = 18;
const LANE_Y = [110, 118, 126];
const CHIEF_Y = 114;
/** The Chief hauls a little slower than a scavenger: they keep stopping to admire the egg. */
const CHIEF_SPEED = 14;

/** How often the scene can change, in ms. Low motion steps once a second. */
export function stepMs(motion: MotionSetting): number {
  return motion === 'low' ? 1000 : 125;
}

function frameAt(sprite: string, anim: string, t: number): number {
  const a = SPRITES[sprite]?.animations[anim];
  if (!a || a.frames <= 1 || a.fps <= 0) return 0;
  return Math.floor((t / 1000) * a.fps) % a.frames;
}

/** Pile half-width and height for a hoard size, matching the placeholder art. */
function pileShape(size: number) {
  return { rx: 10 + size * 9, ry: 3 + size * 6 };
}

export function buildScene(state: GameState, nowMs: number): DrawOp[] {
  const step = stepMs(state.settings.motion);
  const t = Math.floor(nowMs / step) * step;
  const ops: DrawOp[] = [{ sprite: 'background', anim: 'idle', frame: 0, x: 0, y: 0 }];

  // Station workers stand at the back wall, behind the hoard.
  for (const def of WORKERS) {
    if (def.job.kind !== 'station') continue;
    const n = Math.min(owned(state, def.id), MAX_VISIBLE_PER_WORKER);
    const fh = SPRITES[def.sprite]?.frameH ?? 12;
    for (let i = 0; i < n; i++) {
      // offset each kobold a little so they don't swing in unison
      const frame = frameAt(def.sprite, 'work', t + i * 370);
      ops.push({ sprite: def.sprite, anim: 'work', frame, x: def.job.x + i * def.job.spacing, y: def.job.y - fh });
    }
  }

  // Hoard
  const size = hoardSize(state.totalEarned);
  const hoard = SPRITES.hoard;
  ops.push({ sprite: 'hoard', anim: 'sizes', frame: size, x: HOARD_X - hoard.frameW / 2, y: HOARD_BOTTOM - hoard.frameH });
  const { rx, ry } = pileShape(size);
  const pileTop = HOARD_BOTTOM - 1 - ry;

  // Egg or dragon on top of the hoard
  const stage = DRAGON_STAGES[state.stage] ?? DRAGON_STAGES[0];
  const sp = SPRITES[stage.sprite];
  if (sp) {
    let anim: string;
    let frame: number;
    if (state.stage === 0) {
      // the egg sits still, then wobbles for two seconds every eight
      anim = 'wobble';
      const inCycle = t % 8000;
      frame = inCycle < 2000 ? frameAt(stage.sprite, anim, inCycle) : 0;
    } else {
      // snore for 20 seconds, then count coins for 8
      anim = t % 28000 < 20000 ? 'snore' : 'count';
      frame = frameAt(stage.sprite, anim, t);
    }
    const sink = state.stage === 0 ? 5 : Math.round(sp.frameH * 0.12); // buried a little in the coins
    ops.push({ sprite: stage.sprite, anim, frame, x: Math.round(HOARD_X - sp.frameW / 2), y: pileTop - sp.frameH + sink });
  }

  // The Chief hauls copper alone while it's still an egg, then stands by the hoard giving orders.
  if (state.chief) {
    const sprite = 'kobold-chief';
    const fw = SPRITES[sprite]?.frameW ?? 12;
    if (state.stage === 0) {
      const from = TUNNEL_X, to = HOARD_X - rx - fw + 4;
      const dist = Math.max(to - from, 1);
      const cycle = ((2 * dist) / CHIEF_SPEED) * 1000;
      const p = (t % cycle) / cycle;
      const outbound = p < 0.5;
      const x = outbound ? from + dist * (p * 2) : to - dist * ((p - 0.5) * 2);
      const anim = outbound ? 'carry' : 'walk';
      ops.push({ sprite, anim, frame: frameAt(sprite, anim, t), x: Math.round(x), y: CHIEF_Y, flip: !outbound });
    } else {
      ops.push({ sprite, anim: 'direct', frame: frameAt(sprite, 'direct', t), x: Math.round(HOARD_X - rx - fw - 6), y: CHIEF_Y });
    }
  }

  // Haulers walk between the tunnel and the hoard.
  for (const def of WORKERS) {
    if (def.job.kind !== 'haul') continue;
    const n = Math.min(owned(state, def.id), MAX_VISIBLE_PER_WORKER);
    if (n === 0) continue;
    const fw = SPRITES[def.sprite]?.frameW ?? 12;
    const from = TUNNEL_X;
    const to = HOARD_X - rx - fw + 4;
    const dist = Math.max(to - from, 1);
    const cycle = ((2 * dist) / def.job.speed) * 1000;
    const y = LANE_Y[def.job.lane % LANE_Y.length];
    for (let i = 0; i < n; i++) {
      const p = ((t + (cycle * i) / n) % cycle) / cycle; // 0..1 around the round trip
      const outbound = p < 0.5;
      const x = outbound ? from + dist * (p * 2) : to - dist * ((p - 0.5) * 2);
      const anim = outbound ? 'carry' : 'walk';
      ops.push({ sprite: def.sprite, anim, frame: frameAt(def.sprite, anim, t + i * 130), x: Math.round(x), y, flip: !outbound });
    }
  }

  return ops.filter((o) => o.x < SCENE_W);
}

/** A cheap fingerprint of a scene, to skip redraws when nothing moved. */
export function sceneKey(ops: DrawOp[]): string {
  let s = '';
  for (const o of ops) s += `${o.sprite}${o.anim}${o.frame},${o.x},${o.y}${o.flip ? 'f' : ''};`;
  return s;
}

// Canvas renderer tuned for sitting on a side screen all day:
// - wakes up only at the animation step (8/s normally, 1/s on low motion), never at 60fps
// - redraws only when the scene's fingerprint changed
// - stops completely while the tab or window is hidden

import type { GameState } from '../game/state';
import { SCENE_H, SCENE_W, SPRITES } from './manifest';
import { buildScene, sceneKey, stepMs, type DrawOp } from './scene';

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private images = new Map<string, HTMLImageElement>();
  private timer: number | undefined;
  private lastKey = '';
  private running = false;
  /** Count of real canvas draws, shown in the debug readout. */
  draws = 0;

  constructor(
    canvas: HTMLCanvasElement,
    private getState: () => GameState,
  ) {
    canvas.width = SCENE_W;
    canvas.height = SCENE_H;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D not available');
    this.ctx = ctx;
    for (const [id, def] of Object.entries(SPRITES)) {
      const img = new Image();
      img.onload = () => this.invalidate();
      img.onerror = () => console.warn(`Missing sprite sheet for "${id}": ${def.src}`);
      img.src = def.src;
      this.images.set(id, img);
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.invalidate();
    this.loop();
  }

  stop() {
    this.running = false;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Force the next step to redraw (e.g. art finished loading). */
  invalidate() {
    this.lastKey = '';
  }

  private loop = () => {
    if (!this.running) return;
    const now = Date.now();
    this.render(now);
    // Sleep until the next animation step boundary.
    const step = stepMs(this.getState().settings.motion);
    this.timer = window.setTimeout(this.loop, step - (now % step) + 2);
  };

  render(now: number) {
    const ops = buildScene(this.getState(), now);
    const key = sceneKey(ops);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.draw(ops);
  }

  private draw(ops: DrawOp[]) {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#120d17';
    ctx.fillRect(0, 0, SCENE_W, SCENE_H);
    for (const op of ops) {
      const def = SPRITES[op.sprite];
      const img = this.images.get(op.sprite);
      if (!def) continue;
      const a = def.animations[op.anim];
      const sx = op.frame * def.frameW;
      const sy = (a?.row ?? 0) * def.frameH;
      if (img && !img.complete) continue; // still loading; it redraws once it's in, rather than flashing a pink box
      if (!img || img.naturalWidth === 0) {
        // art missing: draw a box so it's obvious what didn't load
        ctx.fillStyle = '#ff00ff';
        ctx.fillRect(op.x, op.y, def.frameW, def.frameH);
        continue;
      }
      if (op.flip) {
        ctx.save();
        ctx.translate(op.x + def.frameW, op.y);
        ctx.scale(-1, 1);
        ctx.drawImage(img, sx, sy, def.frameW, def.frameH, 0, 0, def.frameW, def.frameH);
        ctx.restore();
      } else {
        ctx.drawImage(img, sx, sy, def.frameW, def.frameH, op.x, op.y, def.frameW, def.frameH);
      }
    }
    this.draws++;
  }
}

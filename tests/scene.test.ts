import { describe, expect, it } from 'vitest';
import { buildScene, sceneKey, stepMs, MAX_VISIBLE_PER_WORKER } from '../src/render/scene';
import { newGame } from '../src/game/state';

const T0 = 1_700_000_000_000; // a multiple of 1000

describe('scene', () => {
  it('shows the egg and one kobold at the start', () => {
    const ops = buildScene(newGame(T0), T0);
    expect(ops.some((o) => o.sprite === 'egg')).toBe(true);
    expect(ops.filter((o) => o.sprite === 'kobold-scavenger')).toHaveLength(1);
  });

  it('shows a dragon instead of the egg after hatching', () => {
    const s = newGame(T0);
    s.stage = 1;
    const ops = buildScene(s, T0);
    expect(ops.some((o) => o.sprite === 'egg')).toBe(false);
    expect(ops.some((o) => o.sprite === 'wyrmling')).toBe(true);
  });

  it('caps how many kobolds are drawn', () => {
    const s = newGame(T0);
    s.workers.scavenger = 500;
    expect(buildScene(s, T0).filter((o) => o.sprite === 'kobold-scavenger')).toHaveLength(MAX_VISIBLE_PER_WORKER);
  });

  it('does not change within one animation step (so no redraw is needed)', () => {
    for (const motion of ['normal', 'low'] as const) {
      const s = newGame(T0);
      s.settings.motion = motion;
      const step = stepMs(motion);
      expect(sceneKey(buildScene(s, T0))).toBe(sceneKey(buildScene(s, T0 + step - 1)));
    }
  });

  it('low motion changes at most once a second', () => {
    const s = newGame(T0);
    s.settings.motion = 'low';
    const keys = new Set<string>();
    for (let t = 0; t < 10_000; t += 50) keys.add(sceneKey(buildScene(s, T0 + t)));
    expect(keys.size).toBeLessThanOrEqual(10);
  });
});

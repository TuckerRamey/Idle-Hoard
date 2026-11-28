// Sprite sheet manifest. To swap in real art, see "Swapping in your own art"
// in the README. In short: replace the PNG in src/assets/art/ and, if your frame
// size, frame count or speed differ, change the matching entry below.
//
// A sheet is a grid: each animation is one row, frames go left to right.

export interface AnimationDef {
  /** Row in the sheet (0 = top). */
  row: number;
  frames: number;
  /** Frames per second at normal motion. Keep these low; this is a side-screen game. */
  fps: number;
}

export interface SpriteDef {
  src: string;
  frameW: number;
  frameH: number;
  animations: Record<string, AnimationDef>;
}

// Vite turns this into a hashed URL at build time (or a data URI in the single-file build).
const art = (file: string) => new URL(`../assets/art/${file}`, import.meta.url).href;

const KOBOLD_ANIMS = {
  walk: { row: 0, frames: 4, fps: 6 },
  carry: { row: 1, frames: 4, fps: 6 },
  work: { row: 2, frames: 4, fps: 4 },
};
const DRAGON_ANIMS = {
  snore: { row: 0, frames: 4, fps: 1.5 },
  count: { row: 1, frames: 4, fps: 3 },
};

export const SPRITES: Record<string, SpriteDef> = {
  background: { src: art('background.png'), frameW: 256, frameH: 144, animations: { idle: { row: 0, frames: 1, fps: 0 } } },
  hoard: {
    src: art('hoard.png'),
    frameW: 112,
    frameH: 40,
    // Not animated: the frame is picked by hoard size (see HOARD_SIZE_THRESHOLDS).
    animations: { sizes: { row: 0, frames: 6, fps: 0 } },
  },
  metals: {
    src: art('metals.png'),
    frameW: 112,
    frameH: 40,
    // Silver and gold coins drawn over the pile, the same frame as the hoard's size.
    animations: { silver: { row: 0, frames: 6, fps: 0 }, gold: { row: 1, frames: 6, fps: 0 } },
  },
  egg: { src: art('egg.png'), frameW: 16, frameH: 20, animations: { wobble: { row: 0, frames: 4, fps: 2 } } },
  wyrmling: { src: art('wyrmling.png'), frameW: 32, frameH: 24, animations: DRAGON_ANIMS },
  'young-dragon': { src: art('young-dragon.png'), frameW: 48, frameH: 36, animations: DRAGON_ANIMS },
  'adult-dragon': { src: art('adult-dragon.png'), frameW: 64, frameH: 48, animations: DRAGON_ANIMS },
  'kobold-scavenger': { src: art('kobold-scavenger.png'), frameW: 12, frameH: 12, animations: KOBOLD_ANIMS },
  'kobold-digger': { src: art('kobold-digger.png'), frameW: 12, frameH: 12, animations: KOBOLD_ANIMS },
  'kobold-woodcutter': { src: art('kobold-woodcutter.png'), frameW: 12, frameH: 12, animations: KOBOLD_ANIMS },
  'kobold-quarrier': { src: art('kobold-quarrier.png'), frameW: 12, frameH: 12, animations: KOBOLD_ANIMS },
  'kobold-researcher': { src: art('kobold-researcher.png'), frameW: 12, frameH: 12, animations: KOBOLD_ANIMS },
  'kobold-miner': { src: art('kobold-miner.png'), frameW: 12, frameH: 12, animations: KOBOLD_ANIMS },
  'kobold-herder': { src: art('kobold-herder.png'), frameW: 12, frameH: 12, animations: KOBOLD_ANIMS },
  'kobold-alchemist': { src: art('kobold-alchemist.png'), frameW: 12, frameH: 12, animations: KOBOLD_ANIMS },
  'kobold-blacksmith': { src: art('kobold-blacksmith.png'), frameW: 12, frameH: 12, animations: KOBOLD_ANIMS },
  // Hats for named kobolds, drawn over the kobold at the same spot. One frame per look.
  hats: { src: art('hats.png'), frameW: 12, frameH: 12, animations: { looks: { row: 0, frames: 6, fps: 0 } } },
  // Kobolds with no job yet. They mostly stand about.
  'kobold-idle': { src: art('kobold-idle.png'), frameW: 12, frameH: 12, animations: KOBOLD_ANIMS },
  // Same layout as the other kobolds, but row 2 is a pointing "directing" pose.
  'kobold-chief': {
    src: art('kobold-chief.png'),
    frameW: 12,
    frameH: 12,
    animations: { ...KOBOLD_ANIMS, direct: { row: 2, frames: 4, fps: 1 } },
  },
};

/** The scene is drawn at this size and scaled up with crisp pixels. */
export const SCENE_W = 256;
export const SCENE_H = 144;

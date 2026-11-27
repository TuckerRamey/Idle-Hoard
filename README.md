# Idle Hoard

A quiet idle game about a dragon's hoard, made to sit open on a side screen.

An ambitious kobold finds a dragon egg in the dark and tries to hatch it by burying it in copper. Hire more kobolds, watch the pile grow, and the egg hatches into a wyrmling that keeps growing as the hoard does. There's no clicking needed beyond hiring and buying upgrades.

## Play it

- **Online:** once this repo's GitHub Pages is switched on (see [Deploying](#deploying)), every push to `main` publishes to `https://tuckerramey.github.io/Idle-Hoard/`.
- **Locally:**
  ```sh
  npm install
  npm run dev        # opens a dev server with hot reload, usually http://localhost:5173
  ```

Add `?debug` to the URL to see how often the canvas is redrawn, and to get a `hoard` object in the browser console:

```js
hoard.state        // the live game state
hoard.skip(3600)   // pretend an hour passed (tests offline progress)
hoard.save()       // save right now
```

## Testing

```sh
npm test           # unit tests: economy tick, offline progress, save/migrations, scene
npm run typecheck
npm run build      # production build into dist/
```

Things worth checking by hand when reviewing a change:

1. Start a new game (Settings and save > Start over). The egg and one kobold should appear.
2. Close the tab, wait a few minutes, reopen. A "while you were away" note should credit the time.
3. Switch to another tab and back. Nothing should run while hidden (with `?debug`, the draw count stays still).
4. Settings > Copy save, Start over, paste it back and Load pasted save. Progress should return.

## How it stays light

- The economy ticks once a second. Income is computed from elapsed wall-clock time, so a hidden tab, a sleeping laptop and a closed game all credit the same way (capped at 24 hours, see `CONFIG` in `src/game/data.ts`).
- The scene is a 256×144 canvas scaled up with crisp pixels. It wakes up at most 8 times a second (once a second on **Animation: low**), and only redraws if a sprite frame or position actually changed.
- Everything stops while the tab or window is hidden. No `requestAnimationFrame` loop.
- The side panel is plain HTML that only rewrites text that changed.

## Saves

Saves live in `localStorage` under `idle-hoard.save`, written every minute, when the tab is hidden and when it closes. Each save records a version number.

When you change the shape of the saved state (`src/game/state.ts`):

- **Adding a field or a new worker/upgrade:** nothing to do. `normalize` in `src/game/save.ts` fills defaults for anything missing.
- **Renaming, removing or changing the meaning of a field:** bump `SAVE_VERSION`, add `MIGRATIONS[oldVersion]` that converts an old state to the new shape, and add a test with a real old save in `tests/save.test.ts`.

Before a migrated save is used, the original text is copied to `idle-hoard.save.backup`. A save that can't be read at all (corrupt, or from a newer version of the game) is copied to `idle-hoard.save.unreadable` before a new game starts, so it's never lost.

Players can export a save as text (or a file) from **Settings and save** and import it again.

## Adding content

All game content is data in `src/game/data.ts`:

- `WORKERS` – kobold types: income, cost, which dragon stage unlocks them, which sprite, and their visual job (`haul` between tunnel and hoard, or `station` working in place).
- `UPGRADES` – multipliers for one worker or all income, with requirements.
- `DRAGON_STAGES` – egg, wyrmling, young, adult: the lifetime copper needed, the sprite, and the message shown.
- `HOARD_SIZE_THRESHOLDS` – when the coin pile picture grows.

## Swapping in your own art

Sprites are PNG sprite sheets in `src/assets/art/`, described in `src/render/manifest.ts`.

A sheet is a grid of equal-sized frames: **each animation is one row, frames go left to right**. For example the kobold sheets are 12×12 frames with rows `walk` (4 frames), `carry` (4) and `work` (4).

To replace a sprite:

1. Draw your sheet with the same layout and save it over the file in `src/assets/art/` (same name).
2. If your frame size, frame count, row order or speed is different, edit that sprite's entry in `src/render/manifest.ts` (`frameW`, `frameH`, and each animation's `row`, `frames`, `fps`).
3. Run `npm run dev` and look. A missing or misnamed file shows as a magenta box.

Notes:

- The scene is 256×144 pixels; art is drawn at 1:1 and scaled up, so draw at that scale.
- Kobolds face **right** in the sheet; they're flipped when walking back.
- The hoard sheet is one row of 6 frames, smallest pile to biggest. The pile shapes in `pileShape` in `src/render/scene.ts` decide where the dragon sits and where kobolds stop; adjust them if your pile is a different shape.
- Keep `fps` low. Anything above 8 is clamped by the 8-steps-a-second scene clock anyway.
- `npm run art:placeholder` regenerates the placeholder art and **overwrites** these files, so don't run it after adding real art.

## Deploying

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main`. One-time setup: in the repo go to **Settings > Pages > Build and deployment** and set **Source** to **GitHub Actions**.

`npm run build:single` makes `dist-single/index.html`, the whole game in one file, handy for sharing a quick preview.

## Later: Android and save sync

Not built yet, but the code is set up so neither needs a rewrite:

- **Android:** the layout stacks to one column on a portrait phone, buttons are touch-sized, and confirmations are built into the buttons (no browser dialogs, which some webviews block). Tauri 2 can build the same `dist/` for Android.
- **Sync:** a save is one plain JSON document with a version and a `savedAt` timestamp, and income is computed from timestamps rather than counted ticks, so two devices can be reconciled by keeping the newer save (or merging by `totalEarned`). Storage already goes through `KeyValueStore` in `src/game/save.ts`, so a synced store can be swapped in there.

## Project layout

```
src/
  game/       data.ts (content), state.ts, economy.ts (tick, costs), save.ts (versioned saves)
  render/     manifest.ts (sprite sheets), scene.ts (what to draw), renderer.ts (canvas + scheduling)
  ui/         hud.ts (side panel), format.ts
  assets/art/ sprite sheets
scripts/      gen-placeholder-art.mjs
tests/        vitest unit tests
```

All paths are relative (`base: './'`) and storage goes through a small `KeyValueStore` interface, so a Tauri desktop wrapper can load `dist/` as is and swap `localStorage` for file storage later.

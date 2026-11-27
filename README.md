# Idle Hoard

A quiet idle game about a dragon's hoard, made to sit open on a side screen.

An ambitious kobold finds a dragon egg in the dark and tries to hatch it by burying it in copper. Kobolds wander in, you put them to work, dig the cave's rooms bigger, and the egg hatches into a wyrmling that keeps growing as the hoard does. There's no clicking needed beyond moving kobolds, choosing what to dig and buying upgrades.

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

1. Start a new game (Settings and save > Start over). Name a Chief, and they should start hauling copper to the egg. Kobolds arrive until the den's beds are full.
2. Move kobolds with − and +, with the 1 / 5 / 20 / All switch. Put some on digging and check the room's bar fills, and that a room past size 2 stalls without wood (the woodcutter row should say so).
3. Close the tab, wait a few minutes, reopen. A "while you were away" note should credit the time.
4. Switch to another tab and back. Nothing should run while hidden (with `?debug`, the draw count stays still).
5. Settings > Copy save, Start over, paste it back and Load pasted save. Progress should return.

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

Version 2 replaced the job ladder with crews and rooms. A version 1 save starts the warren over but keeps the Chief, the chronicle, the oddities shelf and the settings.

Before a migrated save is used, the original text is copied to `idle-hoard.save.backup`. A save that can't be read at all (corrupt, or from a newer version of the game) is copied to `idle-hoard.save.unreadable` before a new game starts, so it's never lost.

Players can export a save as text (or a file) from **Settings and save** and import it again.

## The Chief

A new game starts by naming the Chief, the kobold who found the egg. Their stats (Cunning, Voice, Nerve) always add up to the same total and come with one quirk, so a reroll changes direction, not strength. The Chief hauls copper alone until the egg hatches, then stands by the hoard giving orders. There's no skill tree: the Chief grows through what happens to them. Stats and quirks are data in `src/game/chief.ts`.

The chronicle under the cave scene is a short story log. Silly happenings (`src/game/happenings.ts`) turn up about every 10 minutes while the game is open, and once after a long absence. Kobolds always come out of them fine, and some bring a little copper.

## Kobolds, jobs and rooms

Nobody is hired. Kobolds wander in on their own, drawn by the hoard's **appeal**: the dragon, the size of the hoard room, the displays in it and the oddities on the shelf. Copper held doesn't count. Every kobold needs a bed, so the **den** sets how many can stay.

Jobs are assignments, not a ladder. Newcomers go to the job picked under Idle (Scavenger by default). The − and + buttons move kobolds between Idle and any job, 1, 5, 20 or all at a time. A crew gets better the longer it works together (up to +30%), and newcomers water that down, so big reshuffles cost a little.

A new game knows copper (in the hoard room), mushroom wood and stone (sharing the storehouse evenly, so one can never crowd out another). Research uncovers iron and meat, which take their own share. When a room is full, the extra is lost until it's dug bigger. Diggers dig one room at a time, picked with **Dig here**, and a room holds a little more with every bit of digging. Whole sizes only mark where a dig starts needing supports: wood from size 3, stone from size 6, iron from size 10. A dig with no supplies stalls, and the job rows say what's short and roughly how many kobolds would fix it.

## Research and named kobolds

Research is the one unlock track (`src/game/research.ts`). Researchers work on one project at a time; finishing one moves on to the cheapest next. Projects open iron and miners, the pasture and herders, goats and beetles, the alchemist, and a few straight bonuses. Research goes wrong more often than it should: harmless explosions that sometimes leave an oddity, extra research or a bit of free digging.

A crowd kobold gets a name when something memorable happens to them: a research mishap, many of the happenings, or being summoned by the dragon (`src/game/kobolds.ts`). Named kobolds wear a hat in the cave, love one job and hate another, collect traits, gifts and a history, and lift the crew they join. After four experiences one can be made a lieutenant (one slot plus one per dragon stage), which lifts their crew by 15%. Nothing is ever lost for not checking in.

## The dragon

After hatching, the dragon eats meat from the pasture (`src/game/dragon.ts`). Fed, it gives +10% to everything; fed what it craves, +25%. Cravings change every two days, hinted about a day ahead, and switching the herd takes half an hour to settle. Every few hours it asks for something, or asks to speak with a kobold, who comes back with a gift. Ignored requests just fade.

It grows by molting, not from copper: each stage needs a bigger lair, displays in the hoard room, some granted requests and time spent fed. The shed skin goes on the oddities shelf and the dragon gets a trait from what it ate most. The alchemist turns plentiful things into scarce ones at a steep loss, for patching a shortfall.

The coin pile in the cave shows the copper you hold right now, so it shrinks when you spend.

## Oddities

Some happenings leave something on the oddities shelf (`src/game/oddities.ts`): the Kogoat, a growing pile of broken lanterns, a hat far too big. Only oddities you've found are listed. A few give a tiny bonus.

## Adding content

All game content is data in `src/game/data.ts`:

- `RESOURCES` – what can be held and which room holds it.
- `JOBS` – what each job makes (or digs) per kobold, which sprite, and how they move (`haul` between tunnel and hoard, or `station` working in place).
- `ROOMS` and `DIG` – what each room holds and how it grows, how much work each size takes, and which supports big digs use.
- `UPGRADES` – tools (multipliers for one job or everything) and hoard room displays (appeal), with costs in any resources.
- `DRAGON_STAGES` – egg, wyrmling, young, adult: the copper to hatch, the sprite, and the message shown. Molting conditions, diet and requests are in `src/game/dragon.ts`.
- `RECIPES` – what the alchemist can make, and at what loss.
- `HOARD_SIZE_THRESHOLDS` – how much copper held makes the coin pile picture grow.
- `ATTRACTION` – how much appeal the hoard room and oddities add, and how appeal turns into arrival time.
- `CREW` – the crew experience bonus.

## Swapping in your own art

Sprites are PNG sprite sheets in `src/assets/art/`, described in `src/render/manifest.ts`.

A sheet is a grid of equal-sized frames: **each animation is one row, frames go left to right**. For example the kobold sheets (one per job, plus idle and chief) are 12×12 frames with rows `walk` (4 frames), `carry` (4) and `work` (4).

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
  game/       data.ts (content), chief.ts (stats, quirks), research.ts, kobolds.ts (named kobolds),
              dragon.ts (diet, requests, molting), happenings.ts, oddities.ts,
              state.ts, economy.ts (production, rooms, digging, crews, arrivals), save.ts (versioned saves)
  render/     manifest.ts (sprite sheets), scene.ts (what to draw), renderer.ts (canvas + scheduling)
  ui/         hud.ts (stores, kobolds, rooms, upgrades), dragon-view.ts, research-view.ts, named-view.ts, chief-panel.ts, chronicle.ts, oddities-view.ts, format.ts
  assets/art/ sprite sheets
scripts/      gen-placeholder-art.mjs
tests/        vitest unit tests
```

All paths are relative (`base: './'`) and storage goes through a small `KeyValueStore` interface, so a Tauri desktop wrapper can load `dist/` as is and swap `localStorage` for file storage later.

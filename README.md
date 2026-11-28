# Idle Hoard

A quiet idle game about a dragon's hoard, made to sit open on a side screen.

An ambitious kobold finds a dragon egg in the dark and tries to hatch it by burying it in copper. Kobolds wander in, you put them to work, dig the cave's rooms bigger, and the egg hatches into a wyrmling that refines the hoard into silver and gold as it grows. Precious metals are only ever hoarded, never spent. There's no clicking needed beyond moving kobolds and making the odd choice. A line under the dragon suggests what to aim for next (it can be turned off in Settings), and coming back after a while shows a short card of what happened. Copper, the dragon and that line stay pinned at the top of the side panel; everything else is in two rows of tabs: Leadership (the Chief and named kobolds), Colonies and Oddities on top, and the work below it (Gathering, Rooms, Stores, Research, Forge), with settings and saves behind the gear by the copper. Kobolds are put to work in the tab for what they do: gatherers and herders on Gathering, diggers on each room in Rooms, researchers on Research, and blacksmiths and the alchemist on Forge, each with its own Move 1 / 5 / 20 / All buttons that appear once they have something in them, with a dot on a tab that has news. The chosen tab is remembered, and on a phone the tabs scroll sideways (`src/ui/tabs.ts`).

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
2. Move kobolds with − and +, with the 1 / 5 / 20 / All switch. Put some diggers on two rooms with their own − and + and check both grow, and that a room past size 2 stalls without wood (the woodcutter row should say so).
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

- **Adding a field or a new job:** nothing to do. `normalize` in `src/game/save.ts` fills defaults for anything missing.
- **Renaming, removing or changing the meaning of a field:** bump `SAVE_VERSION`, add `MIGRATIONS[oldVersion]` that converts an old state to the new shape, and add a test with a real old save in `tests/save.test.ts`.

Version 2 replaced the job ladder with crews and rooms. A version 1 save starts the warren over but keeps the Chief, the chronicle, the oddities shelf and the settings.

Before a migrated save is used, the original text is copied to `idle-hoard.save.backup`. A save that can't be read at all (corrupt, or from a newer version of the game) is copied to `idle-hoard.save.unreadable` before a new game starts, so it's never lost.

Players can export a save as text (or a file) from **Settings and save** and import it again.

## The Chief

A new game starts by naming the Chief, the kobold who found the egg. Their stats (Cunning, Voice, Nerve) always add up to the same total and come with one quirk, so a reroll changes direction, not strength. The Chief hauls copper alone until the egg hatches, then stands by the hoard giving orders. There's no skill tree: the Chief grows through what happens to them, up to 6 pips in a stat. Each evolution of the dragon earns a pip of your choice, every 5 kinds of oddity found makes the Chief more cunning, and a few rare happenings teach a fitting stat once. Stats and quirks are data in `src/game/chief.ts`.

The chronicle under the cave scene is a short story log. It only records things that happen, not what you just did. Silly happenings (`src/game/happenings.ts`) turn up about every 10 minutes with 10 kobolds, more often in a bigger warren (never more than every 3 minutes), and a few after a long absence. Kobolds always come out of them fine, and some bring a little copper.

## Kobolds, jobs and rooms

Nobody is hired. Kobolds wander in on their own, drawn by the hoard's **appeal**: the hoard's worth (each tenfold step adds the same), the dragon's size, the art in the hoard room and the oddities on the shelf. Every kobold needs a bed, so the **den** sets how many can stay.

Jobs are assignments, not a ladder. Newcomers go to the job picked under Idle (Scavenger by default). The − and + buttons move kobolds between Idle and any job, 1, 5, 20 or all at a time. Moving kobolds costs nothing: a crew works as well the moment it is put together. A cunning Chief speeds up research (+10% per point).

Rooms are measured in cubic paces, and digging adds volume (`DIG` in `src/game/data.ts`). A pace takes 10 work in a tiny room and more as the room grows (10 × (1 + volume / 500)), so a big room is slow to grow: one digger adds about 300 paces an hour to a small room and about 50 to a 3,000-pace one. Each good has its own store: copper, silver and gold share the hoard room (better metals take less space for their worth), wood in the woodpile, stone in the stone yard, meat in the larder, and iron ore, bars and steel sharing the metal store evenly. A new game knows copper, wood and stone; research uncovers the rest. When a store is full, the extra is lost until it's dug bigger, except the hoard room: when it fills, the scavengers dig it bigger themselves until there's room again. Diggers are put to work from the rooms list, with − and + on each room, so several rooms can be dug at once, each at its own diggers' pace; the list is grouped into living rooms, work rooms and stores. Digging now and then turns something up (`src/game/events.ts`): a stash of copper or ore, old bones, a forgotten side cave, or a lost kobold who moves in. Small rooms need no supports; from 150 cubic paces a room needs wood, from 500 stone too, and from 1,500 iron bars, a little for every pace dug. Deeper rooms also turn things up as they're dug: stone from 150 paces, stone and iron ore from 500, more of both from 1,500, always about half what the supports cost (`DIG.yields`).

**Gathering areas and exploring** (`src/game/areas.ts`). Scavengers, woodcutters and miners work **areas**, and each area gives at most so much a second: the near tunnels 15 copper, the grove outside the hoard 6 wood, the rubble cave 6 stone. Kobolds fill the best areas first, and once every area of a kind is giving its most, more kobolds add nothing; the job row says so and suggests exploring. Better tools and research make each kobold faster, so an area fills with fewer of them. Better areas give a **mix** of things: a petrified grove gives some stone, an iron seam half iron ore, a silver lode silver, the deep vein mithril now and then, the old battlefield scrap steel and the odd weapon for the shelf, the drowned treasury silver and gold. Anything the warren doesn't know yet (iron ore before ore sniffing, silver before the dragon hatches) comes out as the plain thing instead. **Scouts**, on the Gathering tab, put exploring points into whatever they're told to look for (woodland, stone, copper, or monsters once monster tracking is known), eating a little meat as provisions once there's a larder, or going at half pace without. Each find costs four times the last of its kind, and the better areas only turn up once the dragon is bigger or a room has been dug deep. A new game knows only scavenging and scouting: the first woodland find (the grove) opens woodcutters, the first stone find (the rubble cave) opens miners, and the first hunting ground opens hunters. A named scout gets the story, and sometimes the place is named after them. Once ore sniffing is known, the next stone find always has iron in it; seam reading and deep seams make every area's ore part half as big again, then twice as big. When the stone yard is full, iron-bearing areas give ore only, at half pace. Old saves get the plain areas, an iron seam if they sniff ore, the hunting grounds they could already reach, and enough more (or some room in "the old workings") that nothing they made before drops. (Quarriers were folded into miners; old saves move them over.)

**Fewer kobolds** (`src/game/losses.ts`). Scouting is dangerous: about one scout in the crowd is lost for every 10 hours of scouting each, so a team of 10 loses about one an hour. Hunters are lost about once per 100 working hours, and miners only in the deep workings, rarely. Ropes and lanterns (research) halve the scouts' and deep miners' losses, hide armor halves the hunters', and better tools from the forge make everyone safer. Each loss gets a line in the chronicle and a scratch on the **memorial wall** on the oddities shelf, and the "while you were away" card says how many were lost and what the scouts found. **Named kobolds never die**: on dangerous work they're only badly hurt, which goes in their story, and they rest by the hoard for four hours. Idle kobolds with nothing to do for a day start to wander off, slowly, and the Idle row warns first. Newcomers are never sent scouting on their own, so losses only come out of the team you set. Nobody is ever hurt in the lab.

Diggers, miners and, now and then, scavengers turn up **rare finds** while they work (`src/game/finds.ts`): extra ore or stone, silver and gold nuggets, fossils, dwarf-made tools, **gems** (quartz up to a star diamond; they add their worth to the hoard and the first of each kind goes on the shelf), and the rare metals **mithril** and **adamant**, which open research for two tool tiers above steel. Very rare finds need a room of at least 1,500 paces. Fitting talents (Seam-finder, Stone-reader...) and the Lucky trait double the odds of the better finds, a lieutenant shares a little luck with the crew, and gem lore makes them 50% likelier for everyone. Mithril only turns up once the miners have found the deep seams. Only uncommon finds and better make the chronicle. The big number at the top is the hoard's whole worth (copper, silver, gold and gems), with the metals listed under it. Rooms stop at 4,000 paces until deep delving is researched. A dig with no supplies stalls, and the job rows say what's short and roughly how many kobolds would fix it.

## The forge

Smithing opens the forge (`src/game/forge.ts`). Blacksmiths do forge work, split evenly between the forge's anvils (one, then more through research), and each anvil takes one of three orders: Tools, Smelt iron bars, or Make steel. Tools come in stone, iron, steel, mithril and adamant tiers, and the forge only makes the best tier it knows. Every tool goes on one shared **rack** that all jobs take from, and a Tools order keeps going after everyone is equipped, as long as there's metal and wood, so spares pile up without limit. The best tier is handed out first, shared evenly between jobs by how many kobolds each has without, unless one job is starred in the Forge tab's **Tools** table, which puts it first in line. Named kobolds get their job's best tools before the crew, and anyone left over works bare-handed. Tools in use wear out after about a week, and a spare takes over at once; spares don't wear. Job rows show the tier after the rate ("· steel tools, 4 without"). Old saves put every job's tools on the rack, and an anvil that made tools for one job now makes Tools with that job starred. The forge room's size caps how many blacksmiths can work.

**Personal gear** (`src/game/gear.ts`). A named kobold has three slots: a **tool**, **armor** and a **trinket**. They start empty and turn up as experiences, the first in a day or two and all three in about a week: a pick found on the job, a coat from the dragon, a stone kept from the first trip into a new area, a hat that took a blow meant for them, a pick that drove off a cave bear. A personal tool beats the rack's and follows its owner to any job (a pick for a miner, a lantern for a scout), and its owner leaves the rack tool for the crew. Armor turns some blows aside on dangerous work, and a trinket brings luck to finds and lifts the crew a little. The **Upgrade** button on each slot puts the piece in the forge's **Commissions** queue. An anvil set to Commissions works through it: each mark (✦, up to three) makes the piece 5% better, and after three marks the next one moves it up a tier. A steel-or-better piece with three marks is a masterwork and gets a name. With nothing commissioned, a Commissions anvil makes tools. When a named kobold puts their gear down to become an artisan, named pieces go on the **heirloom** shelf.

## Art

Artistry research lets an experienced named kobold (four experiences) put down their tools and become an artisan (`src/game/art.ts`). About every 10 hours they finish a signed piece: an iron statue, a stone carving or a mushroom-wood totem, using materials, and best in the material of the job they love. Pieces go on show in the hoard room and add appeal. The room's size limits how many fit; when it's full, a better piece replaces the weakest and a worse one goes in a cupboard.

## Research and named kobolds

Research is the one unlock track (`src/game/research.ts`). Researchers work on one project at a time; finishing one moves on to the cheapest next. Projects open iron and miners, the pasture and herders, goats and beetles, the alchemist, and a few straight bonuses. Research goes wrong more often than it should: harmless explosions that sometimes leave an oddity, extra research or a bit of free digging.

A crowd kobold gets a name when something memorable happens to them: a research mishap, many of the happenings, a find while digging, finding a knack for their job, or being summoned by the dragon (`src/game/kobolds.ts`). A **talent** (a knack found on the job, or a lasting quirk from a research mishap) makes them better at one job, and bonuses stack: a kobold three times as good as the crowd at their job earns an epithet, like the kobold who digs like a dragon. The warren keeps about one named kobold for every ten kobolds (at least three). Past that, those events give an experience (or the talent) to a named kobold already on the job instead of naming someone new, so the named ones build real stories. Each card shows the kobold's total modifier at their job and what it's made of, how close they are to an epithet, and the job picker shows their total at every job. Named kobolds wear a hat in the cave, love one job and hate another, collect traits, gifts and a history, and lift the crew they join. After four experiences one can be made a lieutenant (one slot plus one per dragon stage), which lifts their crew by 15%. Nothing is ever lost for not checking in.

Once the dragon hatches, a named kobold with four experiences can leave with five kobolds to found a **colony** (`src/game/colonies.ts`). Colonies run themselves: they grow slowly, send tribute to the hoard, and keep a short history of their own, shown in the Colonies panel. The founder's story carries on there.

**Founder traits** (`src/game/founders.ts`). Every named kobold has three small traits, from very poor to remarkable: **Pull** (how many settlers go with them), **Green thumb** (how fast the colony grows) and **Head for trade** (how much tribute it sends). They're fixed when the kobold is named, mostly ordinary, and nudged up by their story: lieutenants pull more, a fine trinket helps too, a herding or digging talent gives a green thumb, and gifts give a head for trade. About one in five has a **knack** the colony keeps: a mining colony sends stone and ore, a shrine colony sends mana, a stubborn one grows slowly but never stops, and a market town sends a third more tribute. The traits show on the card once the kobold has two experiences, and the colony button says what their colony would start with. Heirlooms the colony takes add a little to its tribute.

## The dragon

After hatching, the dragon eats meat from the pasture (`src/game/dragon.ts`). Fed, it gives +10% to everything; fed what it craves, +25%. Cravings change every two days, hinted about a day ahead, and switching the herd takes half an hour to settle. Every few hours it asks for something, or asks to speak with a kobold, who comes back with a gift. Ignored requests just fade. A granted request makes it owe you a **favor** (up to 3): ask, and it helps one job work twice as fast for an hour, such as dragon breath on the forge or clawing out the rooms. Sometimes it leaves a shed scale for the shelf too. Now and then, while content, it tells one of the named kobolds a story, which counts as an experience.

The egg hatches once the hoard is worth enough, which copper alone can reach. After that the dragon has a **size**, separate from its stage: it sleeps on its hoard in the hoard room and grows into up to half of it while fed, up to a limit for each stage. The space it takes is space the hoard can't use, so a growing dragon means digging the hoard room bigger. While fed and content it eats copper and sheds silver, and once it's a young dragon it eats silver and sheds gold, faster the bigger it is, and twice as fast again with each evolution. Each piece is worth more than what went in, so this is how the hoard really grows.

It evolves by molting: each stage needs a bigger hoard room, a hoard worth so much, some granted requests, time spent fed and, for the second molt, art in the hoard room. The shed skin goes on the oddities shelf and the dragon gets a trait from what it ate most. The alchemist turns plentiful things into scarce ones at a steep loss, for patching a shortfall.

It has three **stats** (`dragonStat` in `dragon.ts`). Each stage gives a base, and monster meat trains each one on top, up to a cap that grows with every molt. **Might** decides how strong a place it dares to raid, **Fire** brings back more loot and heats the forge, and **Presence** draws kobolds to the hoard and more of them home from raids.

**Hunters** (`src/game/hunting.ts`, opened by the scouts' first hunting ground) work the **hunting grounds** found so far, best first, each up to so many kills an hour: the bear caves (cave bears train Might), the ember pits (salamanders, Fire) and the glow pools (glow-eels, Presence), then the deep warrens (all three, bigger, more meat), the basilisk's maze (an adult dragon and a deep room), the wyvern cliffs (an elder dragon) and the elder deeps (an ancient dragon; its meat trains all three stats). Each kill brings back a few bites of monster meat and some ordinary meat for the larder. The dragon takes a bite about every ten minutes while it's home and content, wild meat first. After 25 of a kind, the researchers can work out how to keep it in the pasture: herders raising it put by farmed meat, which trains less but never runs out.

From the young dragon on, it goes **raiding** by itself about twice a day (`src/game/raids.ts`), to the richest place its Might allows: a farmstead, a village, a town, a dwarf hold, a city, or a wizard's tower (which needs Fire too). It's gone a few hours, eats and asks for nothing meanwhile, and comes back with copper, silver, gold, gems, sometimes mithril or adamant, kobolds who followed it home (if there are beds), and now and then a lieutenant who rode along and is a Dragon-rider from then on.

**Shamans** (`src/game/magic.ts`, opened by bone-reading, assigned from the Research tab) draw **mana** out of monster bones from the hunters and **dragon dust** ground from its shed scales and skins (dust is richer and used first). Mana, up to 200, is spent on **rituals** on the Leadership tab: *Bless the dragon* (its stats count 25% more for its next raid), *Stone-song* (digging twice as fast for an hour), *Read the bones* (for a day, the dragon card shows its next craving as soon as it's decided, and what the next raid should bring back) and *Lucky charm* (the next 3 finds are at least uncommon). From the elder dragon on, it now and then casts a spell of its own: blue fire for the shamans, copper breathed into gold, and at the ancient stage a call that draws kobolds in, or a gem it dreamed into being.

There are five stages after the egg: wyrmling, young, adult, elder and ancient. Its tastes grow with it: later molts want silver, then gold, then several kinds of gem, and the last wants a ruby or a star diamond and a raid on a city.

The coin pile in the cave shows the copper you hold right now, so it shrinks as the dragon refines it. While the dragon is away raiding, the pile sits unguarded.

## Oddities

Some happenings leave something on the oddities shelf (`src/game/oddities.ts`): the Kogoat, a growing pile of broken lanterns, a hat far too big. Only oddities you've found are listed. A few give a tiny bonus.

## Adding content

All game content is data in `src/game/data.ts`:

- `RESOURCES` – what can be held and which room holds it.
- `JOBS` – what each job makes (or digs) per kobold, which sprite, and how they move (`haul` between tunnel and hoard, or `station` working in place).
- `ROOMS` and `DIG` – what each room holds and how it grows, how much work each size takes, and which supports big digs use.
- `DRAGON_STAGES` – egg, wyrmling, young, adult: the hoard worth to hatch, the sprite, and the message shown. Molting conditions, diet and requests are in `src/game/dragon.ts`.
- `RECIPES` – what the alchemist can make, and at what loss.
- `HOARD_SIZE_THRESHOLDS` – how much the hoard is worth for the coin pile picture to grow. Silver and gold coins show on it once they're a real part of the hoard.
- `ATTRACTION` – how much appeal the hoard's worth, the dragon's size and oddities add, and how appeal turns into arrival time.

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
  game/       data.ts (content), chief.ts (stats, quirks), areas.ts (gathering areas, exploring), research.ts, kobolds.ts (named kobolds), forge.ts, gear.ts (personal gear), founders.ts, art.ts, events.ts (digging finds, talents, epithets), colonies.ts, goals.ts,
              dragon.ts (diet, requests, stats, size, refining, molting), hunting.ts, raids.ts, magic.ts, finds.ts, happenings.ts, oddities.ts,
              state.ts, economy.ts (production, rooms, digging, crews, arrivals), save.ts (versioned saves)
  render/     manifest.ts (sprite sheets), scene.ts (what to draw), renderer.ts (canvas + scheduling)
  ui/         tabs.ts, hud.ts (stores, kobolds, rooms), explore-view.ts, art-view.ts, colonies-view.ts, dragon-view.ts, research-view.ts, forge-view.ts, named-view.ts, rituals-view.ts, chief-panel.ts, chronicle.ts, oddities-view.ts, format.ts
  assets/art/ sprite sheets
scripts/      gen-placeholder-art.mjs
tests/        vitest unit tests
```

All paths are relative (`base: './'`) and storage goes through a small `KeyValueStore` interface, so a Tauri desktop wrapper can load `dist/` as is and swap `localStorage` for file storage later.

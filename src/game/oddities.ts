// The oddities shelf: things happenings leave behind. Only found ones are shown.

export interface OddityDef {
  id: string;
  name: string;
  /** Shown on the shelf. {n} becomes how many you have. */
  description: string;
  /** Stacking oddities keep counting up; others are found once. */
  stacks: boolean;
  /** A tiny, silly bonus to everything made, if any (1.02 = +2%). */
  incomeMult?: number;
}

export const ODDITIES: OddityDef[] = [
  { id: 'kogoat', name: 'The Kogoat', description: 'A lost goat, now an honorary kobold. Morale is up. Everything +2%.', stacks: false, incomeMult: 1.02 },
  { id: 'lanterns', name: 'Broken lanterns', description: '{n} of them. None of them light. The Chief says that is not the point.', stacks: true },
  { id: 'big-hat', name: 'A hat far too big', description: 'Worn proudly, mostly over the eyes.', stacks: false },
  { id: 'silver-spoon', name: "Someone else's silver spoon", description: 'Its owner has not come looking. Yet.', stacks: false },
  { id: 'crab-rock', name: 'Crab-shaped rock', description: 'It is not a crab. Everyone has checked.', stacks: false },
  { id: 'tiny-sword', name: 'A sword one kobold tall', description: 'Pulled from a stone. Nobody knows who left it there.', stacks: false, incomeMult: 1.01 },
  { id: 'first-scale', name: "The dragon's first scale", description: 'Shed in its sleep and polished daily.', stacks: false },
  { id: 'mystery-coin', name: 'A coin nobody has seen before', description: 'It came out of a research explosion. One side shows a dragon, the other a kobold. The kobold is winking.', stacks: false },
  { id: 'shed-scales', name: 'Shed dragon scales', description: '{n} of them, each the size of a shield. The dragon leaves them for kobolds it likes. Nobody knows what they are for yet.', stacks: true },
  { id: 'old-bones', name: 'Very old bones', description: '{n} of them, dug out of the walls. They belonged to something enormous. It is definitely gone.', stacks: true },
  { id: 'colony-gifts', name: 'Gifts from the colonies', description: '{n} carvings of the dragon, sent by the colonies. Each one is smaller than the real thing, and more serious.', stacks: true },
  { id: 'fossil', name: 'Fossils', description: '{n} stone shells and bones, from things that lived down here before anyone. One of them looks a bit like the Chief.', stacks: true },
  { id: 'first-gems', name: 'First gems', description: 'The first of each kind of gem found, kept apart from the hoard: {n} so far. The dragon checks on them.', stacks: true },
  { id: 'dwarf-tools', name: 'Dwarf-made tools', description: '{n} found in the walls, still sharp. Too good to wear out, so they hang on the wall.', stacks: true },
  { id: 'hunting-trophies', name: 'Hunting trophies', description: '{n} skulls, horns and teeth over the den door, one for every ten monsters hunted.', stacks: true },
  { id: 'raid-banners', name: 'Raid banners', description: '{n} banners torn down by the dragon and carried home. The kobolds sleep under them.', stacks: true },
  { id: 'town-bell', name: 'A town bell', description: 'The dragon carried it home from a raid. Somebody rings it whenever it wakes up.', stacks: false, incomeMult: 1.01 },
  { id: 'wizard-hat', name: "A wizard's hat", description: 'Still a little bit magic. It changes colour when the Chief lies.', stacks: false, incomeMult: 1.02 },
  { id: 'battlefield-weapons', name: 'Battlefield weapons', description: '{n} swords, axes and one very surprised-looking mace, dug out of the old battlefield. Still sharp.', stacks: true },
  { id: 'memorial-wall', name: 'The memorial wall', description: '{n} scratches on the wall by the den, one for every kobold lost scouting, hunting or deep in the mines. Nobody walks past without touching it.', stacks: true },
  { id: 'shed-skins', name: 'Shed dragon skins', description: '{n} of them, each bigger than the last. Kept rolled up beside the hoard like rugs.', stacks: true },
];

export function oddityText(def: OddityDef, count: number): string {
  return def.description.replaceAll('{n}', count.toLocaleString('en-US'));
}

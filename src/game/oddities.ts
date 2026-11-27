// The oddities shelf: things happenings leave behind. Only found ones are shown.

export interface OddityDef {
  id: string;
  name: string;
  /** Shown on the shelf. {n} becomes how many you have. */
  description: string;
  /** Stacking oddities keep counting up; others are found once. */
  stacks: boolean;
  /** A tiny, silly bonus to all income, if any (1.02 = +2%). */
  incomeMult?: number;
}

export const ODDITIES: OddityDef[] = [
  { id: 'kogoat', name: 'The Kogoat', description: 'A lost goat, now an honorary kobold. Morale is up. Income +2%.', stacks: false, incomeMult: 1.02 },
  { id: 'lanterns', name: 'Broken lanterns', description: '{n} of them. None of them light. The Chief says that is not the point.', stacks: true },
  { id: 'big-hat', name: 'A hat far too big', description: 'Worn proudly, mostly over the eyes.', stacks: false },
  { id: 'silver-spoon', name: "Someone else's silver spoon", description: 'Its owner has not come looking. Yet.', stacks: false },
  { id: 'crab-rock', name: 'Crab-shaped rock', description: 'It is not a crab. Everyone has checked.', stacks: false },
  { id: 'tiny-sword', name: 'A sword one kobold tall', description: 'Pulled from a stone. Nobody knows who left it there.', stacks: false, incomeMult: 1.01 },
  { id: 'first-scale', name: "The dragon's first scale", description: 'Shed in its sleep and polished daily.', stacks: false },
];

export function oddityText(def: OddityDef, count: number): string {
  return def.description.replaceAll('{n}', count.toLocaleString('en-US'));
}

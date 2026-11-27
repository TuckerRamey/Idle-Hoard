// Research: the one unlock track. Slightly crazed kobolds work out new jobs,
// rooms, resources and tricks, and things go bang more often than they should.
// Nobody is ever hurt. All content here is data, like data.ts.

import type { GameState } from './state';

export type ResearchEffect =
  | { kind: 'jobMult'; job: string; mult: number }
  | { kind: 'bedsMult'; mult: number }
  | { kind: 'globalMult'; mult: number };

export interface ResearchDef {
  id: string;
  name: string;
  description: string;
  /** Research points needed. */
  cost: number;
  requires: string[];
  minStage?: number;
  /** A direct bonus. Most research instead opens things that name it in `requires`. */
  effect?: ResearchEffect;
  /** Chronicle line when it's done. */
  doneText: string;
}

export const RESEARCH: ResearchDef[] = [
  {
    id: 'ore-sniffing',
    name: 'Ore sniffing',
    description: 'Opens iron and the miner job. Iron holds up very big rooms.',
    cost: 600,
    requires: [],
    doneText: 'The researchers learned to sniff out iron. The lab smells of rust now.',
  },
  {
    id: 'crab-wrangling',
    name: 'Crab wrangling',
    description: 'Opens the pasture, herders and meat, so the dragon can be fed. Starts with crabs.',
    cost: 900,
    requires: [],
    doneText: 'The researchers worked out how to keep crabs. Mostly by asking nicely.',
  },
  {
    id: 'bunk-beds',
    name: 'Bunk beds',
    description: 'The den holds 25% more kobolds.',
    cost: 1_500,
    requires: [],
    effect: { kind: 'bedsMult', mult: 1.25 },
    doneText: 'Bunk beds! Everyone wants the top one.',
  },
  {
    id: 'bouncy-helmets',
    name: 'Bouncy helmets',
    description: 'Researchers worry less about explosions. Researchers +25%.',
    cost: 1_500,
    requires: [],
    effect: { kind: 'jobMult', job: 'researcher', mult: 1.25 },
    doneText: 'Bouncy helmets for the lab. The next explosion was mostly fun.',
  },
  {
    id: 'echo-maps',
    name: 'Echo maps',
    description: 'Diggers shout at walls to hear where they are thin. Diggers +25%.',
    cost: 2_500,
    requires: ['ore-sniffing'],
    effect: { kind: 'jobMult', job: 'digger', mult: 1.25 },
    doneText: 'Echo maps work. The warren is a lot louder.',
  },
  {
    id: 'goat-herding',
    name: 'Goat herding',
    description: 'Goats can be raised in the pasture.',
    cost: 3_000,
    requires: ['crab-wrangling'],
    doneText: 'The Kogoat agreed to teach the others. Goats are now on the menu, which the Kogoat finds hurtful.',
  },
  {
    id: 'alchemy',
    name: 'Alchemy',
    description: 'Opens the alchemist: turns plentiful things into scarce ones, at a steep loss.',
    cost: 4_000,
    requires: ['ore-sniffing'],
    doneText: 'The researchers turned a rock into a slightly different rock. They are calling it alchemy.',
  },
  {
    id: 'beetle-ranching',
    name: 'Beetle ranching',
    description: 'Giant beetles can be raised in the pasture.',
    cost: 8_000,
    requires: ['goat-herding'],
    doneText: 'Giant beetles are easy to herd once they decide you are a beetle too.',
  },
  {
    id: 'kobold-arithmetic',
    name: 'Kobold arithmetic',
    description: 'Counting past twenty without taking boots off. Everything +10%.',
    cost: 15_000,
    requires: ['alchemy'],
    effect: { kind: 'globalMult', mult: 1.1 },
    doneText: 'The researchers can count past twenty now. The hoard looks bigger already.',
  },
];

export interface MishapDef {
  /** {kobold} is filled in. */
  text: string;
  /** Title a crowd kobold gets from it, e.g. "the Singed". */
  title: string;
  trait: string;
  effect?: { kind: 'research'; fraction: number } | { kind: 'dig'; work: number } | { kind: 'oddity'; id: string };
}

export const MISHAPS: MishapDef[] = [
  {
    text: '{kobold} mixed two jars that should not be mixed. The lab is now a crater, which the diggers say counts as digging.',
    title: 'the Crater-maker',
    trait: 'Eyebrows still growing back',
    effect: { kind: 'dig', work: 80 },
  },
  {
    text: '{kobold} tried to teach a rock to glow. It exploded instead, very politely, and the notes are much better for it.',
    title: 'the Singed',
    trait: 'Fireproof whiskers',
    effect: { kind: 'research', fraction: 0.2 },
  },
  {
    text: '{kobold} blew themselves clean out of the lab and landed in the hoard holding a coin nobody has seen before.',
    title: 'the Airborne',
    trait: 'Not afraid of heights any more',
    effect: { kind: 'oddity', id: 'mystery-coin' },
  },
  {
    text: "{kobold}'s experiment fizzed, popped, and left the lab smelling of toast for a week. Morale is up.",
    title: 'Toastmaker',
    trait: 'Smells faintly of toast',
  },
  {
    text: '{kobold} sneezed into a bubbling pot. There was a flash, a bang and a lot of purple smoke. They wrote down whatever just happened.',
    title: 'the Purple',
    trait: 'Slightly purple',
    effect: { kind: 'research', fraction: 0.15 },
  },
  {
    text: '{kobold} tested a new kind of lantern. It works, in the sense that it is now on the ceiling.',
    title: 'Lamplighter',
    trait: 'Sees fine in the dark',
    effect: { kind: 'oddity', id: 'lanterns' },
  },
];

/** On average, one mishap per researcher per this many hours of work. */
export const MISHAP_HOURS = 6;

export const researchDef = (id: string) => RESEARCH.find((r) => r.id === id);

export function researched(state: GameState, id: string): boolean {
  return state.research.done.includes(id);
}

/** Is something that names this research (or nothing) open yet? */
export function opened(state: GameState, requires: string | undefined): boolean {
  return !requires || researched(state, requires);
}

export function canResearch(state: GameState, def: ResearchDef): boolean {
  return !researched(state, def.id) && def.requires.every((r) => researched(state, r)) && state.stage >= (def.minStage ?? 0);
}

export function availableResearch(state: GameState): ResearchDef[] {
  return RESEARCH.filter((r) => canResearch(state, r));
}

export function chooseResearch(state: GameState, id: string | null): boolean {
  if (id === null) {
    state.research.current = null;
    return true;
  }
  const def = researchDef(id);
  if (!def || !canResearch(state, def)) return false;
  if (state.research.current !== id) state.research.current = id;
  return true;
}

/** Add research points. Returns the projects finished. Points carry over to the next pick. */
export function addResearch(state: GameState, points: number): ResearchDef[] {
  const done: ResearchDef[] = [];
  if (!(points > 0)) return done;
  state.research.progress += points;
  for (let guard = 0; guard < 20; guard++) {
    const cur = state.research.current ? researchDef(state.research.current) : undefined;
    if (!cur || !canResearch(state, cur) || state.research.progress < cur.cost) break;
    state.research.progress -= cur.cost;
    state.research.done.push(cur.id);
    done.push(cur);
    // carry on with the next thing available, cheapest first
    state.research.current = availableResearch(state).sort((a, b) => a.cost - b.cost)[0]?.id ?? null;
  }
  return done;
}

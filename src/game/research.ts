// Research: the one unlock track. Slightly crazed kobolds work out new jobs,
// rooms, resources and tricks, and things go bang more often than they should.
// Nobody is ever hurt. All content here is data, like data.ts.
//
// Each project keeps its own progress. Most also use up some resources, a
// little with every research point, the way digging uses supports. When the
// lab runs short, the project pauses and spare points go to the next project
// that can pay its way.

import type { ResourceId } from './data';
import type { GameState } from './state';

export type ResearchEffect =
  | { kind: 'jobMult'; job: string; mult: number }
  | { kind: 'bedsMult'; mult: number }
  | { kind: 'globalMult'; mult: number }
  /** Dig supports cost this much (0.75 = 25% less). */
  | { kind: 'supportsMult'; mult: number }
  /** How much of one good its store holds. */
  | { kind: 'storeMult'; resource: ResourceId; mult: number }
  /** An alchemy recipe's ratio becomes this. */
  | { kind: 'recipeRatio'; recipe: string; ratio: number }
  /** Every alchemy ratio times this (0.75 = 25% less lost). */
  | { kind: 'alchemyMult'; mult: number }
  /** Craving hints come this many seconds ahead. */
  | { kind: 'cravingHint'; seconds: number }
  /** Mishaps happen this much as often. */
  | { kind: 'mishapRate'; mult: number }
  /** Chance a mishap lands on an already-named researcher. */
  | { kind: 'mishapNamedChance'; chance: number }
  /** Research from mishaps times this. */
  | { kind: 'mishapResearch'; mult: number }
  | { kind: 'lieutenantSlots'; add: number }
  /** More forge order slots. */
  | { kind: 'forgeSlots'; add: number }
  /** Rooms can be dug past DIG.maxPaces. */
  | { kind: 'deepDigging' }
  /** How much a named (non-lieutenant) kobold lifts their crew. */
  | { kind: 'namedLift'; bonus: number };

export interface ResearchDef {
  id: string;
  name: string;
  description: string;
  /** Research points needed. */
  cost: number;
  /** Resources used up over the whole project, a little per point. */
  resources?: Partial<Record<ResourceId, number>>;
  requires: string[];
  minStage?: number;
  /** Direct bonuses. Most research instead opens things that name it in `requires`. */
  effects?: ResearchEffect[];
  /** Chronicle line when it's done. */
  doneText: string;
}

export const RESEARCH: ResearchDef[] = [
  {
    id: 'ore-sniffing',
    name: 'Ore sniffing',
    description: 'Opens iron ore, the miner job and the metal store.',
    cost: 600,
    resources: { stone: 200 },
    requires: [],
    doneText: 'The researchers learned to sniff out iron. The lab smells of rust now.',
  },
  {
    id: 'crab-wrangling',
    name: 'Crab wrangling',
    description: 'Opens the pasture, herders, meat and the larder, so the dragon can be fed. Starts with crabs.',
    cost: 900,
    resources: { wood: 150 },
    requires: [],
    doneText: 'The researchers worked out how to keep crabs. Mostly by asking nicely.',
  },
  {
    id: 'bunk-beds',
    name: 'Bunk beds',
    description: 'The den holds 25% more kobolds.',
    cost: 1_500,
    resources: { wood: 300 },
    requires: [],
    effects: [{ kind: 'bedsMult', mult: 1.25 }],
    doneText: 'Bunk beds! Everyone wants the top one.',
  },
  {
    id: 'bouncy-helmets',
    name: 'Bouncy helmets',
    description: 'Researchers worry less about explosions. Researchers +25%.',
    cost: 1_500,
    resources: { wood: 100 },
    requires: [],
    effects: [{ kind: 'jobMult', job: 'researcher', mult: 1.25 }],
    doneText: 'Bouncy helmets for the lab. The next explosion was mostly fun.',
  },
  {
    id: 'echo-maps',
    name: 'Echo maps',
    description: 'Diggers shout at walls to hear where they are thin. Diggers +25%.',
    cost: 2_500,
    resources: { stone: 400 },
    requires: ['ore-sniffing'],
    effects: [{ kind: 'jobMult', job: 'digger', mult: 1.25 }],
    doneText: 'Echo maps work. The warren is a lot louder.',
  },
  {
    id: 'goat-herding',
    name: 'Goat herding',
    description: 'Goats can be raised in the pasture.',
    cost: 3_000,
    resources: { meat: 50 },
    requires: ['crab-wrangling'],
    doneText: 'The Kogoat agreed to teach the others. Goats are now on the menu, which the Kogoat finds hurtful.',
  },
  {
    id: 'alchemy',
    name: 'Alchemy',
    description: 'Opens the alchemist: turns plentiful things into scarce ones, at a steep loss.',
    cost: 4_000,
    resources: { ore: 50 },
    requires: ['ore-sniffing'],
    doneText: 'The researchers turned a rock into a slightly different rock. They are calling it alchemy.',
  },
  {
    id: 'beetle-ranching',
    name: 'Beetle ranching',
    description: 'Giant beetles can be raised in the pasture.',
    cost: 8_000,
    resources: { meat: 150 },
    requires: ['goat-herding'],
    doneText: 'Giant beetles are easy to herd once they decide you are a beetle too.',
  },
  {
    id: 'kobold-arithmetic',
    name: 'Kobold arithmetic',
    description: 'Counting past twenty without taking boots off. Everything +10%.',
    cost: 15_000,
    resources: { stone: 400 },
    requires: ['alchemy'],
    effects: [{ kind: 'globalMult', mult: 1.1 }],
    doneText: 'The researchers can count past twenty now. The hoard looks bigger already.',
  },
  {
    id: 'pit-props',
    name: 'Pit props',
    description: 'Cleverer bracing. Dig supports cost 25% less.',
    cost: 6_000,
    resources: { wood: 600 },
    requires: ['echo-maps'],
    effects: [{ kind: 'supportsMult', mult: 0.75 }],
    doneText: 'Pit props! The diggers lean on them, which is what they are for.',
  },
  {
    id: 'mine-carts',
    name: 'Mine carts',
    description: 'Rails and little carts. Diggers +25%, miners +25%.',
    cost: 12_000,
    resources: { bars: 80 },
    requires: ['pit-props', 'smithing'],
    effects: [
      { kind: 'jobMult', job: 'digger', mult: 1.25 },
      { kind: 'jobMult', job: 'miner', mult: 1.25 },
    ],
    doneText: 'Mine carts work. Riding them is forbidden, which has not stopped anyone.',
  },
  {
    id: 'smokehouse',
    name: 'Smokehouse',
    description: 'Smoked meat keeps. The larder holds 50% more.',
    cost: 5_000,
    resources: { wood: 400 },
    requires: ['crab-wrangling'],
    effects: [{ kind: 'storeMult', resource: 'meat', mult: 1.5 }],
    doneText: 'The smokehouse is open. Everything smells of smoked crab, including the researchers.',
  },
  {
    id: 'better-jerky',
    name: 'Better jerky',
    description: 'Mushroom jerky takes 4 wood instead of 6.',
    cost: 10_000,
    resources: { meat: 100 },
    requires: ['smokehouse', 'alchemy'],
    effects: [{ kind: 'recipeRatio', recipe: 'wood-to-meat', ratio: 4 }],
    doneText: 'The new jerky is almost meat. The dragon eats it slightly less grudgingly.',
  },
  {
    id: 'dragon-cookbook',
    name: 'Dragon cookbook',
    description: "Notes on the dragon's moods. Cravings are known 2 days ahead instead of 1.",
    cost: 18_000,
    resources: { meat: 300 },
    requires: ['beetle-ranching', 'smokehouse'],
    effects: [{ kind: 'cravingHint', seconds: 2 * 86_400 }],
    doneText: 'The dragon cookbook is finished. Most of the pages are drool-proofed.',
  },
  {
    id: 'safety-goggles',
    name: 'Safety goggles',
    description: 'Fewer mishaps, and the ones that happen are more memorable: they name new kobolds more often.',
    cost: 5_000,
    resources: { stone: 200 },
    requires: ['bouncy-helmets'],
    effects: [
      { kind: 'mishapRate', mult: 0.8 },
      { kind: 'mishapNamedChance', chance: 0.15 },
    ],
    doneText: 'Safety goggles for the lab. They are mostly worn on foreheads.',
  },
  {
    id: 'lab-notebooks',
    name: 'Lab notebooks',
    description: 'Someone writes down what just exploded. Research from mishaps is doubled.',
    cost: 10_000,
    resources: { wood: 300 },
    requires: ['safety-goggles'],
    effects: [{ kind: 'mishapResearch', mult: 2 }],
    doneText: 'Lab notebooks! Half of them are singed, but the notes are good.',
  },
  {
    id: 'transmutation-theory',
    name: 'Transmutation theory',
    description: 'Alchemy with fewer guesses. Every recipe loses 25% less.',
    cost: 30_000,
    resources: { bars: 150 },
    requires: ['alchemy', 'kobold-arithmetic', 'smithing'],
    effects: [{ kind: 'alchemyMult', mult: 0.75 }],
    doneText: 'The alchemists have a theory now. It is mostly arrows, but it works.',
  },
  {
    id: 'name-tags',
    name: 'Name tags',
    description: 'Everyone important gets a tag. One more lieutenant slot.',
    cost: 6_000,
    resources: { wood: 200 },
    requires: ['bunk-beds'],
    effects: [{ kind: 'lieutenantSlots', add: 1 }],
    doneText: 'Name tags for everyone who matters. Everyone else made their own.',
  },
  {
    id: 'storytelling',
    name: 'Storytelling',
    description: "Named kobolds' stories inspire the crowd. They lift their crew by 5% instead of 3%.",
    cost: 25_000,
    resources: { stone: 600 },
    requires: ['name-tags', 'lab-notebooks'],
    effects: [{ kind: 'namedLift', bonus: 0.05 }],
    doneText: 'Storytelling nights by the hoard. Every story gets bigger each time it is told.',
  },
  {
    id: 'smithing',
    name: 'Smithing',
    description: 'Opens the forge and blacksmiths: iron bars from ore, and stone tools for every job.',
    cost: 2_000,
    resources: { stone: 300 },
    requires: ['ore-sniffing'],
    doneText: 'The researchers built a forge. They are not allowed near it any more.',
  },
  {
    id: 'ironworking',
    name: 'Ironworking',
    description: 'The forge makes iron tools instead of stone ones.',
    cost: 5_000,
    resources: { bars: 60 },
    requires: ['smithing'],
    doneText: 'Iron tools! The stone ones will be used until they crumble.',
  },
  {
    id: 'steelmaking',
    name: 'Steelmaking',
    description: 'The forge can make steel from bars, and steel tools.',
    cost: 12_000,
    resources: { bars: 200 },
    requires: ['ironworking'],
    doneText: 'Steel. It took a lot of charcoal and one singed tail, but it is very shiny.',
  },
  {
    id: 'second-anvil',
    name: 'Second anvil',
    description: 'The forge can work on two orders at once. Its work is split between them.',
    cost: 6_000,
    resources: { bars: 100 },
    requires: ['smithing'],
    effects: [{ kind: 'forgeSlots', add: 1 }],
    doneText: 'A second anvil. The forge is twice as loud.',
  },
  {
    id: 'third-anvil',
    name: 'Third anvil',
    description: 'A third order at once.',
    cost: 15_000,
    resources: { steel: 50 },
    requires: ['second-anvil', 'steelmaking'],
    effects: [{ kind: 'forgeSlots', add: 1 }],
    doneText: 'A third anvil. Nobody in the warren can hear anything now.',
  },
  {
    id: 'deep-delving',
    name: 'Deep delving',
    description: 'Iron-braced galleries. Rooms can be dug past 4,000 cubic paces.',
    cost: 20_000,
    resources: { bars: 200 },
    requires: ['mine-carts'],
    effects: [{ kind: 'deepDigging' }],
    doneText: 'Deep delving. The diggers found the bottom of the world, and dug a bit further.',
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

/** Every bonus from finished research. */
export function researchEffects(state: GameState): ResearchEffect[] {
  return RESEARCH.filter((r) => researched(state, r.id)).flatMap((r) => r.effects ?? []);
}

/** The product of every finished `mult` effect of a kind (that passes `match`). */
export function researchMult<K extends ResearchEffect['kind']>(
  state: GameState,
  kind: K,
  match: (e: Extract<ResearchEffect, { kind: K }>) => boolean = () => true,
): number {
  let m = 1;
  for (const e of researchEffects(state))
    if (e.kind === kind && 'mult' in e && match(e as Extract<ResearchEffect, { kind: K }>)) m *= e.mult;
  return m;
}

/** The last finished effect of a kind, if any. */
export function researchEffect<K extends ResearchEffect['kind']>(state: GameState, kind: K): Extract<ResearchEffect, { kind: K }> | undefined {
  let found: Extract<ResearchEffect, { kind: K }> | undefined;
  for (const e of researchEffects(state)) if (e.kind === kind) found = e as Extract<ResearchEffect, { kind: K }>;
  return found;
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
  state.research.current = id;
  return true;
}

/** Points put into a project so far. */
export function researchProgress(state: GameState, id: string): number {
  return state.research.progress[id] ?? 0;
}

function resourceEntries(def: ResearchDef): [ResourceId, number][] {
  return Object.entries(def.resources ?? {}).filter(([, n]) => (n ?? 0) > 0) as [ResourceId, number][];
}

/** How many more points a project can take right now, given the resources on hand. */
export function affordablePoints(state: GameState, def: ResearchDef): number {
  let p = def.cost - researchProgress(state, def.id);
  for (const [res, n] of resourceEntries(def)) p = Math.min(p, (state.res[res] * def.cost) / n);
  return Math.max(0, p);
}

/** The resources a project is waiting on, if it can't go on. */
export function researchShortOf(state: GameState, def: ResearchDef): ResourceId[] {
  if (affordablePoints(state, def) > 1e-6) return [];
  return resourceEntries(def)
    .filter(([res, n]) => state.res[res] < (n / def.cost) * 1e-3 + 1e-9)
    .map(([res]) => res);
}

/** Put up to `points` into a project, paying its resources. Returns the points used. */
function pour(state: GameState, def: ResearchDef, points: number): number {
  const use = Math.min(points, affordablePoints(state, def));
  if (use <= 0) return 0;
  for (const [res, n] of resourceEntries(def)) state.res[res] = Math.max(0, state.res[res] - (use * n) / def.cost);
  state.research.progress[def.id] = researchProgress(state, def.id) + use;
  return use;
}

function finished(state: GameState, def: ResearchDef): boolean {
  if (researchProgress(state, def.id) < def.cost - 1e-6) return false;
  delete state.research.progress[def.id];
  state.research.done.push(def.id);
  return true;
}

/** Where spare points go while the current project waits for resources. */
export function spillTarget(state: GameState): ResearchDef | undefined {
  const cur = state.research.current;
  return availableResearch(state)
    .filter((r) => r.id !== cur && affordablePoints(state, r) > 1e-6)
    .sort((a, b) => a.cost - researchProgress(state, a.id) - (b.cost - researchProgress(state, b.id)))[0];
}

/**
 * Add research points to the current project. If it's short of resources,
 * the rest goes to the next project that can pay its way. Points left over
 * when a project finishes are dropped. Returns the projects finished.
 */
export function addResearch(state: GameState, points: number): ResearchDef[] {
  const done: ResearchDef[] = [];
  if (!(points > 0)) return done;
  const cur = state.research.current ? researchDef(state.research.current) : undefined;
  if (!cur || !canResearch(state, cur)) return done;
  const used = pour(state, cur, points);
  if (finished(state, cur)) {
    done.push(cur);
    // carry on with the cheapest project the lab can pay for, else the cheapest
    const next = availableResearch(state).sort((a, b) => a.cost - b.cost);
    state.research.current = (next.find((r) => affordablePoints(state, r) > 1e-6) ?? next[0])?.id ?? null;
    return done;
  }
  const spare = points - used;
  const other = spare > 1e-9 ? spillTarget(state) : undefined;
  if (other) {
    pour(state, other, spare);
    if (finished(state, other)) done.push(other);
  }
  return done;
}

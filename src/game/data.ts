// All tunable game content lives here. Adding a job, room, upgrade or dragon
// stage should only need a new entry in one of these lists (plus art in
// src/render/manifest.ts if it needs a new sprite).

export type SpriteId = string;
export type ResourceId = 'copper' | 'wood' | 'stone';

export interface ResourceDef {
  id: ResourceId;
  name: string;
  /** Which room holds it: the hoard room, or a share of the storehouse. */
  store: 'hoard' | 'storehouse';
}

export const RESOURCES: ResourceDef[] = [
  { id: 'copper', name: 'Copper', store: 'hoard' },
  { id: 'wood', name: 'Mushroom wood', store: 'storehouse' },
  { id: 'stone', name: 'Stone', store: 'storehouse' },
];

/** How a job's kobolds move around the cave. Purely visual. */
export type MotionDef =
  /** Walk from the tunnel to the hoard carrying things, then walk back. */
  | { kind: 'haul'; lane: number; speed: number }
  /** Stand at a spot by the cave wall and work in place. */
  | { kind: 'station'; x: number; y: number; spacing: number };

/**
 * A job. Jobs are assignments, not a ladder: any kobold can be moved to any
 * job at any time. A crew gets better the longer it works together.
 */
export interface JobDef {
  id: string;
  name: string;
  description: string;
  /** What each kobold makes per second, before multipliers. */
  produces?: { resource: ResourceId; rate: number };
  /** Dig work each kobold does per second, before multipliers. */
  digs?: number;
  sprite: SpriteId;
  motion: MotionDef;
  /** Chronicle line the first time anyone works this job. {chief} becomes the Chief's name. */
  firstText: string;
}

export const JOBS: JobDef[] = [
  {
    id: 'scavenger',
    name: 'Scavenger',
    description: 'Picks copper out of the tunnels.',
    produces: { resource: 'copper', rate: 1 },
    sprite: 'kobold-scavenger',
    motion: { kind: 'haul', lane: 0, speed: 18 },
    firstText: 'A kobold wandered in, drawn by the glitter. {chief} handed them a sack before they could leave.',
  },
  {
    id: 'woodcutter',
    name: 'Woodcutter',
    description: 'Fells giant cave mushrooms for timber.',
    produces: { resource: 'wood', rate: 0.5 },
    sprite: 'kobold-woodcutter',
    motion: { kind: 'haul', lane: 1, speed: 13 },
    firstText: 'The first woodcutter came back with a mushroom twice their size and a very proud face.',
  },
  {
    id: 'quarrier',
    name: 'Quarrier',
    description: 'Cuts stone blocks out of the cave walls.',
    produces: { resource: 'stone', rate: 0.5 },
    sprite: 'kobold-quarrier',
    motion: { kind: 'station', x: 40, y: 98, spacing: 9 },
    firstText: 'The first quarrier gets a pick nearly bigger than they are. They love it.',
  },
  {
    id: 'digger',
    name: 'Digger',
    description: 'Digs rooms out bigger. Big rooms need wood and stone to hold the ceiling up.',
    digs: 1,
    sprite: 'kobold-digger',
    motion: { kind: 'station', x: 222, y: 98, spacing: 5 },
    firstText: '{chief} pointed at a wall and said "bigger". The first digger got to work.',
  },
];

/** Kobolds a newcomer can be sent to straight away; 'idle' means they wait. */
export const IDLE = 'idle';

/** A crew's bonus for working together: up to `maxBonus`, half of it after `halfHours`. */
export const CREW = { maxBonus: 0.3, halfHours: 6 };

/**
 * Rooms. Each has a size; digging makes it one size bigger. A room's size
 * sets how much it holds (copper, storehouse goods, or beds).
 */
export interface RoomDef {
  id: string;
  name: string;
  description: string;
  holds: 'copper' | 'storehouse' | 'beds';
  /** Capacity at size 1, and how it grows per size. */
  base: number;
  growth: number;
  /** Dig work to reach size 2; each size after needs DIG.growth times more. */
  digBase: number;
}

export const ROOMS: RoomDef[] = [
  {
    id: 'hoard',
    name: 'Hoard room',
    description: 'Where the copper and the dragon live. A bigger room holds more and draws more kobolds.',
    holds: 'copper',
    base: 20_000,
    growth: 3,
    digBase: 400,
  },
  {
    id: 'storehouse',
    name: 'Storehouse',
    description: 'Wood and stone. The space is shared evenly, so one pile can never crowd out the others.',
    holds: 'storehouse',
    base: 4_000,
    growth: 2.2,
    digBase: 120,
  },
  {
    id: 'den',
    name: 'Den',
    description: 'Beds. Every kobold needs one, so the den sets how many can stay.',
    holds: 'beds',
    base: 4,
    growth: 1.5, // beds = base × size^growth
    digBase: 100,
  },
];

export const DIG = {
  /** Each size needs this many times more work than the one before. */
  growth: 2.3,
  /**
   * Small rooms need no supports. From these sizes on, each unit of dig work
   * uses this much of a resource to hold the ceiling up. Later tiers (iron
   * braces and better) arrive with research.
   */
  supports: [
    { fromSize: 3, resource: 'wood' as ResourceId, perWork: 0.5 },
    { fromSize: 6, resource: 'stone' as ResourceId, perWork: 0.5 },
  ],
};

export type UpgradeEffect =
  | { kind: 'jobMult'; job: string; mult: number }
  | { kind: 'globalMult'; mult: number }
  /** A display in the hoard room: adds appeal, which draws kobolds. */
  | { kind: 'appeal'; points: number };

export interface UpgradeDef {
  id: string;
  name: string;
  description: string;
  cost: Partial<Record<ResourceId, number>>;
  /** Shown only after these are met. */
  requires: { job?: string; count?: number; stage?: number };
  effect: UpgradeEffect;
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'bigger-sacks',
    name: 'Bigger sacks',
    description: 'Scavengers carry twice as much copper.',
    cost: { copper: 100 },
    requires: { job: 'scavenger', count: 3 },
    effect: { kind: 'jobMult', job: 'scavenger', mult: 2 },
  },
  {
    id: 'stone-axes',
    name: 'Stone axes',
    description: 'Woodcutters fell mushrooms 50% faster.',
    cost: { copper: 250, stone: 60 },
    requires: { job: 'woodcutter', count: 2 },
    effect: { kind: 'jobMult', job: 'woodcutter', mult: 1.5 },
  },
  {
    id: 'mushroom-sledges',
    name: 'Mushroom sledges',
    description: 'Quarriers drag stone 50% faster.',
    cost: { copper: 300, wood: 80 },
    requires: { job: 'quarrier', count: 2 },
    effect: { kind: 'jobMult', job: 'quarrier', mult: 1.5 },
  },
  {
    id: 'sturdy-shovels',
    name: 'Sturdy shovels',
    description: 'Diggers dig 50% faster.',
    cost: { copper: 500, wood: 60, stone: 60 },
    requires: { job: 'digger', count: 2 },
    effect: { kind: 'jobMult', job: 'digger', mult: 1.5 },
  },
  {
    id: 'shiny-tribute',
    name: 'Shiny tribute',
    description: 'Every kobold works harder to impress the dragon. Everything +50%.',
    cost: { copper: 50_000 },
    requires: { stage: 2 },
    effect: { kind: 'globalMult', mult: 1.5 },
  },
  // hoard room displays: they draw kobolds
  {
    id: 'mural',
    name: 'A mural of the Chief',
    description: 'Mostly flattering. Appeal +5.',
    cost: { copper: 300 },
    requires: {},
    effect: { kind: 'appeal', points: 5 },
  },
  {
    id: 'mushroom-garden',
    name: 'Glowing mushroom garden',
    description: 'Soft light for the hoard to sparkle in. Appeal +8.',
    cost: { copper: 600, wood: 150 },
    requires: { job: 'woodcutter', count: 1 },
    effect: { kind: 'appeal', points: 8 },
  },
  {
    id: 'egg-statue',
    name: 'Copper statue of the egg',
    description: 'Life size. The real one is unimpressed. Appeal +12.',
    cost: { copper: 3_000, stone: 200 },
    requires: { stage: 1 },
    effect: { kind: 'appeal', points: 12 },
  },
  {
    id: 'trophy-wall',
    name: 'Wall of trophies',
    description: 'Mostly lanterns. Appeal +20.',
    cost: { copper: 25_000, wood: 600, stone: 600 },
    requires: { stage: 1 },
    effect: { kind: 'appeal', points: 20 },
  },
  {
    id: 'mosaic',
    name: 'Grand coin mosaic',
    description: 'A picture of the dragon, made of the dragon’s own coins. Appeal +40.',
    cost: { copper: 400_000, stone: 3_000 },
    requires: { stage: 2 },
    effect: { kind: 'appeal', points: 40 },
  },
];

export interface DragonStageDef {
  id: string;
  name: string;
  /** Lifetime copper buried in the hoard needed to reach this stage. */
  threshold: number;
  sprite: SpriteId;
  /** Text shown when the stage is reached. */
  flavor: string;
  /** Multiplies everything the warren makes once reached. */
  incomeMult: number;
  /** How much the dragon alone draws kobolds. */
  appeal: number;
}

/** Stage 0 is the egg. Thresholds are lifetime copper buried. */
export const DRAGON_STAGES: DragonStageDef[] = [
  {
    id: 'egg',
    name: 'Egg',
    threshold: 0,
    sprite: 'egg',
    flavor: 'found a warm egg in the dark and began burying it in copper, hoping to hatch it.',
    incomeMult: 1,
    appeal: 10,
  },
  {
    id: 'wyrmling',
    name: 'Wyrmling',
    threshold: 1_000,
    sprite: 'wyrmling',
    flavor: 'The egg cracks! A wyrmling curls up on the copper. Word gets around the tunnels.',
    incomeMult: 1,
    appeal: 20,
  },
  {
    id: 'young',
    name: 'Young dragon',
    threshold: 100_000,
    sprite: 'young-dragon',
    flavor: 'The dragon has grown. Kobolds come from three caves over just to look at it.',
    incomeMult: 1.25,
    appeal: 35,
  },
  {
    id: 'adult',
    name: 'Adult dragon',
    threshold: 10_000_000,
    sprite: 'adult-dragon',
    flavor: 'A true dragon now. The whole underdark has heard of it.',
    incomeMult: 1.5,
    appeal: 60,
  },
];

/** Hoard pile size (frame in the hoard sheet) by the copper currently held. */
export const HOARD_SIZE_THRESHOLDS = [0, 50, 1_000, 20_000, 500_000, 10_000_000];

/**
 * Kobolds come to the hoard on their own, drawn by its appeal: the dragon,
 * the hoard room's size, its displays and the oddities on show. Copper held
 * doesn't count. The den's beds set how many can stay.
 */
export const ATTRACTION = {
  /** Appeal per size of the hoard room. */
  perHoardSize: 2,
  /** Appeal per kind of oddity found. */
  perOddity: 2,
  /** Seconds between arrivals = this / appeal. */
  secondsPerAppeal: 300,
  minSeconds: 3,
};

export const CONFIG = {
  /** Copper per second the Chief brings in personally (before multipliers). */
  chiefRate: 1,
  /** The longest absence that earns offline progress, in seconds. */
  offlineCapSeconds: 24 * 60 * 60,
  /** Absences longer than this show a "while you were away" note. */
  awayNoticeSeconds: 60,
};

// All tunable game content lives here. Adding a job, room, upgrade or dragon
// stage should only need a new entry in one of these lists (plus art in
// src/render/manifest.ts if it needs a new sprite).

export type SpriteId = string;
export type ResourceId = 'copper' | 'silver' | 'gold' | 'wood' | 'stone' | 'ore' | 'bars' | 'steel' | 'mithril' | 'adamant' | 'meat';

export interface ResourceDef {
  id: ResourceId;
  name: string;
  /** The room that holds it. Goods sharing a store split its space evenly; the hoard room is one shared pile. */
  store: string;
  /** How many fit in one cubic pace. */
  perPace: number;
  /** Worth in copper, for precious metals. They're never spent, only hoarded. */
  value?: number;
  /** Research that uncovers it. A new game knows only copper, wood and stone. */
  requires?: string;
  /** Dragon stage that uncovers it (the dragon makes silver, then gold). */
  minStage?: number;
  /** Only found, never made: it's known once the first one turns up. */
  foundOnly?: boolean;
}

export const RESOURCES: ResourceDef[] = [
  { id: 'copper', name: 'Copper', store: 'hoard', perPace: 1000, value: 1 },
  { id: 'silver', name: 'Silver', store: 'hoard', perPace: 2000, value: 10, minStage: 1 },
  { id: 'gold', name: 'Gold', store: 'hoard', perPace: 4000, value: 100, minStage: 2 },
  { id: 'wood', name: 'Mushroom wood', store: 'woodpile', perPace: 40 },
  { id: 'stone', name: 'Stone', store: 'stoneyard', perPace: 50 },
  { id: 'ore', name: 'Iron ore', store: 'metals', perPace: 40, requires: 'ore-sniffing' },
  { id: 'bars', name: 'Iron bars', store: 'metals', perPace: 80, requires: 'smithing' },
  { id: 'steel', name: 'Steel', store: 'metals', perPace: 80, requires: 'steelmaking' },
  { id: 'mithril', name: 'Mithril', store: 'metals', perPace: 80, foundOnly: true },
  { id: 'adamant', name: 'Adamant', store: 'metals', perPace: 80, foundOnly: true },
  { id: 'meat', name: 'Meat', store: 'larder', perPace: 30, requires: 'crab-wrangling' },
];

/** Gems: treasure on the hoard, only ever found. Each adds its worth to the hoard. */
export interface GemDef {
  id: string;
  name: string;
  /** Worth in copper. */
  value: number;
  rarity: 'common' | 'uncommon' | 'rare' | 'very rare';
}

export const GEMS: GemDef[] = [
  { id: 'quartz', name: 'Quartz', value: 50, rarity: 'common' },
  { id: 'amber', name: 'Amber', value: 80, rarity: 'common' },
  { id: 'garnet', name: 'Garnet', value: 400, rarity: 'uncommon' },
  { id: 'amethyst', name: 'Amethyst', value: 500, rarity: 'uncommon' },
  { id: 'sapphire', name: 'Sapphire', value: 3_000, rarity: 'rare' },
  { id: 'emerald', name: 'Emerald', value: 4_000, rarity: 'rare' },
  { id: 'ruby', name: 'Ruby', value: 20_000, rarity: 'very rare' },
  { id: 'star-diamond', name: 'Star diamond', value: 50_000, rarity: 'very rare' },
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
  /** Research each kobold does per second, before multipliers. */
  researches?: number;
  /** Input each kobold turns over per second with the chosen recipe. */
  converts?: number;
  /** Forge work each kobold does per second. */
  smiths?: number;
  /** Hunting work each kobold does per second, toward bringing down the chosen monster. */
  hunts?: number;
  /** Mana each kobold draws out of bones and dragon dust per second. */
  channels?: number;
  /** Exploring points each kobold puts in per second. */
  explores?: number;
  /** Works areas of this kind, and only opens once the scouts have found one. */
  area?: 'wood' | 'stone' | 'copper' | 'monsters';
  /** Research that opens this job. */
  requires?: string;
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
    produces: { resource: 'copper', rate: 0.5 },
    area: 'copper',
    sprite: 'kobold-scavenger',
    motion: { kind: 'haul', lane: 0, speed: 18 },
    firstText: 'A kobold wandered in, drawn by the glitter. {chief} handed them a sack before they could leave.',
  },
  {
    id: 'woodcutter',
    name: 'Woodcutter',
    description: 'Fells giant cave mushrooms for timber.',
    produces: { resource: 'wood', rate: 0.5 },
    area: 'wood',
    sprite: 'kobold-woodcutter',
    motion: { kind: 'haul', lane: 1, speed: 13 },
    firstText: 'The first woodcutter came back with a mushroom twice their size and a very proud face.',
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
  {
    id: 'researcher',
    name: 'Researcher',
    description: 'Slightly crazed. Works out new jobs, rooms and tricks, with the occasional small explosion.',
    researches: 0.1,
    sprite: 'kobold-researcher',
    motion: { kind: 'station', x: 200, y: 112, spacing: 9 },
    firstText: 'The first researcher set up a lab in a corner. Nobody is allowed to sit near it.',
  },
  {
    id: 'miner',
    name: 'Miner',
    description: 'Cuts stone out of the rock the scouts have found. Iron-bearing ground gives iron ore too, once the researchers can sniff it out.',
    produces: { resource: 'stone', rate: 0.5 },
    area: 'stone',
    sprite: 'kobold-miner',
    motion: { kind: 'haul', lane: 2, speed: 11 },
    firstText: 'The first miner gets a pick nearly bigger than they are. They love it.',
  },
  {
    id: 'scout',
    name: 'Scout',
    description: 'Goes off into the dark to find new places to work. Eats provisions from the larder, once there is one.',
    explores: 0.1,
    sprite: 'kobold-scout',
    motion: { kind: 'haul', lane: 0, speed: 20 },
    firstText: 'The first scout went off into the dark with a torch and a sandwich. They came back with neither, and a map.',
  },
  {
    id: 'herder',
    name: 'Herder',
    description: 'Raises animals in the pasture for the dragon to eat. The pasture sets how many herders it fits.',
    produces: { resource: 'meat', rate: 0.2 },
    requires: 'crab-wrangling',
    sprite: 'kobold-herder',
    motion: { kind: 'station', x: 104, y: 96, spacing: 7 },
    firstText: 'The first herder has named every animal. This will make dinner awkward.',
  },
  {
    id: 'hunter',
    name: 'Hunter',
    description: 'Hunts monsters on the grounds the scouts have found, best ground first. Their meat makes the dragon stronger.',
    hunts: 0.1,
    requires: 'monster-tracking',
    area: 'monsters',
    sprite: 'kobold-hunter',
    motion: { kind: 'haul', lane: 1, speed: 15 },
    firstText: 'The first hunter went off into the deep caves with a spear and a very serious face.',
  },
  {
    id: 'shaman',
    name: 'Shaman',
    description: 'Rattles bones and burns dragon dust, and draws mana out of them for rituals.',
    channels: 0.005,
    requires: 'bone-reading',
    sprite: 'kobold-shaman',
    motion: { kind: 'station', x: 186, y: 112, spacing: 8 },
    firstText: 'The first shaman painted their face with soot and started talking to a skull. It may have answered.',
  },
  {
    id: 'alchemist',
    name: 'Alchemist',
    description: 'Turns something plentiful into something scarce, wastefully. For patching a shortfall, not a main supply.',
    converts: 1,
    requires: 'alchemy',
    sprite: 'kobold-alchemist',
    motion: { kind: 'station', x: 116, y: 90, spacing: 6 },
    firstText: 'The first alchemist turned a bucket of stone into a very small lump of ore, and fainted with pride.',
  },
  {
    id: 'blacksmith',
    name: 'Blacksmith',
    description: 'Works the forge: smelts ore into bars and makes tools. The forge sets how many fit.',
    smiths: 1,
    requires: 'smithing',
    sprite: 'kobold-blacksmith',
    motion: { kind: 'station', x: 150, y: 100, spacing: 7 },
    firstText: 'The first blacksmith hit the anvil once, very hard, and decided this was the job for them.',
  },
];

/** Kobolds a newcomer can be sent to straight away; 'idle' means they wait. */
export const IDLE = 'idle';

/** A crew's bonus for working together: up to `maxBonus`, half of it after `halfHours`. */
/**
 * Rooms. Each is measured in cubic paces; digging adds volume. A room's
 * volume sets what it holds: goods (by how many fit in a pace), beds,
 * herders, smiths, or room for the dragon.
 */
export interface RoomDef {
  id: string;
  name: string;
  description: string;
  /** Goods (see ResourceDef.store), or paces per bed / herder / smith. */
  holds: 'goods' | 'beds' | 'herders' | 'smiths';
  /** For beds, herders and smiths: cubic paces each one needs. */
  pacesEach?: number;
  /** Which list it shows in. */
  group: 'living' | 'work' | 'stores';
  /** Research that opens this room. */
  requires?: string;
  /** Dragon stage needed before this room can be dug. */
  minStage?: number;
  /** Volume a new game (or a newly opened room) starts with. */
  start: number;
}

export const ROOMS: RoomDef[] = [
  {
    id: 'hoard',
    name: 'Hoard room',
    description: 'Where the dragon sleeps on its hoard. The dragon takes up room as it grows; the rest holds copper, silver and gold.',
    holds: 'goods',
    group: 'living',
    start: 100,
  },
  {
    id: 'den',
    name: 'Den',
    description: 'Beds. Every kobold needs one, so the den sets how many can stay.',
    holds: 'beds',
    pacesEach: 10,
    group: 'living',
    start: 40,
  },
  {
    id: 'pasture',
    name: 'Pasture',
    description: "A damp cave meadow for the dragon's dinner. Its size sets how many herders it fits.",
    holds: 'herders',
    pacesEach: 10,
    group: 'work',
    requires: 'crab-wrangling',
    start: 30,
  },
  {
    id: 'forge',
    name: 'Forge',
    description: 'Anvils, bellows and a lot of noise. Its size sets how many blacksmiths fit.',
    holds: 'smiths',
    pacesEach: 10,
    group: 'work',
    requires: 'smithing',
    start: 30,
  },
  {
    id: 'woodpile',
    name: 'Woodpile',
    description: 'Mushroom wood, stacked. Bulky.',
    holds: 'goods',
    group: 'stores',
    start: 50,
  },
  {
    id: 'stoneyard',
    name: 'Stone yard',
    description: 'Stone blocks in neat rows.',
    holds: 'goods',
    group: 'stores',
    start: 50,
  },
  {
    id: 'larder',
    name: 'Larder',
    description: 'Meat for the dragon, kept cool.',
    holds: 'goods',
    group: 'stores',
    requires: 'crab-wrangling',
    start: 50,
  },
  {
    id: 'metals',
    name: 'Metal store',
    description: 'Ore, bars and steel. The space is shared evenly between them.',
    holds: 'goods',
    group: 'stores',
    requires: 'ore-sniffing',
    start: 50,
  },
];

export const DIG = {
  /** Dig work per cubic pace in a tiny room... */
  workPerPace: 10,
  /** ...and it goes up by that much again for every this many cubic paces the room already has. Big rooms are slow to grow. */
  growPaces: 500,
  /**
   * Small rooms need no supports. From these volumes on, each cubic pace dug
   * uses this much of a resource to hold the ceiling up.
   */
  supports: [
    { fromPaces: 150, resource: 'wood' as ResourceId, perPace: 1 },
    { fromPaces: 500, resource: 'stone' as ResourceId, perPace: 1 },
    { fromPaces: 1_500, resource: 'bars' as ResourceId, perPace: 0.4 },
  ],
  /**
   * What digging turns up once a room is past each size: about half of what
   * that depth's supports cost, so a deep dig is cheaper but never free.
   * Each step replaces the one before.
   */
  yields: [
    { fromPaces: 150, give: { stone: 0.5 } },
    { fromPaces: 500, give: { stone: 0.5, ore: 0.5 } },
    { fromPaces: 1_500, give: { stone: 0.6, ore: 0.8 } },
  ] as { fromPaces: number; give: Partial<Record<ResourceId, number>> }[],
  /** Without deep delving, no room can be dug past this. */
  maxPaces: 4_000,
};

/** What the alchemist can make. Always a loss: that's the point. */
export interface RecipeDef {
  id: string;
  name: string;
  from: ResourceId;
  /** How many `from` make one `to`. */
  ratio: number;
  to: ResourceId;
}

export const RECIPES: RecipeDef[] = [
  { id: 'stone-to-ore', name: 'Stone into iron ore', from: 'stone', ratio: 8, to: 'ore' },
  { id: 'wood-to-meat', name: 'Mushroom jerky (the dragon eats it, grudgingly)', from: 'wood', ratio: 6, to: 'meat' },
  { id: 'wood-to-stone', name: 'Petrified mushroom', from: 'wood', ratio: 3, to: 'stone' },
];

export interface DragonStageDef {
  id: string;
  name: string;
  /**
   * Hoard value needed to reach this stage. Only hatching works this way;
   * later stages come from evolving (see MOLTS in dragon.ts).
   */
  threshold?: number;
  sprite: SpriteId;
  /** Text shown when the stage is reached. */
  flavor: string;
  /** Multiplies everything the warren makes once reached. */
  incomeMult: number;
  /** How much the dragon alone draws kobolds. */
  appeal: number;
}

/** Stage 0 is the egg. */
export const DRAGON_STAGES: DragonStageDef[] = [
  {
    id: 'egg',
    name: 'Egg',
    sprite: 'egg',
    flavor: 'found a warm egg in the dark and began burying it in copper, hoping to hatch it.',
    incomeMult: 1,
    appeal: 10,
  },
  {
    id: 'wyrmling',
    name: 'Wyrmling',
    threshold: 1_500,
    sprite: 'wyrmling',
    flavor: 'The egg cracks! A wyrmling curls up on the copper. Word gets around the tunnels.',
    incomeMult: 1,
    appeal: 20,
  },
  {
    id: 'young',
    name: 'Young dragon',
    sprite: 'young-dragon',
    flavor: 'The dragon has grown. Kobolds come from three caves over just to look at it.',
    incomeMult: 1.25,
    appeal: 35,
  },
  {
    id: 'adult',
    name: 'Adult dragon',
    sprite: 'adult-dragon',
    flavor: 'A true dragon now. The whole underdark has heard of it.',
    incomeMult: 1.5,
    appeal: 60,
  },
  {
    id: 'elder',
    name: 'Elder dragon',
    sprite: 'elder-dragon',
    flavor: 'An elder dragon. Its scales have gone dark as old wine, and kings in the surface world have started to have bad dreams.',
    incomeMult: 2,
    appeal: 100,
  },
  {
    id: 'ancient',
    name: 'Ancient dragon',
    sprite: 'ancient-dragon',
    flavor: 'An ancient dragon, bronze with age. The mountains above have a name for it now, and they say it quietly.',
    incomeMult: 3,
    appeal: 160,
  },
];

/** Hoard pile size (frame in the hoard sheet) by the copper currently held. */
export const HOARD_SIZE_THRESHOLDS = [0, 50, 1_000, 20_000, 500_000, 10_000_000];

/**
 * Kobolds come to the hoard on their own, drawn by its appeal: the dragon,
 * the hoard's worth, art on display and the oddities on show. The den's beds
 * set how many can stay.
 */
export const ATTRACTION = {
  /** Appeal per tenfold of hoard value (1,000 copper is 3 × this). */
  perValueDecade: 4,
  /** Appeal per kind of oddity found. */
  perOddity: 2,
  /** Appeal per 50 cubic paces of dragon. */
  perDragonPaces: 1 / 50,
  /** Seconds between arrivals = this / appeal. */
  secondsPerAppeal: 300,
  minSeconds: 3,
};

export const CONFIG = {
  /** Copper per second the Chief brings in personally (before multipliers). */
  chiefRate: 1,
  /** The longest absence that earns offline progress, in seconds. */
  offlineCapSeconds: 24 * 60 * 60,
  /** Absences longer than this show a "while you were away" card. */
  awayNoticeSeconds: 5 * 60,
};

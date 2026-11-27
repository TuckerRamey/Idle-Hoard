// All tunable game content lives here. Adding a worker, upgrade or dragon
// stage should only need a new entry in one of these lists (plus art in
// src/render/manifest.ts if it needs a new sprite).

export type SpriteId = string;

/** How a worker's kobolds move around the cave. Purely visual. */
export type JobDef =
  /** Walk from the tunnel to the hoard carrying coins, then walk back. */
  | { kind: 'haul'; lane: number; speed: number }
  /** Stand at a spot by the cave wall and work in place (digging etc). */
  | { kind: 'station'; x: number; y: number; spacing: number };

export interface WorkerDef {
  id: string;
  name: string;
  description: string;
  /** Copper per second for each one owned, before multipliers. */
  rate: number;
  baseCost: number;
  /** Cost multiplier per one already owned. */
  costGrowth: number;
  /** Dragon stage index needed before this worker can be hired. */
  unlockStage: number;
  sprite: SpriteId;
  job: JobDef;
  /** Chronicle line when the first one is hired. {chief} becomes the Chief's name. */
  joinText: string;
}

export type UpgradeEffect =
  | { kind: 'workerMult'; worker: string; mult: number }
  | { kind: 'globalMult'; mult: number };

export interface UpgradeDef {
  id: string;
  name: string;
  description: string;
  cost: number;
  /** Shown only after these are met. */
  requires: { worker?: string; count?: number; stage?: number };
  effect: UpgradeEffect;
}

export interface DragonStageDef {
  id: string;
  name: string;
  /** Lifetime copper buried in the hoard needed to reach this stage. */
  threshold: number;
  sprite: SpriteId;
  /** Text shown when the stage is reached. */
  flavor: string;
  /** Multiplies all income once reached (a bigger dragon draws more tribute). */
  incomeMult: number;
}

export const WORKERS: WorkerDef[] = [
  {
    id: 'scavenger',
    name: 'Kobold scavenger',
    description: 'Picks copper out of the tunnels and piles it on the hoard.',
    rate: 1,
    baseCost: 15,
    costGrowth: 1.15,
    unlockStage: 0,
    sprite: 'kobold-scavenger',
    job: { kind: 'haul', lane: 0, speed: 18 },
    joinText: '{chief} talked a scavenger into helping. They mostly argue about who carries more.',
  },
  {
    id: 'digger',
    name: 'Kobold digger',
    description: 'Chips coins and ore out of the cave walls.',
    rate: 8,
    baseCost: 150,
    costGrowth: 1.15,
    unlockStage: 1,
    sprite: 'kobold-digger',
    job: { kind: 'station', x: 44, y: 98, spacing: 9 },
    joinText: 'The first digger arrives with a pick nearly bigger than they are.',
  },
  {
    id: 'hauler',
    name: 'Kobold hauler',
    description: 'Drags whole sacks of silver up from the deep mines.',
    rate: 60,
    baseCost: 2_000,
    costGrowth: 1.15,
    unlockStage: 2,
    sprite: 'kobold-hauler',
    job: { kind: 'haul', lane: 1, speed: 12 },
    joinText: 'A hauler joins, dragging an empty sack and a lot of promises.',
  },
  {
    id: 'raider',
    name: 'Kobold raider',
    description: 'Comes back from the surface with things that were not theirs.',
    rate: 400,
    baseCost: 25_000,
    costGrowth: 1.15,
    unlockStage: 3,
    sprite: 'kobold-raider',
    job: { kind: 'haul', lane: 2, speed: 24 },
    joinText: 'A raider swears loyalty to {chief}, then pockets a coin from the hoard. Old habits.',
  },
];

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'bigger-pockets',
    name: 'Bigger pockets',
    description: 'Scavengers carry twice as much copper.',
    cost: 100,
    requires: { worker: 'scavenger', count: 5 },
    effect: { kind: 'workerMult', worker: 'scavenger', mult: 2 },
  },
  {
    id: 'iron-picks',
    name: 'Iron picks',
    description: 'Diggers dig twice as fast.',
    cost: 1_500,
    requires: { worker: 'digger', count: 5 },
    effect: { kind: 'workerMult', worker: 'digger', mult: 2 },
  },
  {
    id: 'sack-carts',
    name: 'Sack carts',
    description: 'Haulers move twice as much.',
    cost: 20_000,
    requires: { worker: 'hauler', count: 5 },
    effect: { kind: 'workerMult', worker: 'hauler', mult: 2 },
  },
  {
    id: 'shiny-tribute',
    name: 'Shiny tribute',
    description: 'Every kobold works harder to impress the dragon. All income +50%.',
    cost: 50_000,
    requires: { stage: 2 },
    effect: { kind: 'globalMult', mult: 1.5 },
  },
];

/** Stage 0 is the egg. Thresholds are lifetime copper buried. */
export const DRAGON_STAGES: DragonStageDef[] = [
  {
    id: 'egg',
    name: 'Egg',
    threshold: 0,
    sprite: 'egg',
    flavor: 'found a warm egg in the dark and began burying it in copper, hoping to hatch it.',
    incomeMult: 1,
  },
  {
    id: 'wyrmling',
    name: 'Wyrmling',
    threshold: 1_000,
    sprite: 'wyrmling',
    flavor: 'The egg cracks! A wyrmling curls up on the copper. More kobolds come to serve it.',
    incomeMult: 1,
  },
  {
    id: 'young',
    name: 'Young dragon',
    threshold: 100_000,
    sprite: 'young-dragon',
    flavor: 'The dragon has grown. Word spreads through the tunnels.',
    incomeMult: 1.25,
  },
  {
    id: 'adult',
    name: 'Adult dragon',
    threshold: 10_000_000,
    sprite: 'adult-dragon',
    flavor: 'A true dragon now. Raiders swear themselves to it.',
    incomeMult: 1.5,
  },
];

/** Hoard pile size (frame in the hoard sheet) by lifetime copper buried. */
export const HOARD_SIZE_THRESHOLDS = [0, 200, 5_000, 100_000, 2_000_000, 50_000_000];

export const CONFIG = {
  /** New games start with no hired kobolds: the Chief hauls the first copper alone. */
  startingWorkers: {} as Record<string, number>,
  /** Copper per second the Chief brings in personally (before multipliers). */
  chiefRate: 1,
  /** The longest absence that earns offline progress, in seconds. */
  offlineCapSeconds: 24 * 60 * 60,
  /** Absences longer than this show a "while you were away" note. */
  awayNoticeSeconds: 60,
};

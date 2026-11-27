// The Chief: the ambitious kobold who found the egg. Their stats, quirk and
// skills shape the whole run. All content here is data, like data.ts.

export type StatId = 'cunning' | 'voice' | 'nerve';

export interface Chief {
  name: string;
  cunning: number;
  voice: number;
  nerve: number;
  quirk: string;
}

export const STATS: { id: StatId; name: string; effect: string }[] = [
  { id: 'cunning', name: 'Cunning', effect: '+10% renown per point (skills come faster)' },
  { id: 'voice', name: 'Voice', effect: 'Kobolds cost 3% less per point' },
  { id: 'nerve', name: 'Nerve', effect: '+5% income per point' },
];

/** Every roll spends exactly this many stat points, at least 1 in each stat. */
export const STAT_POINTS = 6;

export type QuirkEffect =
  | { kind: 'workerMult'; worker: string; mult: number }
  | { kind: 'costMult'; mult: number }
  | { kind: 'renownMult'; mult: number };

export interface QuirkDef {
  id: string;
  name: string;
  description: string;
  effect: QuirkEffect;
}

/** One quirk per Chief. They are meant to be worth about the same. */
export const QUIRKS: QuirkDef[] = [
  { id: 'copper-nosed', name: 'Copper-nosed', description: 'Can smell copper through rock. Scavengers +25%.', effect: { kind: 'workerMult', worker: 'scavenger', mult: 1.25 } },
  { id: 'stonecutter', name: 'Stonecutter', description: 'Grew up in the deep mines. Diggers +25%.', effect: { kind: 'workerMult', worker: 'digger', mult: 1.25 } },
  { id: 'packmule', name: 'Packmule', description: 'Never puts a sack down. Haulers +25%.', effect: { kind: 'workerMult', worker: 'hauler', mult: 1.25 } },
  { id: 'light-fingered', name: 'Light-fingered', description: 'Things just end up in their pockets. Raiders +25%.', effect: { kind: 'workerMult', worker: 'raider', mult: 1.25 } },
  { id: 'silver-tongued', name: 'Silver-tongued', description: 'Talks kobolds into anything. Kobolds cost 8% less.', effect: { kind: 'costMult', mult: 0.92 } },
  { id: 'dragon-struck', name: 'Dragon-struck', description: 'Utterly devoted to the egg. Renown +20%.', effect: { kind: 'renownMult', mult: 1.2 } },
];

export type SkillEffect =
  | { kind: 'globalMult'; mult: number }
  | { kind: 'costMult'; mult: number }
  | { kind: 'offlineHours'; hours: number }
  /** +bonus income per `per` kobolds of the same kind. */
  | { kind: 'crewScaling'; per: number; bonus: number };

export interface SkillDef {
  id: string;
  branch: BranchId;
  name: string;
  description: string;
  cost: number;
  requires: string[];
  effect: SkillEffect;
}

export type BranchId = 'taskmaster' | 'schemer' | 'tender' | 'tinkerer';

export const BRANCHES: { id: BranchId; name: string; available: boolean }[] = [
  { id: 'taskmaster', name: 'Taskmaster', available: true },
  { id: 'schemer', name: 'Schemer', available: false },
  { id: 'tender', name: 'Dragon-tender', available: false },
  { id: 'tinkerer', name: 'Tinkerer', available: false },
];

export const SKILLS: SkillDef[] = [
  { id: 'crack-the-whip', branch: 'taskmaster', name: 'Crack the whip', description: 'All kobolds work 10% harder.', cost: 1, requires: [], effect: { kind: 'globalMult', mult: 1.1 } },
  { id: 'bulk-recruiting', branch: 'taskmaster', name: 'Bulk recruiting', description: 'Kobolds cost 10% less.', cost: 1, requires: [], effect: { kind: 'costMult', mult: 0.9 } },
  { id: 'night-shifts', branch: 'taskmaster', name: 'Night shifts', description: 'Progress while away is credited for 12 more hours.', cost: 1, requires: ['crack-the-whip'], effect: { kind: 'offlineHours', hours: 12 } },
  { id: 'foremans-eye', branch: 'taskmaster', name: "Foreman's eye", description: 'Each kind of kobold earns +1% for every 5 of that kind.', cost: 2, requires: ['bulk-recruiting'], effect: { kind: 'crewScaling', per: 5, bonus: 0.01 } },
  { id: 'tireless-warren', branch: 'taskmaster', name: 'Tireless warren', description: 'All income +25%.', cost: 2, requires: ['night-shifts'], effect: { kind: 'globalMult', mult: 1.25 } },
  { id: 'iron-rule', branch: 'taskmaster', name: 'Iron rule', description: 'All income +50%.', cost: 3, requires: ['tireless-warren', 'foremans-eye'], effect: { kind: 'globalMult', mult: 1.5 } },
];

export const KOBOLD_NAMES = [
  'Snik', 'Grisk', 'Vesk', 'Tazz', 'Mipp', 'Krag', 'Yizz', 'Durn', 'Skrit', 'Pell', 'Rakka', 'Zib', 'Ossa', 'Fenk', 'Quill', 'Brakk',
];

/** Renown needed for the first skill point; each next point needs RENOWN_STEP times more. */
export const RENOWN_BASE = 100;
export const RENOWN_STEP = 5;

/** Roll a Chief: stats always total STAT_POINTS (min 1 each) plus one quirk. */
export function rollChief(rand: () => number, name?: string): Chief {
  const pts = { cunning: 1, voice: 1, nerve: 1 };
  const ids: StatId[] = ['cunning', 'voice', 'nerve'];
  for (let i = 3; i < STAT_POINTS; i++) pts[ids[Math.floor(rand() * 3) % 3]]++;
  const quirk = QUIRKS[Math.floor(rand() * QUIRKS.length) % QUIRKS.length].id;
  return { name: name ?? KOBOLD_NAMES[Math.floor(rand() * KOBOLD_NAMES.length) % KOBOLD_NAMES.length], ...pts, quirk };
}

export function quirkOf(chief: Chief | null): QuirkDef | undefined {
  return chief ? QUIRKS.find((q) => q.id === chief.quirk) : undefined;
}

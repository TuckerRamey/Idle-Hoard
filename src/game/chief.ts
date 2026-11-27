// The Chief: the ambitious kobold who found the egg. Their stats and quirk
// shape the whole run; they grow through what happens to them, not a skill tree.
// All content here is data, like data.ts.

export type StatId = 'cunning' | 'voice' | 'nerve';

export interface Chief {
  name: string;
  cunning: number;
  voice: number;
  nerve: number;
  quirk: string;
}

export const STATS: { id: StatId; name: string; effect: string }[] = [
  { id: 'cunning', name: 'Cunning', effect: 'Crews gain experience 10% faster per point' },
  { id: 'voice', name: 'Voice', effect: 'The hoard draws kobolds 10% faster per point' },
  { id: 'nerve', name: 'Nerve', effect: 'Everything +5% per point' },
];

/** Every roll spends exactly this many stat points, at least 1 in each stat. */
export const STAT_POINTS = 6;

export type QuirkEffect =
  | { kind: 'jobMult'; job: string; mult: number }
  | { kind: 'appealMult'; mult: number }
  | { kind: 'storageMult'; mult: number };

export interface QuirkDef {
  id: string;
  name: string;
  description: string;
  effect: QuirkEffect;
}

/** One quirk per Chief. They are meant to be worth about the same. */
export const QUIRKS: QuirkDef[] = [
  { id: 'copper-nosed', name: 'Copper-nosed', description: 'Can smell copper through rock. Scavengers +25%.', effect: { kind: 'jobMult', job: 'scavenger', mult: 1.25 } },
  { id: 'stonecutter', name: 'Stonecutter', description: 'Grew up in the deep quarries. Quarriers +25%.', effect: { kind: 'jobMult', job: 'quarrier', mult: 1.25 } },
  { id: 'mushroom-sniffer', name: 'Mushroom-sniffer', description: 'Knows every mushroom by smell. Woodcutters +25%.', effect: { kind: 'jobMult', job: 'woodcutter', mult: 1.25 } },
  { id: 'tunnel-rat', name: 'Tunnel-rat', description: 'Happiest with dirt on their snout. Diggers +25%.', effect: { kind: 'jobMult', job: 'digger', mult: 1.25 } },
  { id: 'silver-tongued', name: 'Silver-tongued', description: 'Talks kobolds into anything. Kobolds arrive 25% faster.', effect: { kind: 'appealMult', mult: 1.25 } },
  { id: 'packrat', name: 'Packrat', description: 'Can fit anything anywhere. Rooms hold 25% more.', effect: { kind: 'storageMult', mult: 1.25 } },
];

/** Quirks from saves before version 2, mapped to the nearest one today. */
export const OLD_QUIRKS: Record<string, string> = {
  packmule: 'packrat',
  'light-fingered': 'tunnel-rat',
  'dragon-struck': 'mushroom-sniffer',
};

export const KOBOLD_NAMES = [
  'Snik', 'Grisk', 'Vesk', 'Tazz', 'Mipp', 'Krag', 'Yizz', 'Durn', 'Skrit', 'Pell', 'Rakka', 'Zib', 'Ossa', 'Fenk', 'Quill', 'Brakk',
];

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

// ---------- growing ----------

/** The most pips a stat can have. */
export const MAX_PIPS = 6;
/** The Chief gains a pip of your choice every this many dragon requests granted. */
export const PIP_FAVOR = 10;
/** ...and a pip of Cunning every this many kinds of oddity found. */
export const PIP_ODDITIES = 5;

export function statName(id: StatId): string {
  return STATS.find((s) => s.id === id)!.name;
}

/** Add a pip to a stat, if there's room. Returns whether it grew. */
export function raiseStat(chief: Chief | null, stat: StatId): boolean {
  if (!chief || chief[stat] >= MAX_PIPS) return false;
  chief[stat]++;
  return true;
}

/** Spend a pip the Chief has earned on a stat the player picks. */
export function spendPip(state: { chief: Chief | null; chiefMarks: { pending: number } }, stat: StatId): boolean {
  if (state.chiefMarks.pending < 1 || !raiseStat(state.chief, stat)) return false;
  state.chiefMarks.pending--;
  return true;
}

/** Can a pending pip go anywhere? */
export function pipRoom(chief: Chief | null): boolean {
  return !!chief && STATS.some((s) => chief[s.id] < MAX_PIPS);
}

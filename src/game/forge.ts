// The forge: blacksmiths smelt ore into bars, make steel, and make tools.
// Every job has its own tool. Tools come in tiers; the best go to named
// kobolds first, then the crew, and anyone left over works bare-handed.
// Tools wear out with use. When kobolds move, their tools stay with the job.

import type { ResourceId } from './data';
import { capacity, jobDef, jobOpen, jobOutput, resourceDef, resourceOpen, roomCapacity, roomDef, roomOpen, workers } from './economy';
import { namedIn } from './kobolds';
import { opened, researchEffects } from './research';
import type { GameState } from './state';
import { JOBS } from './data';

export type ToolTier = 'stone' | 'iron' | 'steel' | 'mithril' | 'adamant';

export interface TierDef {
  id: ToolTier;
  name: string;
  /** Output multiplier for the kobold using it. */
  mult: number;
  /** Forge work for one tool. */
  work: number;
  cost: Partial<Record<ResourceId, number>>;
  requires: string;
}

/** Worst first. Only the best open tier is ever made. */
export const TIERS: TierDef[] = [
  { id: 'stone', name: 'Stone', mult: 1.1, work: 20, cost: { stone: 2, wood: 1 }, requires: 'smithing' },
  { id: 'iron', name: 'Iron', mult: 1.25, work: 40, cost: { bars: 2, wood: 1 }, requires: 'ironworking' },
  { id: 'steel', name: 'Steel', mult: 1.5, work: 80, cost: { steel: 2, wood: 1 }, requires: 'steelmaking' },
  // only from finds: rare metals, worked once the researchers know how
  { id: 'mithril', name: 'Mithril', mult: 1.8, work: 120, cost: { mithril: 1, steel: 1 }, requires: 'mithril-working' },
  { id: 'adamant', name: 'Adamant', mult: 2.2, work: 200, cost: { adamant: 1, mithril: 1 }, requires: 'adamant-working' },
];

/** Each job's own tool. Never shared. */
export const TOOL_NAMES: Record<string, string> = {
  scavenger: 'sacks',
  woodcutter: 'axes',
  digger: 'shovels',
  miner: 'picks',
  researcher: 'goggles',
  herder: 'crooks',
  alchemist: 'tongs',
  blacksmith: 'hammers',
  hunter: 'spears',
};

export interface MaterialDef {
  id: 'smelt' | 'steel';
  name: string;
  makes: ResourceId;
  work: number;
  cost: Partial<Record<ResourceId, number>>;
  requires: string;
}

export const MATERIALS: MaterialDef[] = [
  { id: 'smelt', name: 'Smelt iron bars', makes: 'bars', work: 10, cost: { ore: 2, wood: 1 }, requires: 'smithing' },
  { id: 'steel', name: 'Make steel', makes: 'steel', work: 30, cost: { bars: 2, wood: 2 }, requires: 'steelmaking' },
];

export const FORGE = {
  /** A tool in use lasts about this long. */
  toolLifeSeconds: 7 * 86_400,
  baseSlots: 1,
};

/** One tool tier a job holds: whole tools, and wear on the ones in use toward losing the next. */
export interface ToolStock {
  n: number;
  wear: number;
}

export interface ForgeSlot {
  /** 'auto', 'smelt', 'steel', 'tool:<job>', or null for an empty slot. */
  order: string | null;
  progress: number;
}

// ---------- what's open ----------

export function forgeOpen(state: GameState): boolean {
  return opened(state, 'smithing');
}

/** The best tier the forge can make now, or undefined before smithing. */
export function bestTier(state: GameState): TierDef | undefined {
  return [...TIERS].reverse().find((t) => opened(state, t.requires));
}

export function forgeSlotCount(state: GameState): number {
  let n = FORGE.baseSlots;
  for (const e of researchEffects(state)) if (e.kind === 'forgeSlots') n += e.add;
  return n;
}

/** Jobs that can use tools right now. */
export function toolJobs(state: GameState): string[] {
  return JOBS.filter((j) => TOOL_NAMES[j.id] && jobOpen(state, j)).map((j) => j.id);
}

export interface OrderOption {
  id: string;
  name: string;
}

export function orderOptions(state: GameState): OrderOption[] {
  if (!forgeOpen(state)) return [];
  const tier = bestTier(state);
  const out: OrderOption[] = [{ id: 'auto', name: 'Tools for whoever needs them most' }];
  for (const m of MATERIALS) if (opened(state, m.requires)) out.push({ id: m.id, name: m.name });
  if (tier) for (const job of toolJobs(state)) out.push({ id: `tool:${job}`, name: `${tier.name} ${TOOL_NAMES[job]} for ${jobDef(job)!.name.toLowerCase()}s` });
  return out;
}

/** Keeps the slot list the right length, and clears orders that no longer make sense. */
export function syncSlots(state: GameState) {
  const want = forgeOpen(state) ? forgeSlotCount(state) : 0;
  while (state.forge.slots.length < want) state.forge.slots.push({ order: state.forge.slots.length === 0 ? 'auto' : null, progress: 0 });
  if (state.forge.slots.length > want) state.forge.slots.length = want;
}

export function setOrder(state: GameState, slot: number, order: string | null): boolean {
  syncSlots(state);
  const s = state.forge.slots[slot];
  if (!s) return false;
  if (order !== null && !orderOptions(state).some((o) => o.id === order)) return false;
  if (s.order !== order) {
    s.order = order;
    s.progress = 0;
  }
  return true;
}

// ---------- tools ----------

export function toolStock(state: GameState, job: string, tier: ToolTier): ToolStock {
  return state.tools[job]?.[tier] ?? { n: 0, wear: 0 };
}

export function toolCount(state: GameState, job: string): number {
  let n = 0;
  for (const t of TIERS) n += toolStock(state, job, t.id).n;
  return n;
}

export function addTool(state: GameState, job: string, tier: ToolTier, n = 1) {
  const byTier = (state.tools[job] ??= {});
  const s = (byTier[tier] ??= { n: 0, wear: 0 });
  s.n += n;
}

/** Who holds what in a job: tool tiers handed out best first, with counts in use. */
export function toolsInUse(state: GameState, job: string): { tier: ToolTier; n: number }[] {
  let left = workers(state, job);
  const out: { tier: ToolTier; n: number }[] = [];
  for (const t of [...TIERS].reverse()) {
    const n = Math.min(left, toolStock(state, job, t.id).n);
    if (n > 0) out.push({ tier: t.id, n });
    left -= n;
  }
  return out;
}

const tierMult = (id: ToolTier) => TIERS.find((t) => t.id === id)!.mult;

/**
 * Tool multipliers for a job: one for each named kobold (in namedIn order,
 * who get the best tools first) and the average for the crowd crew.
 */
export function toolMults(state: GameState, job: string): { named: number[]; crew: number } {
  const queue: number[] = [];
  for (const u of toolsInUse(state, job)) for (let i = 0; i < u.n; i++) queue.push(tierMult(u.tier));
  const named = namedIn(state, job).map((_, i) => queue[i] ?? 1);
  const crewN = workers(state, job) - named.length;
  if (crewN <= 0) return { named, crew: 1 };
  let sum = 0;
  for (let i = named.length; i < named.length + crewN; i++) sum += queue[i] ?? 1;
  return { named, crew: sum / crewN };
}

/** "10 steel, 10 iron, 5 bare" for a job row, or '' when nobody has a tool. */
export function toolSummary(state: GameState, job: string): string {
  const inUse = toolsInUse(state, job);
  const total = workers(state, job);
  if (!inUse.length || total === 0) return '';
  const used = inUse.reduce((a, u) => a + u.n, 0);
  const parts = inUse.map((u) => `${u.n} ${TIERS.find((t) => t.id === u.tier)!.name.toLowerCase()}`);
  if (total > used) parts.push(`${total - used} bare`);
  return `${TOOL_NAMES[job][0].toUpperCase()}${TOOL_NAMES[job].slice(1)}: ${parts.join(', ')}`;
}

function wearTools(state: GameState, dt: number) {
  for (const job of Object.keys(state.tools)) {
    for (const u of toolsInUse(state, job)) {
      const s = state.tools[job][u.tier]!;
      s.wear += (u.n * dt) / FORGE.toolLifeSeconds;
      while (s.wear >= 1 && s.n > 0) {
        s.wear -= 1;
        s.n -= 1;
      }
      if (s.n === 0) s.wear = 0;
    }
  }
}

// ---------- forge work ----------

/** Blacksmiths beyond what the forge fits do nothing. */
export function smithsFit(state: GameState): number {
  const def = roomDef('forge');
  return def && roomOpen(state, def) ? roomCapacity(state, def) : 0;
}

/** Forge work per second, all slots together. */
export function forgeRate(state: GameState): number {
  const def = jobDef('blacksmith');
  if (!def || !forgeOpen(state)) return 0;
  const n = workers(state, 'blacksmith');
  if (n === 0) return 0;
  return jobOutput(state, def) * Math.min(1, smithsFit(state) / n);
}

/** The job an automatic order would make tools for: the most kobolds short of the best tier. */
export function autoJob(state: GameState): string | null {
  const tier = bestTier(state);
  if (!tier) return null;
  let best: string | null = null;
  let most = 0;
  for (const job of toolJobs(state)) {
    const short = workers(state, job) - toolStock(state, job, tier.id).n;
    if (short > most) {
      most = short;
      best = job;
    }
  }
  return best;
}

interface Unit {
  work: number;
  cost: Partial<Record<ResourceId, number>>;
  /** Makes one; returns false if there's nowhere to put it. */
  make: () => boolean;
  /** What it makes, for the forge panel. */
  label: string;
}

/** What a slot's order makes next, or null if there is nothing to do. */
export function unitFor(state: GameState, order: string | null): Unit | null {
  if (!order) return null;
  const mat = MATERIALS.find((m) => m.id === order);
  if (mat) {
    if (!opened(state, mat.requires) || !resourceOpen(state, mat.makes)) return null;
    return {
      work: mat.work,
      cost: mat.cost,
      label: resourceDef(mat.makes).name.toLowerCase(),
      make: () => {
        if (state.res[mat.makes] + 1 > capacity(state, mat.makes)) return false;
        state.res[mat.makes] += 1;
        return true;
      },
    };
  }
  const job = order === 'auto' ? autoJob(state) : order.startsWith('tool:') ? order.slice(5) : null;
  const tier = bestTier(state);
  if (!job || !tier || !TOOL_NAMES[job]) return null;
  return {
    work: tier.work,
    cost: tier.cost,
    label: `${tier.name.toLowerCase()} ${TOOL_NAMES[job]}`,
    make: () => {
      addTool(state, job, tier.id);
      return true;
    },
  };
}

function canPay(state: GameState, cost: Partial<Record<ResourceId, number>>): boolean {
  return Object.entries(cost).every(([r, n]) => state.res[r as ResourceId] >= (n ?? 0));
}

/** Why a slot is stuck, or null. */
export function slotBlocked(state: GameState, slot: ForgeSlot): string | null {
  if (!slot.order) return null;
  const unit = unitFor(state, slot.order);
  if (!unit) return slot.order === 'auto' ? 'Everyone has the best tools there are.' : 'Nothing to make.';
  const short = (Object.entries(unit.cost) as [ResourceId, number][]).filter(([r, n]) => state.res[r] < n).map(([r]) => resourceDef(r).name.toLowerCase());
  if (short.length) return `Waiting for ${short.join(' and ')}.`;
  return null;
}

/**
 * Slots with an order. Work is split evenly between them, even while one has
 * nothing to do (an auto order with everyone equipped), so the others work at
 * a steady pace instead of speeding up and slowing down as tools are needed.
 */
function busySlots(state: GameState): ForgeSlot[] {
  return state.forge.slots.filter((s) => s.order);
}

/** Tool orders come and go as kobolds arrive and tools wear out, so their use is shown smoothed over about this long. */
const TOOL_USE_SECONDS = 1800;

/** Let `dt` seconds of forge work happen. Returns how many of each thing was made. */
export function forgeStep(state: GameState, dt: number): Record<string, number> {
  const made: Record<string, number> = {};
  syncSlots(state);
  wearTools(state, dt);
  const toolPaid: Partial<Record<ResourceId, number>> = {};
  work(state, dt, made, toolPaid);
  // smooth what tool orders actually used, so the stores don't flicker as tools come and go
  const k = 1 - Math.exp(-dt / TOOL_USE_SECONDS);
  const use = (state.forge.toolUse ??= {});
  for (const r of new Set([...Object.keys(use), ...Object.keys(toolPaid)]) as Set<ResourceId>) {
    const v = (use[r] ?? 0) + ((toolPaid[r] ?? 0) / Math.max(dt, 1e-9) - (use[r] ?? 0)) * k;
    if (v < 1e-6) delete use[r];
    else use[r] = v;
  }
  return made;
}

function work(state: GameState, dt: number, made: Record<string, number>, toolPaid: Partial<Record<ResourceId, number>>) {
  const busy = busySlots(state);
  const rate = forgeRate(state);
  if (!busy.length || rate <= 0) return;
  const share = (rate * dt) / busy.length;
  for (const slot of busy) {
    const isTool = !MATERIALS.some((m) => m.id === slot.order);
    slot.progress += share;
    for (let guard = 0; guard < 100; guard++) {
      const unit = unitFor(state, slot.order);
      if (!unit) {
        slot.progress = 0;
        break;
      }
      if (slot.progress < unit.work) break;
      if (!canPay(state, unit.cost)) {
        slot.progress = unit.work; // waits, finished but for the materials
        break;
      }
      for (const [r, n] of Object.entries(unit.cost)) state.res[r as ResourceId] -= n ?? 0;
      if (!unit.make()) {
        for (const [r, n] of Object.entries(unit.cost)) state.res[r as ResourceId] += n ?? 0;
        slot.progress = unit.work;
        break;
      }
      if (isTool) for (const [r, n] of Object.entries(unit.cost)) toolPaid[r as ResourceId] = (toolPaid[r as ResourceId] ?? 0) + (n ?? 0);
      slot.progress -= unit.work;
      made[unit.label] = (made[unit.label] ?? 0) + 1;
    }
  }
}

/**
 * Resources per second the forge uses, for the stores' flows: smelting and
 * steel at full pace, and tool orders as they've been using lately.
 */
export function forgeUse(state: GameState): Partial<Record<ResourceId, number>> {
  const use: Partial<Record<ResourceId, number>> = { ...(state.forge.toolUse ?? {}) };
  const busy = busySlots(state);
  const rate = forgeRate(state);
  if (!busy.length || rate <= 0) return use;
  for (const slot of busy) {
    if (!MATERIALS.some((m) => m.id === slot.order)) continue;
    const unit = unitFor(state, slot.order);
    if (!unit) continue;
    const per = rate / busy.length / unit.work;
    for (const [r, n] of Object.entries(unit.cost)) use[r as ResourceId] = (use[r as ResourceId] ?? 0) + per * (n ?? 0);
  }
  return use;
}

/** Bars and steel per second the forge would make at full pace. */
export function forgeMakes(state: GameState): Partial<Record<ResourceId, number>> {
  const out: Partial<Record<ResourceId, number>> = {};
  const busy = busySlots(state);
  const rate = forgeRate(state);
  for (const slot of busy) {
    const mat = MATERIALS.find((m) => m.id === slot.order);
    if (mat && opened(state, mat.requires)) out[mat.makes] = (out[mat.makes] ?? 0) + rate / busy.length / mat.work;
  }
  return out;
}

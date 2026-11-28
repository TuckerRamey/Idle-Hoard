// The forge: blacksmiths smelt ore into bars, make steel, and make tools.
// Tools go on one shared rack that every job takes from. They come in tiers;
// the best are handed out first (to the starred job, if any, then shared out
// evenly), named kobolds get theirs before the crew, and anyone left over
// works bare-handed. Tools in use wear out; spares wait on the rack for good.

import type { ResourceId } from './data';
import { capacity, jobDef, jobOpen, jobOutput, resourceDef, resourceOpen, roomCapacity, roomDef, roomOpen, workers } from './economy';
import { namedIn } from './kobolds';
import { finishCommission, nextUpgrade, piece, tidyCommissions, toolMult } from './gear';
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

/** What each job calls its tools, for the chronicle. The rack itself only holds "tools". */
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
  shaman: 'rattles',
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
  /** 'auto' (tools), 'commissions' (named kobolds' gear, else tools), 'smelt', 'steel', or null for an empty slot. */
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
  const out: OrderOption[] = [{ id: 'auto', name: 'Tools' }, { id: 'commissions', name: 'Commissions' }];
  for (const m of MATERIALS) if (opened(state, m.requires)) out.push({ id: m.id, name: m.name });
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

const tierDef = (id: ToolTier) => TIERS.find((t) => t.id === id)!;
const tierMult = (id: ToolTier) => tierDef(id).mult;
const bestFirst = [...TIERS].reverse();

export function rackStock(state: GameState, tier: ToolTier): ToolStock {
  return state.rack[tier] ?? { n: 0, wear: 0 };
}

/** Every tool on the rack, in use or spare. */
export function rackCount(state: GameState): number {
  return TIERS.reduce((a, t) => a + rackStock(state, t.id).n, 0);
}

export function addTool(state: GameState, tier: ToolTier, n = 1) {
  const s = (state.rack[tier] ??= { n: 0, wear: 0 });
  s.n += n;
}

/** Put one job first in line for tools, or null to share them out evenly. */
export function setToolFirst(state: GameState, job: string | null): boolean {
  if (job !== null && !toolJobs(state).includes(job)) return false;
  state.toolFirst = job;
  return true;
}

export type Allocation = Record<string, Partial<Record<ToolTier, number>>>;

/**
 * Who holds what. The best tier is handed out first, then the next, and so on.
 * Within a tier, the starred job is served first, and the rest are shared out
 * in proportion to how many kobolds each job still has without one.
 */
export function toolAllocation(state: GameState): Allocation {
  // asked for many times a tick (every job's output), so remember the last answer while nothing it depends on has changed
  // inside one tick step the answer is worked out once (like job outputs), skipping even the key
  if (stepAlloc && stepAlloc.state === state) return stepAlloc.alloc;
  const key = allocKey(state);
  let alloc: Allocation;
  if (allocCache.state === state && allocCache.key === key) alloc = allocCache.alloc;
  else {
    alloc = allocate(state);
    allocCache = { state, key, alloc };
  }
  if (stepAlloc === undefined) stepAlloc = { state, alloc };
  return alloc;
}

/** null outside a tick step; undefined at the start of one, until the first ask. */
let stepAlloc: { state: GameState; alloc: Allocation } | null | undefined = null;

/** Called by the economy around each tick step: the tool split is reused for the step's length. */
export function stepAllocCache(on: boolean) {
  stepAlloc = on ? undefined : null;
}

let allocCache: { state: GameState | null; key: string; alloc: Allocation } = { state: null, key: '', alloc: {} };

function allocKey(state: GameState): string {
  let k = `${state.toolFirst}|${state.research.done.length}|${state.explore.found.length}|${state.named.length}|`;
  for (const t of TIERS) k += `${state.rack[t.id]?.n ?? 0},`;
  for (const [job, c] of Object.entries(state.crews)) k += `${job}:${c.n},`;
  for (const n of state.named) k += `${n.job}${n.gear?.tool ? '+' : ''}${(n.restLeft ?? 0) > 0 ? 'r' : ''},`;
  return k;
}

function allocate(state: GameState): Allocation {
  const need = new Map<string, number>();
  for (const job of toolJobs(state)) {
    // named kobolds with a tool of their own don't take one from the rack
    const n = workers(state, job) - namedIn(state, job).filter((k) => piece(k, 'tool')).length;
    if (n > 0) need.set(job, n);
  }
  const out: Allocation = {};
  const give = (job: string, tier: ToolTier, n: number) => {
    if (n <= 0) return;
    (out[job] ??= {})[tier] = (out[job][tier] ?? 0) + n;
    need.set(job, need.get(job)! - n);
  };
  for (const t of bestFirst) {
    let left = rackStock(state, t.id).n;
    const first = state.toolFirst;
    if (left > 0 && first && (need.get(first) ?? 0) > 0) {
      const n = Math.min(left, need.get(first)!);
      give(first, t.id, n);
      left -= n;
    }
    const jobs = [...need].filter(([, n]) => n > 0);
    const total = jobs.reduce((a, [, n]) => a + n, 0);
    if (left <= 0 || total === 0) continue;
    if (left >= total) {
      for (const [job, n] of jobs) give(job, t.id, n);
      continue;
    }
    // largest remainder, so whole tools add up to what's on the rack
    const shares = jobs.map(([job, n]) => ({ job, exact: (left * n) / total }));
    let handed = 0;
    for (const x of shares) handed += Math.floor(x.exact);
    const extra = [...shares].sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)));
    const bonus = new Set(extra.slice(0, left - handed).map((x) => x.job));
    for (const x of shares) give(x.job, t.id, Math.floor(x.exact) + (bonus.has(x.job) ? 1 : 0));
  }
  return out;
}

/** Who holds what in a job: tool tiers, best first, with counts in use. */
export function toolsInUse(state: GameState, job: string, alloc = toolAllocation(state)): { tier: ToolTier; n: number }[] {
  const mine = alloc[job] ?? {};
  return bestFirst.filter((t) => (mine[t.id] ?? 0) > 0).map((t) => ({ tier: t.id, n: mine[t.id]! }));
}

/** Tools on the rack nobody is using, by tier. */
export function spareTools(state: GameState, alloc = toolAllocation(state)): Partial<Record<ToolTier, number>> {
  const out: Partial<Record<ToolTier, number>> = {};
  for (const t of TIERS) {
    let used = 0;
    for (const job of Object.keys(alloc)) used += alloc[job][t.id] ?? 0;
    const n = rackStock(state, t.id).n - used;
    if (n > 0) out[t.id] = n;
  }
  return out;
}

/**
 * Tool multipliers for a job: one for each named kobold (in namedIn order,
 * who get the best tools first) and the average for the crowd crew.
 */
export function toolMults(state: GameState, job: string): { named: number[]; crew: number } {
  // tools best first: named kobolds take from the front (unless they have their own), the crew shares the rest
  const inUse = toolsInUse(state, job);
  const namedK = namedIn(state, job);
  const named: number[] = [];
  let ti = 0;
  let left = inUse[0]?.n ?? 0;
  for (const k of namedK) {
    const own = toolMult(k);
    if (own !== null) {
      named.push(own);
      continue;
    }
    while (left <= 0 && ti < inUse.length - 1) left = inUse[++ti].n;
    if (left > 0) {
      named.push(tierMult(inUse[ti].tier));
      left--;
    } else named.push(1);
  }
  const crewN = workers(state, job) - namedK.length;
  if (crewN <= 0) return { named, crew: 1 };
  let sum = 0;
  let given = 0;
  if (left > 0) {
    const n = Math.min(left, crewN);
    sum += n * tierMult(inUse[ti].tier);
    given += n;
  }
  for (let j = ti + 1; j < inUse.length && given < crewN; j++) {
    const n = Math.min(inUse[j].n, crewN - given);
    sum += n * tierMult(inUse[j].tier);
    given += n;
  }
  sum += crewN - given;
  return { named, crew: sum / crewN };
}

/** A short tag for a job row: "steel tools", "steel tools, 4 without", or '' when nobody has one. */
export function toolTag(state: GameState, job: string): string {
  const inUse = toolsInUse(state, job);
  const total = workers(state, job);
  if (!inUse.length || total === 0) return '';
  const bare = total - inUse.reduce((a, u) => a + u.n, 0);
  return `${tierDef(inUse[0].tier).name.toLowerCase()} tools${bare > 0 ? `, ${bare} without` : ''}`;
}

/** The forge's Tools table line for a job: "steel for all 12", or "steel for 5 of 12; 4 on iron, 3 without". */
export function toolLine(state: GameState, job: string, alloc = toolAllocation(state)): string {
  const total = workers(state, job);
  if (total === 0) return 'Nobody working.';
  const inUse = toolsInUse(state, job, alloc);
  const bare = total - inUse.reduce((a, u) => a + u.n, 0);
  if (!inUse.length) return `None yet, ${total} without.`;
  const top = inUse[0];
  const name = (id: ToolTier) => tierDef(id).name.toLowerCase();
  if (top.n === total) return `${tierDef(top.tier).name} for all ${total}.`;
  const rest = [...inUse.slice(1).map((u) => `${u.n} on ${name(u.tier)}`), ...(bare > 0 ? [`${bare} without`] : [])];
  return `${tierDef(top.tier).name} for ${top.n} of ${total}; ${rest.join(', ')}.`;
}

function wearTools(state: GameState, dt: number) {
  const alloc = toolAllocation(state);
  for (const t of TIERS) {
    const s = state.rack[t.id];
    if (!s) continue;
    let used = 0;
    for (const job of Object.keys(alloc)) used += alloc[job][t.id] ?? 0;
    s.wear += (used * dt) / FORGE.toolLifeSeconds;
    while (s.wear >= 1 && s.n > 0) {
      s.wear -= 1;
      s.n -= 1;
    }
    if (s.n === 0) s.wear = 0;
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

interface Unit {
  work: number;
  cost: Partial<Record<ResourceId, number>>;
  /** Makes one; returns false if there's nowhere to put it. */
  make: () => boolean;
  /** What it makes, for the forge panel. */
  label: string;
}

/** What a slot's order makes next, or null if there is nothing to do. */
export function unitFor(state: GameState, order: string | null, lines?: string[], t = 0, rand: () => number = Math.random): Unit | null {
  if (!order) return null;
  if (order === 'commissions') {
    // the first commission in the queue, or tools while there's none
    const c = state.forge.commissions[0];
    const k = c && state.named.find((x) => x.id === c.kobold);
    const p = k && piece(k, c.slot);
    const up = p && nextUpgrade(state, p);
    if (!c || !k || !p || !up) return unitFor(state, 'auto');
    return {
      work: up.work,
      cost: up.cost as Partial<Record<ResourceId, number>>,
      label: `${k.name}'s ${c.slot}`,
      make: () => {
        const line = finishCommission(state, t, rand);
        if (line) lines?.push(line);
        return true;
      },
    };
  }
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
  const tier = order === 'auto' ? bestTier(state) : undefined;
  if (!tier) return null;
  return {
    work: tier.work,
    cost: tier.cost,
    label: `${tier.name.toLowerCase()} tools`,
    make: () => {
      addTool(state, tier.id);
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
  if (!unit) return 'Nothing to make.';
  const short = (Object.entries(unit.cost) as [ResourceId, number][]).filter(([r, n]) => state.res[r] < n).map(([r]) => resourceDef(r).name.toLowerCase());
  if (short.length) return `Waiting for ${short.join(' and ')}.`;
  return null;
}

/**
 * Slots with an order. Work is split evenly between them, even while one is
 * waiting on materials, so the others work at a steady pace.
 */
function busySlots(state: GameState): ForgeSlot[] {
  return state.forge.slots.filter((s) => s.order);
}

/** Tool orders stall and restart as materials come and go, so their use is shown smoothed over about this long. */
const TOOL_USE_SECONDS = 1800;

/** Let `dt` seconds of forge work happen. Returns how many of each thing was made. */
export function forgeStep(state: GameState, dt: number, lines?: string[], t = 0, rand: () => number = Math.random): Record<string, number> {
  const made: Record<string, number> = {};
  syncSlots(state);
  tidyCommissions(state);
  wearTools(state, dt);
  const toolPaid: Partial<Record<ResourceId, number>> = {};
  work(state, dt, made, toolPaid, lines, t, rand);
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

function work(state: GameState, dt: number, made: Record<string, number>, toolPaid: Partial<Record<ResourceId, number>>, lines?: string[], t = 0, rand: () => number = Math.random) {
  const busy = busySlots(state);
  const rate = forgeRate(state);
  if (!busy.length || rate <= 0) return;
  const share = (rate * dt) / busy.length;
  for (const slot of busy) {
    const isTool = !MATERIALS.some((m) => m.id === slot.order);
    slot.progress += share;
    for (let guard = 0; guard < 100; guard++) {
      const unit = unitFor(state, slot.order, lines, t, rand);
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

// The DOM side panel. Updated once per economy tick, and only the bits of
// text that changed are written, so it costs next to nothing.

import { huntableMonsters, huntHint, setQuarry } from '../game/hunting';
import { shamanHint } from '../game/magic';
import { toolSummary } from '../game/forge';
import { DIG, DRAGON_STAGES, GEMS, IDLE, JOBS, RESOURCES, ROOMS, type ResourceId } from '../game/data';
import { animalsOpen, setHerd, STATS, worthRate } from '../game/dragon';
import {
  appeal,
  arrivalSeconds,
  assign,
  beds,
  crew,
  assignDig,
  digBlocked,
  digRate,
  diggersIn,
  flows,
  herdersFit,
  hoardValue,
  jobHints,
  minerSplit,
  oreShare,
  jobOpen,
  jobOutput,
  namedInJob,
  perKobold,
  population,
  recipesOpen,
  resourceDef,
  resourceOpen,
  roomCapacity,
  roomVolume,
  roomOpen,
  scavengerDig,
  setRecipe,
  storeGoods,
  supportsFor,
  digYields,
  recipeRatio,
  workPerPace,
  workers,
} from '../game/economy';
import type { GameState } from '../game/state';
import { $, setDisabled, setText } from './dom';
import { formatDuration, formatNumber } from './format';

export type HudEvent =
  | { kind: 'assign'; job: string; moved: number }
  | { kind: 'newcomers'; job: string }
  | { kind: 'dig'; room: string; moved: number }
  | { kind: 'herd'; animal: string }
  | { kind: 'recipe'; id: string }
  | { kind: 'quarry'; id: string };

const STEPS = [1, 5, 20, Infinity];
const resName = (id: ResourceId) => resourceDef(id).name.toLowerCase();

export function costText(cost: Partial<Record<ResourceId, number>>): string {
  return Object.entries(cost)
    .map(([r, n]) => `${formatNumber(n ?? 0)} ${resName(r as ResourceId)}`)
    .join(', ');
}

/** The job list, under headings. Digging is done from the Rooms tab. */
export const JOB_GROUPS: { name: string; jobs: string[] }[] = [
  { name: 'Gathering', jobs: ['scavenger', 'woodcutter', 'miner'] },
  { name: 'Animals', jobs: ['herder', 'hunter'] },
];
/** Jobs assigned from their own tab: researchers on Research, blacksmiths and the alchemist on Forge. */
export const JOB_ELSEWHERE: Record<string, string> = { researcher: '#research-jobs', shaman: '#research-jobs', blacksmith: '#forge-jobs', alchemist: '#forge-jobs' };

export function row(html: string): HTMLLIElement {
  const li = document.createElement('li');
  li.innerHTML = html;
  return li;
}

function setHidden(el: HTMLElement, v: boolean) {
  if (el.hidden !== v) el.hidden = v;
}

/** Fill a <select> with options, only when the set of options changed. */
export function syncOptions(sel: HTMLSelectElement, opts: [string, string][], value: string) {
  const key = opts.map((o) => o[0]).join();
  if (sel.dataset.key !== key) {
    sel.dataset.key = key;
    sel.replaceChildren(
      ...opts.map(([v, label]) => {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = label;
        return o;
      }),
    );
  }
  if (sel.value !== value) sel.value = value;
}

interface JobRow {
  li: HTMLLIElement;
  count: HTMLElement;
  tools: HTMLElement;
  rate: HTMLElement;
  hint: HTMLElement;
  down: HTMLButtonElement;
  up: HTMLButtonElement;
  extra?: HTMLSelectElement;
}

export class Hud {
  private copper = $('#copper');
  private rate = $('#rate');
  private worthUnit = $('#worth-unit');
  private metals = $('#metals');
  private stageName = $('#stage-name');
  private stageBar = $<HTMLDivElement>('#stage-bar > div');
  private stageText = $('#stage-text');
  private popCount = $('#pop-count');
  private popText = $('#pop-text');
  private step = 1;
  private resRows = new Map<ResourceId, { li: HTMLLIElement; amount: HTMLElement; rate: HTMLElement; note: HTMLElement }>();
  private jobRows = new Map<string, JobRow>();
  private groupHeads = new Map<string, HTMLElement>();
  private jobHeads = new Map<string, HTMLElement>();
  private idleCount!: HTMLElement;
  private newcomerSelect!: HTMLSelectElement;
  private roomRows = new Map<
    string,
    { li: HTMLLIElement; size: HTMLElement; count: HTMLElement; holds: HTMLElement; dig: HTMLElement; down: HTMLButtonElement; up: HTMLButtonElement }
  >();
  private digStatus = $('#dig-status');

  constructor(
    private getState: () => GameState,
    private onChange: (e: HudEvent) => void,
  ) {
    this.buildResources();
    this.buildJobs();
    this.buildRooms();
  }

  // ---------- building the rows once ----------

  private buildResources() {
    const list = $('#resources');
    for (const r of RESOURCES) {
      const li = row(`<div class="row-main"><div class="res-line"><b></b><span class="amount"></span><span class="res-rate"></span></div><div class="sub note"></div></div>`);
      li.querySelector('b')!.textContent = r.name;
      this.resRows.set(r.id, { li, amount: li.querySelector('.amount')!, rate: li.querySelector('.res-rate')!, note: li.querySelector('.note')! });
      list.append(li);
    }
    // gems: treasure, only ever found
    this.gemRow = row(`<div class="row-main"><div class="res-line"><b>Gems</b><span class="amount"></span></div><div class="sub note"></div></div>`);
    list.append(this.gemRow);
  }
  private gemRow!: HTMLLIElement;

  private buildJobs() {
    // one "move how many" choice, shown on every tab that moves kobolds
    const switchers = [...document.querySelectorAll<HTMLElement>('.step')];
    for (const switcher of switchers)
      for (const n of STEPS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'small';
        b.dataset.step = String(n);
        b.textContent = n === Infinity ? 'All' : String(n);
        b.setAttribute('aria-pressed', String(n === this.step));
        b.addEventListener('click', () => {
          this.step = n;
          for (const sw of switchers) sw.querySelectorAll<HTMLElement>('button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.step === String(n))));
          this.update();
        });
        switcher.append(b);
      }

    const list = $('#jobs');
    const idle = row(`<div class="row-main"><b>Idle</b> <span class="count"></span><div class="desc newcomers"><label for="newcomer-job">Newcomers go to</label> <select id="newcomer-job"></select></div></div>`);
    this.idleCount = idle.querySelector('.count')!;
    this.newcomerSelect = idle.querySelector('select')!;
    this.newcomerSelect.addEventListener('change', () => {
      this.getState().newcomerJob = this.newcomerSelect.value;
      this.onChange({ kind: 'newcomers', job: this.newcomerSelect.value });
    });
    list.append(idle);

    for (const g of JOB_GROUPS) {
      const head = document.createElement('li');
      head.className = 'room-group';
      head.textContent = g.name;
      this.jobHeads.set(g.name, head);
      list.append(head);
      for (const id of g.jobs) this.buildJob(list, JOBS.find((j) => j.id === id)!);
    }
    // jobs that belong to another tab are moved there, next to what they work on
    for (const [id, sel] of Object.entries(JOB_ELSEWHERE)) this.buildJob($(sel), JOBS.find((j) => j.id === id)!);
    // anything else goes at the end
    for (const def of JOBS) if (!JOB_GROUPS.some((g) => g.jobs.includes(def.id)) && !JOB_ELSEWHERE[def.id]) this.buildJob(list, def);
  }

  private buildJob(list: HTMLElement, def: (typeof JOBS)[number]) {
    {
      const li = row(
        `<div class="row-main"><b></b> <span class="count"></span><div class="desc"></div><div class="sub"></div><div class="desc tools"></div><div class="hint"></div></div><div class="job-buttons"><button type="button" class="small down">−</button><button type="button" class="small up">+</button></div>`,
      );
      li.querySelector('b')!.textContent = def.name;
      li.querySelector('.desc')!.textContent = def.description;
      const down = li.querySelector<HTMLButtonElement>('.down')!;
      const up = li.querySelector<HTMLButtonElement>('.up')!;
      down.addEventListener('click', () => this.move(def.id, -1));
      up.addEventListener('click', () => this.move(def.id, 1));
      const r: JobRow = { li, count: li.querySelector('.count')!, rate: li.querySelector('.sub')!, tools: li.querySelector('.tools')!, hint: li.querySelector('.hint')!, down, up };
      if (def.id === 'herder' || def.id === 'alchemist' || def.id === 'hunter') {
        const wrap = document.createElement('div');
        wrap.className = 'desc newcomers';
        const label = document.createElement('label');
        label.textContent = def.id === 'herder' ? 'Raising ' : def.id === 'hunter' ? 'Hunting ' : 'Making ';
        const sel = document.createElement('select');
        sel.id = `${def.id}-choice`;
        label.htmlFor = sel.id;
        wrap.append(label, sel);
        li.querySelector('.desc')!.after(wrap);
        sel.addEventListener('change', () => {
          const s = this.getState();
          if (def.id === 'hunter') {
            if (setQuarry(s, sel.value)) this.onChange({ kind: 'quarry', id: sel.value });
          } else if (def.id === 'herder' ? setHerd(s, sel.value) : setRecipe(s, sel.value))
            this.onChange(def.id === 'herder' ? { kind: 'herd', animal: sel.value } : { kind: 'recipe', id: sel.value });
        });
        r.extra = sel;
      }
      this.jobRows.set(def.id, r);
      list.append(li);
    }
  }

  private move(job: string, dir: 1 | -1) {
    const s = this.getState();
    const k = this.step === Infinity ? (dir > 0 ? s.idle : crew(s, job).n) : this.step;
    const moved = assign(s, job, dir * k);
    if (moved !== 0) this.onChange({ kind: 'assign', job, moved });
  }

  private moveDig(room: string, dir: 1 | -1) {
    const s = this.getState();
    const k = this.step === Infinity ? (dir > 0 ? s.idle : diggersIn(s, room)) : this.step;
    const moved = assignDig(s, room, dir * k);
    if (moved !== 0) this.onChange({ kind: 'dig', room, moved });
  }

  private buildRooms() {
    const list = $('#rooms');
    const groups = { living: 'Living', work: 'Work', stores: 'Stores' } as const;
    for (const [g, title] of Object.entries(groups)) {
      const head = document.createElement('li');
      head.className = 'room-group';
      head.textContent = title;
      list.append(head);
      this.groupHeads.set(g, head);
      for (const def of ROOMS.filter((r) => r.group === g)) {
        const li = row(
          `<div class="row-main"><b></b> <span class="count size"></span> <span class="vet diggers"></span><div class="desc"></div><div class="sub holds"></div><div class="desc dig"></div></div><div class="job-buttons"><button type="button" class="small down">−</button><button type="button" class="small up">+</button></div>`,
        );
        li.querySelector('b')!.textContent = def.name;
        li.querySelector('.desc')!.textContent = def.description;
        const down = li.querySelector<HTMLButtonElement>('.down')!;
        const up = li.querySelector<HTMLButtonElement>('.up')!;
        down.addEventListener('click', () => this.moveDig(def.id, -1));
        up.addEventListener('click', () => this.moveDig(def.id, 1));
        this.roomRows.set(def.id, {
          li,
          size: li.querySelector('.size')!,
          count: li.querySelector('.diggers')!,
          holds: li.querySelector('.holds')!,
          dig: li.querySelector('.dig')!,
          down,
          up,
        });
        list.append(li);
      }
    }
  }

  // ---------- every tick ----------

  update() {
    const s = this.getState();
    // the hoard's worth, with what it's made of underneath once there's more than copper
    setText(this.copper, formatNumber(hoardValue(s)));
    const metals = RESOURCES.filter((r) => r.value && resourceOpen(s, r.id)).map((r) => `${formatNumber(s.res[r.id])} ${r.name.toLowerCase()}`);
    const gemCount = Object.values(s.gems).reduce((a, n) => a + n, 0);
    if (gemCount > 0) metals.push(`${formatNumber(gemCount)} gem${gemCount === 1 ? '' : 's'}`);
    setText(this.worthUnit, metals.length > 1 ? 'worth' : 'copper');
    setText(this.metals, metals.length > 1 ? metals.join(' · ') : '');
    setText(this.rate, `${formatNumber(worthRate(s))} / s`);

    setText(this.stageName, DRAGON_STAGES[s.stage].name);
    const hatchAt = DRAGON_STAGES[1].threshold ?? 0;
    if (s.stage === 0) {
      this.stageBar.parentElement!.hidden = false;
      const v = hoardValue(s);
      this.stageBar.style.width = `${Math.min(100, (v / hatchAt) * 100).toFixed(1)}%`;
      setText(this.stageText, `Hatches when the hoard is worth ${formatNumber(hatchAt)} copper (${formatNumber(v)} so far)`);
    } else {
      this.stageBar.parentElement!.hidden = true;
      setText(this.stageText, '');
    }

    this.updateResources(s);
    this.updateJobs(s);
    this.updateRooms(s);
  }

  private updateResources(s: GameState) {
    const kinds = GEMS.filter((g) => (s.gems[g.id] ?? 0) > 0);
    setHidden(this.gemRow, kinds.length === 0);
    if (kinds.length) {
      const worth = kinds.reduce((a, g) => a + g.value * s.gems[g.id], 0);
      setText(this.gemRow.querySelector<HTMLElement>('.amount')!, `${formatNumber(worth)} worth`);
      setText(this.gemRow.querySelector<HTMLElement>('.note')!, `${kinds.map((g) => `${s.gems[g.id]} ${g.name.toLowerCase()}`).join(', ')}. Kept on the hoard; they take no room.`);
    }
    const f = flows(s);
    for (const r of RESOURCES) {
      const row = this.resRows.get(r.id)!;
      setHidden(row.li, !resourceOpen(s, r.id));
      if (row.li.hidden) continue;
      const fl = f[r.id];
      setText(row.amount, `${formatNumber(fl.held)} / ${formatNumber(fl.cap)}`);
      const net = fl.in - fl.out;
      setText(row.rate, fl.in === 0 && fl.out === 0 ? '' : `${net >= 0 ? '+' : '−'}${formatNumber(Math.abs(net))} / s`);
      row.rate.classList.toggle('warn', net < 0);
      const by = fl.usedBy === 'digging' ? 'Digging' : fl.usedBy === 'alchemy' ? 'The alchemist' : fl.usedBy === 'forge' ? 'The forge' : 'The dragon';
      let note = '';
      if (fl.held >= fl.cap && fl.in > 0 && net >= 0) note = 'Full. Anything more is lost until the room is dug bigger.';
      else if (fl.out > 0 && net < 0)
        note = fl.held < 1 ? `${by} needs ${formatNumber(fl.out)} / s and has run out.` : `${by} uses ${formatNumber(fl.out)} / s. Runs out in ${formatDuration(fl.held / -net)}.`;
      else if (fl.out > 0) note = `${by} uses ${formatNumber(fl.out)} / s.`;
      else if (fl.in > 0 && fl.held < fl.cap) note = `Full in ${formatDuration((fl.cap - fl.held) / fl.in)}.`;
      setText(row.note, note);
      row.note.classList.toggle('warn', (fl.held >= fl.cap && fl.in > 0) || (fl.held < 1 && net < 0));
    }
  }

  private updateJobs(s: GameState) {
    const pop = population(s);
    const bedCount = beds(s);
    setText(this.popCount, `${pop} kobold${pop === 1 ? '' : 's'}`);
    const a = Math.round(appeal(s));
    if (!s.chief) setText(this.popText, 'Kobolds will come once there is a Chief.');
    else if (pop < bedCount) {
      const wait = Math.max(0, arrivalSeconds(s) - s.arrivalProgress);
      setText(this.popText, `${pop} of ${bedCount} beds taken. The hoard's appeal is ${a}: the next kobold wanders in within ${formatDuration(Math.ceil(wait))}.`);
    } else setText(this.popText, `All ${bedCount} beds are taken. Dig the den bigger to make room for more. Appeal ${a}.`);

    setText(this.idleCount, `×${s.idle}`);
    for (const el of document.querySelectorAll<HTMLElement>('.idle-note')) setText(el, `${s.idle} idle`);
    const open = JOBS.filter((j) => jobOpen(s, j) && j.id !== 'digger');
    syncOptions(this.newcomerSelect, [[IDLE, 'Idle (wait for orders)'], ...open.map((j) => [j.id, j.name] as [string, string])], s.newcomerJob);

    const hints = jobHints(s);
    for (const def of JOBS) {
      const row = this.jobRows.get(def.id)!;
      setHidden(row.li, !jobOpen(s, def) || def.id === 'digger');
      if (row.li.hidden) continue;
      const c = crew(s, def.id);
      const stars = namedInJob(s, def.id);
      setText(row.count, `×${c.n}${stars ? ` + ${stars} named` : ''}`);
      const each = perKobold(s, def);
      const what = def.produces ? resName(def.produces.resource) : def.digs ? 'digging' : def.researches ? 'research' : def.smiths ? 'forge work' : def.hunts ? 'hunting' : def.channels ? 'mana' : 'turned over';
      setText(row.tools, toolSummary(s, def.id));
      const total = jobOutput(s, def);
      if (def.id === 'miner' && oreShare(s) > 0) {
        // stone and ore, in a steady split
        const sp = minerSplit(s);
        const parts = (x: number) => [sp.stone > 0 ? `${formatNumber(x * sp.stone)} stone` : '', `${formatNumber(x * sp.ore)} iron ore`].filter(Boolean).join(' and ');
        setText(row.rate, workers(s, def.id) > 0 ? `${parts(total)} / s (${sp.yardFull ? 'ore only while the stone yard is full' : `${Math.round(oreShare(s) * 100)}% comes out as ore`})` : `${parts(each)} / s each`);
      } else if (def.channels) {
        // mana comes slowly: per hour reads better
        setText(row.rate, workers(s, def.id) > 0 ? `${formatNumber(total * 3600)} mana an hour (${formatNumber(each * 3600)} each)` : `${formatNumber(each * 3600)} mana an hour each`);
      } else setText(row.rate, workers(s, def.id) > 0 ? `${formatNumber(total)} ${what} / s (${formatNumber(each)} each)` : `${formatNumber(each)} ${what} / s each`);
      const note = def.id === 'hunter' ? huntHint(s) : def.id === 'shaman' ? shamanHint(s) : null;
      setText(row.hint, hints[def.id] ?? note ?? '');
      row.hint.classList.toggle('info', !hints[def.id] && !!note && !note.startsWith('Out of'));
      setDisabled(row.down, c.n < 1);
      setDisabled(row.up, s.idle < 1);
      const label = this.step === Infinity ? 'all' : String(this.step);
      row.down.title = `Send ${label} back to idle`;
      row.up.title = `Put ${label} idle kobold${this.step === 1 ? '' : 's'} on this job`;
      row.down.setAttribute('aria-label', `${def.name}: ${row.down.title}`);
      row.up.setAttribute('aria-label', `${def.name}: ${row.up.title}`);
      if (row.extra && def.id === 'herder') {
        const fit = herdersFit(s);
        syncOptions(row.extra, animalsOpen(s).map((x) => [x.id, x.name]), s.herd);
        row.extra.title = `The pasture fits ${fit} herders`;
      } else if (row.extra && def.id === 'hunter') {
        syncOptions(row.extra, huntableMonsters(s).map((m) => [m.id, `${m.plural[0].toUpperCase()}${m.plural.slice(1)} (${STATS.find((x) => x.id === m.stat)!.name})`]), s.hunt.quarry);
      } else if (row.extra) syncOptions(row.extra, recipesOpen(s).map((x) => [x.id, `${x.name}, ${formatNumber(recipeRatio(s, x))} to 1`]), s.recipe);
    }
    // a tab's job block shows once one of its jobs is open
    for (const sel of new Set(Object.values(JOB_ELSEWHERE))) {
      const block = $(sel).closest<HTMLElement>('.job-block')!;
      setHidden(block, Object.entries(JOB_ELSEWHERE).every(([id, x]) => x !== sel || this.jobRows.get(id)!.li.hidden));
    }
    // a heading shows once any job under it is open
    for (const g of JOB_GROUPS) setHidden(this.jobHeads.get(g.name)!, g.jobs.every((id) => this.jobRows.get(id)?.li.hidden ?? true));
  }

  private updateRooms(s: GameState) {
    const f = flows(s);
    const digger = JOBS.find((j) => j.id === 'digger')!;
    const dc = crew(s, 'digger');
    const dn = namedInJob(s, 'digger');
    let status = `Put diggers on any rooms with − and +; each room grows with its own diggers. ${formatNumber(perKobold(s, digger))} digging / s each.`;
    if (dc.n + dn > 0)
      status = `${dc.n} digger${dc.n === 1 ? '' : 's'}${dn ? ` + ${dn} named` : ''}. ${formatNumber(perKobold(s, digger))} digging / s each.`;
    if (dn > 0 && dc.n === 0) status += ' Named diggers help whichever rooms have diggers, so put some on a room.';
    setText(this.digStatus, status);
    const scav = scavengerDig(s);
    const shown = new Set<string>();
    for (const def of ROOMS) {
      const row = this.roomRows.get(def.id)!;
      setHidden(row.li, !roomOpen(s, def));
      if (row.li.hidden) continue;
      shown.add(def.group);
      const vol = roomVolume(s, def.id);
      setText(row.size, `${formatNumber(vol)} cubic paces`);
      const cap = roomCapacity(s, def);
      let holds: string;
      if (def.holds === 'beds') holds = `${cap} beds, ${population(s)} taken`;
      else if (def.holds === 'herders') holds = `Fits ${cap} herders, ${workers(s, 'herder')} working`;
      else if (def.holds === 'smiths') holds = `Fits ${cap} blacksmiths, ${workers(s, 'blacksmith')} working`;
      else {
        const goods = storeGoods(s, def.id);
        holds = goods.length ? `Holds ${goods.map((g) => `${formatNumber(f[g.id].cap)} ${resName(g.id)}`).join(', ')}` : '';
      }
      setText(row.holds, holds);

      const n = diggersIn(s, def.id);
      setText(row.count, n > 0 ? `×${n} digging` : '');
      setDisabled(row.down, n < 1);
      setDisabled(row.up, s.idle < 1);
      const label = this.step === Infinity ? 'all' : String(this.step);
      row.down.title = `Send ${label} of its diggers back to idle`;
      row.up.title = `Put ${label} idle kobold${this.step === 1 ? '' : 's'} to digging the ${def.name.toLowerCase()}`;
      row.down.setAttribute('aria-label', `${def.name}: ${row.down.title}`);
      row.up.setAttribute('aria-label', `${def.name}: ${row.up.title}`);
      const paces = digRate(s, def.id) / workPerPace(vol);
      const digging = n > 0 || paces > 0;
      const blocked = digging ? digBlocked(s, def.id) : null;
      const supports = supportsFor(vol, s);
      const uses = supports.length ? ` Uses ${supports.map((x) => `${formatNumber(x.perPace)} ${resName(x.resource)}`).join(' and ')} per cubic pace to hold the ceiling up.` : '';
      const yields = Object.keys(digYields(vol, s)).map((r) => resName(r as ResourceId));
      const turnsUp = yields.length ? ` Turning up ${yields.join(' and ')} as it goes.` : '';
      const nextTier = DIG.supports.find((x) => x.fromPaces > vol);
      const later = nextTier ? ` From ${formatNumber(nextTier.fromPaces)} paces it also needs ${resName(nextTier.resource)}.` : '';
      let dig = '';
      if (digging) {
        if (blocked === 'full') dig = `As big as it can be dug for now.`;
        else if (blocked) dig = `Stalled: out of ${resName(blocked)}.${resourceOpen(s, blocked) ? '' : ' It has to be researched first.'}${uses}`;
        else if (paces <= 0) dig = `Waiting for diggers.${uses}${later}`;
        else dig = `Growing by about ${formatNumber(paces * 3600)} cubic paces an hour${def.id === 'hoard' && scav > 0 ? ', with the scavengers helping while it is full' : ''}.${turnsUp}${uses}${later}`;
      }
      setText(row.dig, dig);
      row.dig.classList.toggle('warn', digging && !!blocked);
    }
    for (const [g, head] of this.groupHeads) setHidden(head, !shown.has(g));
  }
}

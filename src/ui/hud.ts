// The DOM side panel. Updated once per economy tick, and only the bits of
// text that changed are written, so it costs next to nothing.

import { CREW, DRAGON_STAGES, IDLE, JOBS, RESOURCES, ROOMS, UPGRADES, type ResourceId, type UpgradeDef } from '../game/data';
import { animalsOpen, setHerd } from '../game/dragon';
import {
  appeal,
  arrivalSeconds,
  assign,
  beds,
  buyUpgrade,
  canAfford,
  crew,
  digBlocked,
  digRate,
  digWork,
  flows,
  herdersFit,
  incomePerSecond,
  jobHints,
  jobOpen,
  jobOutput,
  namedInJob,
  perKobold,
  population,
  recipesOpen,
  resourceDef,
  resourceOpen,
  roomCapacity,
  roomExtent,
  roomOpen,
  setDigging,
  setRecipe,
  storehouseGoods,
  supportsFor,
  upgradeVisible,
  veteranBonus,
  veteranLabel,
  recipeRatio,
  workers,
} from '../game/economy';
import type { GameState } from '../game/state';
import { $, setDisabled, setText } from './dom';
import { formatDuration, formatNumber } from './format';

export type HudEvent =
  | { kind: 'assign'; job: string; moved: number }
  | { kind: 'newcomers'; job: string }
  | { kind: 'dig'; room: string | null }
  | { kind: 'herd'; animal: string }
  | { kind: 'recipe'; id: string }
  | { kind: 'upgrade'; id: string };

const STEPS = [1, 5, 20, Infinity];
const resName = (id: ResourceId) => resourceDef(id).name.toLowerCase();

export function costText(cost: UpgradeDef['cost']): string {
  return Object.entries(cost)
    .map(([r, n]) => `${formatNumber(n ?? 0)} ${resName(r as ResourceId)}`)
    .join(', ');
}

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
  vet: HTMLElement;
  rate: HTMLElement;
  hint: HTMLElement;
  down: HTMLButtonElement;
  up: HTMLButtonElement;
  extra?: HTMLSelectElement;
}

export class Hud {
  private copper = $('#copper');
  private rate = $('#rate');
  private stageName = $('#stage-name');
  private stageBar = $<HTMLDivElement>('#stage-bar > div');
  private stageText = $('#stage-text');
  private popCount = $('#pop-count');
  private popText = $('#pop-text');
  private step = 1;
  private resRows = new Map<ResourceId, { li: HTMLLIElement; amount: HTMLElement; rate: HTMLElement; note: HTMLElement }>();
  private jobRows = new Map<string, JobRow>();
  private idleCount!: HTMLElement;
  private newcomerSelect!: HTMLSelectElement;
  private roomRows = new Map<string, { li: HTMLLIElement; size: HTMLElement; holds: HTMLElement; bar: HTMLElement; barWrap: HTMLElement; dig: HTMLElement; btn: HTMLButtonElement }>();
  private upgradeKey = '';
  private upRows = new Map<string, HTMLButtonElement>();

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
  }

  private buildJobs() {
    const switcher = $('#step');
    for (const n of STEPS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'small';
      b.textContent = n === Infinity ? 'All' : String(n);
      b.setAttribute('aria-pressed', String(n === this.step));
      b.addEventListener('click', () => {
        this.step = n;
        switcher.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
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

    for (const def of JOBS) {
      const li = row(
        `<div class="row-main"><b></b> <span class="count"></span> <span class="vet"></span><div class="desc"></div><div class="sub"></div><div class="hint"></div></div><div class="job-buttons"><button type="button" class="small down">−</button><button type="button" class="small up">+</button></div>`,
      );
      li.querySelector('b')!.textContent = def.name;
      li.querySelector('.desc')!.textContent = def.description;
      const down = li.querySelector<HTMLButtonElement>('.down')!;
      const up = li.querySelector<HTMLButtonElement>('.up')!;
      down.addEventListener('click', () => this.move(def.id, -1));
      up.addEventListener('click', () => this.move(def.id, 1));
      const r: JobRow = { li, count: li.querySelector('.count')!, vet: li.querySelector('.vet')!, rate: li.querySelector('.sub')!, hint: li.querySelector('.hint')!, down, up };
      if (def.id === 'herder' || def.id === 'alchemist') {
        const wrap = document.createElement('div');
        wrap.className = 'desc newcomers';
        const label = document.createElement('label');
        label.textContent = def.id === 'herder' ? 'Raising ' : 'Making ';
        const sel = document.createElement('select');
        sel.id = `${def.id}-choice`;
        label.htmlFor = sel.id;
        wrap.append(label, sel);
        li.querySelector('.desc')!.after(wrap);
        sel.addEventListener('change', () => {
          const s = this.getState();
          if (def.id === 'herder' ? setHerd(s, sel.value) : setRecipe(s, sel.value))
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

  private buildRooms() {
    const list = $('#rooms');
    for (const def of ROOMS) {
      const li = row(
        `<div class="row-main"><b></b> <span class="count size"></span><div class="desc"></div><div class="sub holds"></div><div class="bar dig-bar"><div></div></div><div class="desc dig"></div></div><button type="button"></button>`,
      );
      li.querySelector('b')!.textContent = def.name;
      li.querySelector('.desc')!.textContent = def.description;
      const btn = li.querySelector('button')!;
      btn.addEventListener('click', () => {
        const s = this.getState();
        const next = s.digging === def.id ? null : def.id;
        if (setDigging(s, next)) this.onChange({ kind: 'dig', room: next });
      });
      this.roomRows.set(def.id, {
        li,
        size: li.querySelector('.size')!,
        holds: li.querySelector('.holds')!,
        barWrap: li.querySelector('.dig-bar')!,
        bar: li.querySelector('.dig-bar > div')!,
        dig: li.querySelector('.dig')!,
        btn,
      });
      list.append(li);
    }
  }

  // ---------- every tick ----------

  update() {
    const s = this.getState();
    setText(this.copper, formatNumber(s.res.copper));
    setText(this.rate, `${formatNumber(incomePerSecond(s))} / s`);

    setText(this.stageName, DRAGON_STAGES[s.stage].name);
    const hatchAt = DRAGON_STAGES[1].threshold ?? 0;
    if (s.stage === 0) {
      this.stageBar.parentElement!.hidden = false;
      this.stageBar.style.width = `${Math.min(100, (s.totalEarned / hatchAt) * 100).toFixed(1)}%`;
      setText(this.stageText, `Hatches at ${formatNumber(hatchAt)} copper buried (${formatNumber(s.totalEarned)} so far)`);
    } else {
      this.stageBar.parentElement!.hidden = true;
      setText(this.stageText, '');
    }

    this.updateResources(s);
    this.updateJobs(s);
    this.updateRooms(s);
    this.updateUpgrades(s);
  }

  private updateResources(s: GameState) {
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
      const by = fl.usedBy === 'digging' ? 'Digging' : fl.usedBy === 'alchemy' ? 'The alchemist' : 'The dragon';
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
    const open = JOBS.filter((j) => jobOpen(s, j));
    syncOptions(this.newcomerSelect, [[IDLE, 'Idle (wait for orders)'], ...open.map((j) => [j.id, j.name] as [string, string])], s.newcomerJob);

    const hints = jobHints(s);
    for (const def of JOBS) {
      const row = this.jobRows.get(def.id)!;
      setHidden(row.li, !jobOpen(s, def));
      if (row.li.hidden) continue;
      const c = crew(s, def.id);
      const stars = namedInJob(s, def.id);
      setText(row.count, `×${c.n}${stars ? ` + ${stars} named` : ''}`);
      const bonus = Math.round(veteranBonus(c.exp) * 100);
      const vet = veteranLabel(c.exp);
      setText(row.vet, c.n > 0 ? (vet === 'new crew' ? 'New crew' : `${vet} +${bonus}%`) : '');
      row.vet.title = c.n > 0 ? `Experience: a crew gets better the longer it works the same job, up to +${Math.round(CREW.maxBonus * 100)}%. This crew is at +${bonus}%.` : '';
      const each = perKobold(s, def);
      const what = def.produces ? resName(def.produces.resource) : def.digs ? 'digging' : def.researches ? 'research' : 'turned over';
      const total = jobOutput(s, def);
      setText(row.rate, workers(s, def.id) > 0 ? `${formatNumber(total)} ${what} / s (${formatNumber(each)} each)` : `${formatNumber(each)} ${what} / s each`);
      setText(row.hint, hints[def.id] ?? '');
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
      } else if (row.extra) syncOptions(row.extra, recipesOpen(s).map((x) => [x.id, `${x.name}, ${formatNumber(recipeRatio(s, x))} to 1`]), s.recipe);
    }
  }

  private updateRooms(s: GameState) {
    const rate = digRate(s);
    const blocked = digBlocked(s);
    const f = flows(s);
    for (const def of ROOMS) {
      const row = this.roomRows.get(def.id)!;
      setHidden(row.li, !roomOpen(s, def));
      if (row.li.hidden) continue;
      const room = s.rooms[def.id] ?? { size: 1, progress: 0 };
      const ext = roomExtent(s, def.id);
      setText(row.size, `size ${ext < room.size + 0.05 ? room.size : ext.toFixed(1)}`);
      const cap = roomCapacity(s, def);
      let holds: string;
      if (def.holds === 'copper') holds = `Holds ${formatNumber(cap)} copper`;
      else if (def.holds === 'beds') holds = `${cap} beds, ${population(s)} taken`;
      else if (def.holds === 'herders') holds = `Fits ${cap} herders, ${workers(s, 'herder')} working`;
      else if (def.holds === 'dragon') holds = s.stage === 0 ? 'Waiting for the dragon to hatch' : `The dragon grows into it`;
      else {
        const goods = storehouseGoods(s);
        holds = `Holds ${formatNumber(cap)}: ${formatNumber(f[goods[0].id].cap)} each of ${goods.map((g) => resName(g.id)).join(', ')}`;
      }
      setText(row.holds, holds);

      const digging = s.digging === def.id;
      const toSize = room.size + 1;
      const need = digWork(def, toSize);
      setHidden(row.barWrap, !digging && room.progress === 0);
      row.bar.style.width = `${Math.min(100, (room.progress / need) * 100).toFixed(1)}%`;
      const supports = supportsFor(toSize, s);
      const uses = supports.length ? ` Uses ${supports.map((x) => `${formatNumber(x.perWork)} ${resName(x.resource)}`).join(' and ')} per dig to hold the ceiling up.` : '';
      let dig = '';
      if (digging) {
        if (blocked) dig = `Stalled: out of ${resName(blocked)}.${resourceOpen(s, blocked) ? '' : ' It has to be researched first.'}${uses}`;
        else if (rate <= 0) dig = `Waiting for diggers.${uses}`;
        else dig = `Growing as it's dug. Size ${toSize} in about ${formatDuration((need - room.progress) / rate)}.${uses}`;
      }
      setText(row.dig, dig);
      row.dig.classList.toggle('warn', digging && !!blocked);
      setText(row.btn, digging ? 'Stop digging' : 'Dig here');
    }
  }

  private updateUpgrades(s: GameState) {
    const visible = UPGRADES.filter((u) => upgradeVisible(s, u));
    const key = visible.map((u) => u.id).join();
    if (key !== this.upgradeKey) {
      this.upgradeKey = key;
      this.upRows.clear();
      const tools = $('#upgrades');
      const displays = $('#displays');
      tools.replaceChildren();
      displays.replaceChildren();
      for (const u of visible) {
        const li = row(`<div class="row-main"><b></b><div class="desc"></div><div class="sub"></div></div><button type="button">Buy</button>`);
        li.querySelector('b')!.textContent = u.name;
        li.querySelector('.desc')!.textContent = u.description;
        li.querySelector('.sub')!.textContent = costText(u.cost);
        const btn = li.querySelector('button')!;
        btn.addEventListener('click', () => {
          if (buyUpgrade(this.getState(), u.id)) this.onChange({ kind: 'upgrade', id: u.id });
        });
        this.upRows.set(u.id, btn);
        (u.effect.kind === 'appeal' ? displays : tools).append(li);
      }
      $('#upgrades-section').hidden = tools.childElementCount === 0;
      $('#displays-section').hidden = displays.childElementCount === 0;
    }
    for (const u of visible) setDisabled(this.upRows.get(u.id)!, !canAfford(s, u.cost));
  }
}

// The DOM side panel. Updated once per economy tick, and only the bits of
// text that changed are written, so it costs next to nothing.

import { DRAGON_STAGES, IDLE, JOBS, RESOURCES, ROOMS, UPGRADES, type ResourceId, type UpgradeDef } from '../game/data';
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
  incomePerSecond,
  jobHints,
  perKobold,
  population,
  resourceDef,
  roomCapacity,
  setDigging,
  supportsFor,
  upgradeVisible,
  veteranBonus,
  veteranLabel,
  workers,
} from '../game/economy';
import type { GameState } from '../game/state';
import { $, setDisabled, setText } from './dom';
import { formatDuration, formatNumber } from './format';

export type HudEvent =
  | { kind: 'assign'; job: string; moved: number }
  | { kind: 'newcomers'; job: string }
  | { kind: 'dig'; room: string | null }
  | { kind: 'upgrade'; id: string };

const STEPS = [1, 5, 20, Infinity];
const resName = (id: ResourceId) => resourceDef(id).name.toLowerCase();

export function costText(cost: UpgradeDef['cost']): string {
  return Object.entries(cost)
    .map(([r, n]) => `${formatNumber(n ?? 0)} ${resName(r as ResourceId)}`)
    .join(', ');
}

function row(html: string): HTMLLIElement {
  const li = document.createElement('li');
  li.innerHTML = html;
  return li;
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
  private resRows = new Map<ResourceId, { amount: HTMLElement; rate: HTMLElement; note: HTMLElement }>();
  private jobRows = new Map<string, { count: HTMLElement; vet: HTMLElement; rate: HTMLElement; hint: HTMLElement; down: HTMLButtonElement; up: HTMLButtonElement }>();
  private idleCount!: HTMLElement;
  private newcomerSelect!: HTMLSelectElement;
  private roomRows = new Map<string, { size: HTMLElement; holds: HTMLElement; bar: HTMLElement; barWrap: HTMLElement; dig: HTMLElement; btn: HTMLButtonElement }>();
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
      this.resRows.set(r.id, { amount: li.querySelector('.amount')!, rate: li.querySelector('.res-rate')!, note: li.querySelector('.note')! });
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
    for (const [id, name] of [[IDLE, 'Idle (wait for orders)'] as const, ...JOBS.map((j) => [j.id, j.name] as const)]) {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = name;
      this.newcomerSelect.append(o);
    }
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
      this.jobRows.set(def.id, {
        count: li.querySelector('.count')!,
        vet: li.querySelector('.vet')!,
        rate: li.querySelector('.sub')!,
        hint: li.querySelector('.hint')!,
        down,
        up,
      });
      list.append(li);
    }
  }

  private move(job: string, dir: 1 | -1) {
    const s = this.getState();
    const k = this.step === Infinity ? (dir > 0 ? s.idle : workers(s, job)) : this.step;
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

    const stage = DRAGON_STAGES[s.stage];
    const next = DRAGON_STAGES[s.stage + 1];
    setText(this.stageName, stage.name);
    if (next) {
      const pct = Math.min(100, ((s.totalEarned - stage.threshold) / (next.threshold - stage.threshold)) * 100);
      this.stageBar.style.width = `${pct.toFixed(1)}%`;
      const verb = s.stage === 0 ? 'Hatches' : `Grows into ${next.name.toLowerCase()}`;
      setText(this.stageText, `${verb} at ${formatNumber(next.threshold)} copper buried (${formatNumber(s.totalEarned)} so far)`);
    } else {
      this.stageBar.style.width = '100%';
      setText(this.stageText, `${formatNumber(s.totalEarned)} copper buried in all`);
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
      const fl = f[r.id];
      setText(row.amount, `${formatNumber(fl.held)} / ${formatNumber(fl.cap)}`);
      const net = fl.in - fl.out;
      setText(row.rate, fl.in === 0 && fl.out === 0 ? '' : `${net >= 0 ? '+' : '−'}${formatNumber(Math.abs(net))} / s`);
      row.rate.classList.toggle('warn', net < 0);
      let note = '';
      if (fl.held >= fl.cap && fl.in > 0) note = 'Full. Anything more is lost until the room is dug bigger.';
      else if (fl.out > 0 && net < 0)
        note = fl.held < 1 ? `Digging needs ${formatNumber(fl.out)} / s and has stalled.` : `Digging uses ${formatNumber(fl.out)} / s. Runs out in ${formatDuration(fl.held / -net)}.`;
      else if (fl.out > 0) note = `Digging uses ${formatNumber(fl.out)} / s.`;
      else if (fl.in > 0 && fl.held < fl.cap) note = `Full in ${formatDuration((fl.cap - fl.held) / fl.in)}.`;
      setText(row.note, note);
      row.note.classList.toggle('warn', fl.held >= fl.cap && fl.in > 0);
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
    if (this.newcomerSelect.value !== s.newcomerJob) this.newcomerSelect.value = s.newcomerJob;

    const hints = jobHints(s);
    for (const def of JOBS) {
      const row = this.jobRows.get(def.id)!;
      const c = crew(s, def.id);
      setText(row.count, `×${c.n}`);
      setText(row.vet, c.n > 0 ? `${veteranLabel(c.exp)} +${Math.round(veteranBonus(c.exp) * 100)}%` : '');
      const each = perKobold(s, def);
      const what = def.produces ? `${resName(def.produces.resource)}` : 'digging';
      setText(row.rate, c.n > 0 ? `${formatNumber(each * c.n)} ${what} / s (${formatNumber(each)} each)` : `${formatNumber(each)} ${what} / s each`);
      setText(row.hint, hints[def.id] ?? '');
      setDisabled(row.down, c.n < 1);
      setDisabled(row.up, s.idle < 1);
      const label = this.step === Infinity ? 'all' : String(this.step);
      row.down.title = `Send ${label} back to idle`;
      row.up.title = `Put ${label} idle kobold${this.step === 1 ? '' : 's'} on this job`;
      row.down.setAttribute('aria-label', `${def.name}: ${row.down.title}`);
      row.up.setAttribute('aria-label', `${def.name}: ${row.up.title}`);
    }
  }

  private updateRooms(s: GameState) {
    const rate = digRate(s);
    const blocked = digBlocked(s);
    const f = flows(s);
    for (const def of ROOMS) {
      const row = this.roomRows.get(def.id)!;
      const room = s.rooms[def.id];
      setText(row.size, `size ${room.size}`);
      const cap = roomCapacity(s, def);
      let holds: string;
      if (def.holds === 'copper') holds = `Holds ${formatNumber(cap)} copper`;
      else if (def.holds === 'beds') holds = `${cap} beds, ${population(s)} taken`;
      else {
        const goods = RESOURCES.filter((r) => r.store === 'storehouse');
        holds = `Holds ${formatNumber(cap)}: ${formatNumber(f[goods[0].id].cap)} each of ${goods.map((g) => resName(g.id)).join(' and ')}`;
      }
      setText(row.holds, holds);

      const digging = s.digging === def.id;
      const toSize = room.size + 1;
      const need = digWork(def, toSize);
      row.barWrap.hidden = !digging && room.progress === 0;
      row.bar.style.width = `${Math.min(100, (room.progress / need) * 100).toFixed(1)}%`;
      const supports = supportsFor(toSize);
      const uses = supports.length ? ` Needs ${supports.map((x) => `${x.perWork} ${resName(x.resource)}`).join(' and ')} per dig to hold the ceiling up.` : '';
      let dig = '';
      if (digging) {
        if (blocked) dig = `Stalled: out of ${resName(blocked)}.${uses}`;
        else if (rate <= 0) dig = `Waiting for diggers.${uses}`;
        else dig = `Digging to size ${toSize}, about ${formatDuration((need - room.progress) / rate)} left.${uses}`;
      } else if (room.progress > 0) dig = `Partly dug toward size ${toSize}.`;
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

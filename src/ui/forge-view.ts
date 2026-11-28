// The forge: one row per anvil, each with an order and how it's going, then
// the tool rack and a table of which jobs have what, with a star to put one
// job first in line.

import { bestTier, forgeOpen, forgeRate, orderOptions, rackCount, setOrder, setToolFirst, slotBlocked, smithsFit, spareTools, syncSlots, TIERS, toolAllocation, toolJobs, toolLine, unitFor } from '../game/forge';
import { jobDef, workers } from '../game/economy';
import type { GameState } from '../game/state';
import { $, setText } from './dom';
import { formatDuration, formatNumber } from './format';
import { costText, row, syncOptions } from './hud';

const NOTHING = '';

export class ForgeView {
  private section = $('#forge-section');
  private list = $('#forge-slots');
  private status = $('#forge-status');
  private rows: { select: HTMLSelectElement; bar: HTMLElement; sub: HTMLElement }[] = [];
  private toolsStatus = $('#tools-status');
  private toolsList = $('#tools-table');
  private toolRows = new Map<string, { li: HTMLLIElement; line: HTMLElement; star: HTMLButtonElement }>();

  constructor(
    private getState: () => GameState,
    private onChange: (slot: number, order: string | null) => void,
  ) {}

  update() {
    const s = this.getState();
    this.section.hidden = !forgeOpen(s);
    if (this.section.hidden) return;
    syncSlots(s);
    const rate = forgeRate(s);
    const busy = s.forge.slots.filter((x) => x.order).length;
    const smiths = workers(s, 'blacksmith');
    let status: string;
    if (smiths === 0) status = 'Put some kobolds on the blacksmith job to start.';
    else status = `${formatNumber(rate)} forge work / s${busy > 1 ? `, split between ${busy} anvils` : ''}.`;
    if (smiths > smithsFit(s)) status += ` The forge only fits ${smithsFit(s)} blacksmiths. Dig it bigger.`;
    setText(this.status, status);

    if (this.rows.length !== s.forge.slots.length) {
      this.rows = [];
      this.list.replaceChildren(
        ...s.forge.slots.map((_, i) => {
          const li = row(`<div class="row-main"><b></b> <select></select><div class="sub"></div><div class="bar"><div></div></div></div>`);
          li.querySelector('b')!.textContent = `Anvil ${i + 1}`;
          const select = li.querySelector('select')!;
          select.setAttribute('aria-label', `Anvil ${i + 1} order`);
          select.addEventListener('change', () => {
            const order = select.value === NOTHING ? null : select.value;
            if (setOrder(this.getState(), i, order)) this.onChange(i, order);
          });
          this.rows.push({ select, bar: li.querySelector('.bar > div')!, sub: li.querySelector('.sub')! });
          return li;
        }),
      );
    }
    const options: [string, string][] = [[NOTHING, 'Nothing'], ...orderOptions(s).map((o): [string, string] => {
      const u = unitFor(s, o.id);
      return [o.id, u ? `${o.name} (${costText(u.cost)})` : o.name];
    })];
    s.forge.slots.forEach((slot, i) => {
      const r = this.rows[i];
      syncOptions(r.select, options, slot.order ?? NOTHING);
      const unit = unitFor(s, slot.order);
      const blocked = slotBlocked(s, slot);
      r.bar.style.width = unit ? `${Math.min(100, (slot.progress / unit.work) * 100).toFixed(1)}%` : '0';
      const share = busy ? rate / busy : 0;
      let sub = '';
      if (!slot.order) sub = 'Idle.';
      else if (blocked) sub = blocked;
      else if (unit) sub = `Making ${unit.label}.${share > 0 ? ` Next in about ${formatDuration(Math.max(1, (unit.work - slot.progress) / share))}.` : ''}`;
      // what each one costs, and how many an hour at this pace
      if (unit) sub += ` Each uses ${costText(unit.cost)}${share > 0 ? `; about ${formatNumber((share / unit.work) * 3600)} an hour` : ''}.`;
      setText(r.sub, sub);
      r.sub.classList.toggle('warn', !!blocked);
    });
    this.updateTools(s);
  }

  private updateTools(s: GameState) {
    const alloc = toolAllocation(s);
    const spare = spareTools(s, alloc);
    const tier = bestTier(s);
    const spareText = [...TIERS].reverse().filter((t) => spare[t.id]).map((t) => `${formatNumber(spare[t.id]!)} ${t.name.toLowerCase()}`).join(', ');
    let status = rackCount(s) === 0 ? 'The rack is empty. Set an anvil to Tools.' : spareText ? `Rack: ${spareText} spare.` : 'Rack: every tool is in use, none spare.';
    if (tier) status += ` The forge makes ${tier.name.toLowerCase()} tools, and keeps making them while there's metal and wood. Spares replace worn-out tools at once.`;
    status += s.toolFirst ? ` ${jobDef(s.toolFirst)?.name ?? s.toolFirst}s get tools first.` : ' Tools are shared out evenly. Star a job to put it first in line.';
    setText(this.toolsStatus, status);

    // only jobs with someone working, plus the starred one, so the table stays short
    const jobs = toolJobs(s).filter((j) => workers(s, j) > 0 || s.toolFirst === j);
    for (const job of jobs) {
      if (this.toolRows.has(job)) continue;
      const li = row(`<div class="row-main"><b></b><div class="sub"></div></div><button type="button" class="small star" aria-pressed="false">★</button>`);
      const name = `${jobDef(job)!.name}s`;
      li.querySelector('b')!.textContent = name;
      const star = li.querySelector<HTMLButtonElement>('.star')!;
      star.addEventListener('click', () => {
        const st = this.getState();
        if (setToolFirst(st, st.toolFirst === job ? null : job)) this.onChange(-1, null);
      });
      this.toolRows.set(job, { li, line: li.querySelector('.sub')!, star });
    }
    const want = jobs.map((j) => this.toolRows.get(j)!.li);
    if (want.length !== this.toolsList.children.length || want.some((li, i) => this.toolsList.children[i] !== li)) this.toolsList.replaceChildren(...want);
    for (const job of jobs) {
      const r = this.toolRows.get(job)!;
      setText(r.line, toolLine(s, job, alloc));
      const first = s.toolFirst === job;
      r.star.setAttribute('aria-pressed', String(first));
      r.star.title = first ? 'First in line for tools. Click to share evenly again.' : 'Put this job first in line for tools';
      r.star.setAttribute('aria-label', `${jobDef(job)!.name}s: ${r.star.title}`);
    }
  }
}

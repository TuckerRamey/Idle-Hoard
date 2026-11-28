// The forge: one row per anvil, each with an order and how it's going.

import { forgeOpen, forgeRate, orderOptions, setOrder, slotBlocked, smithsFit, syncSlots, unitFor } from '../game/forge';
import { workers } from '../game/economy';
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
    status += ' Only the best tools the forge knows are made; older ones are used until they wear out.';
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
  }
}

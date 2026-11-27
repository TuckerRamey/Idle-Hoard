// The research list: what the lab could work on next, and what it's on now.

import { researchRate } from '../game/economy';
import { availableResearch, chooseResearch, researchDef } from '../game/research';
import type { GameState } from '../game/state';
import { $, setText } from './dom';
import { formatDuration, formatNumber } from './format';
import { row } from './hud';

export class ResearchView {
  private section = $('#research-section');
  private list = $('#research');
  private status = $('#research-status');
  private key = '';
  private bars = new Map<string, { bar: HTMLElement; btn: HTMLButtonElement; sub: HTMLElement }>();

  constructor(
    private getState: () => GameState,
    private onChoose: (id: string | null) => void,
  ) {}

  update() {
    const s = this.getState();
    const avail = availableResearch(s);
    this.section.hidden = avail.length === 0 && s.research.done.length === 0;
    const rate = researchRate(s);
    const cur = s.research.current ? researchDef(s.research.current) : undefined;
    let status: string;
    if (rate <= 0) status = 'Put some kobolds on research to start.';
    else if (!cur) status = `${formatNumber(rate)} research / s, with nothing chosen. Points are kept for later.`;
    else status = `${formatNumber(rate)} research / s. ${cur.name} done in about ${formatDuration(Math.max(0, cur.cost - s.research.progress) / rate)}.`;
    if (!avail.length) status = 'Everything known has been worked out, for now.';
    setText(this.status, `${status} ${s.research.done.length} discoveries so far.`);

    const key = avail.map((r) => r.id).join() + '|' + s.research.current;
    if (key !== this.key) {
      this.key = key;
      this.bars.clear();
      this.list.replaceChildren(
        ...avail.map((r) => {
          const li = row(`<div class="row-main"><b></b><div class="desc"></div><div class="sub"></div><div class="bar"><div></div></div></div><button type="button"></button>`);
          li.querySelector('b')!.textContent = r.name;
          li.querySelector('.desc')!.textContent = r.description;
          const btn = li.querySelector('button')!;
          const on = s.research.current === r.id;
          btn.textContent = on ? 'Stop' : 'Research';
          btn.addEventListener('click', () => {
            const st = this.getState();
            const next = st.research.current === r.id ? null : r.id;
            if (chooseResearch(st, next)) this.onChoose(next);
          });
          const wrap = li.querySelector<HTMLElement>('.bar')!;
          wrap.hidden = !on;
          this.bars.set(r.id, { bar: li.querySelector('.bar > div')!, btn, sub: li.querySelector('.sub')! });
          return li;
        }),
      );
    }
    for (const r of avail) {
      const b = this.bars.get(r.id)!;
      const on = s.research.current === r.id;
      b.bar.style.width = on ? `${Math.min(100, (s.research.progress / r.cost) * 100).toFixed(1)}%` : '0';
      setText(b.sub, on ? `${formatNumber(Math.min(s.research.progress, r.cost))} / ${formatNumber(r.cost)} research` : `${formatNumber(r.cost)} research`);
    }
  }
}

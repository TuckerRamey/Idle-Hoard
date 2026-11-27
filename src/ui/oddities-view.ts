// The oddities shelf. Only oddities you've found are listed.

import { ODDITIES, oddityText } from '../game/oddities';
import type { GameState } from '../game/state';
import { timeAgo } from './chronicle';
import { $ } from './dom';

export class OdditiesView {
  private section = $('#oddities-section');
  private list = $('#oddities');
  private count = $('#oddities-count');
  private key = '';

  constructor(private getState: () => GameState) {}

  update(now: number) {
    const s = this.getState();
    const found = ODDITIES.filter((o) => s.oddities[o.id]).sort((a, b) => s.oddities[b.id].firstAt - s.oddities[a.id].firstAt);
    const key = found.map((o) => `${o.id}:${s.oddities[o.id].count}`).join() + '|' + Math.floor(now / 60000);
    if (key === this.key) return;
    this.key = key;
    this.section.hidden = found.length === 0;
    this.count.textContent = String(found.length);
    this.list.replaceChildren(
      ...found.map((o) => {
        const rec = s.oddities[o.id];
        const li = document.createElement('li');
        li.innerHTML = '<div class="row-main"><b></b><div class="desc"></div><div class="sub"></div></div>';
        li.querySelector('b')!.textContent = o.stacks ? `${o.name} ×${rec.count.toLocaleString('en-US')}` : o.name;
        li.querySelector('.desc')!.textContent = oddityText(o, rec.count);
        li.querySelector('.sub')!.textContent = `First found ${timeAgo(now - rec.firstAt)}`;
        return li;
      }),
    );
  }
}

// The colonies: small places founded by named kobolds, which run themselves,
// grow slowly and send tribute to the hoard. Nothing to manage; just stories.

import { COLONY, coloniesOpen, tributeRate } from '../game/colonies';
import { fullName } from '../game/kobolds';
import type { GameState } from '../game/state';
import { timeAgo } from './chronicle';
import { $, setText } from './dom';
import { formatNumber } from './format';

export class ColoniesView {
  private section = $('#colonies-section');
  private status = $('#colonies-status');
  private list = $('#colonies');
  private key = '';

  constructor(private getState: () => GameState) {}

  update(now: number) {
    const s = this.getState();
    this.section.hidden = !coloniesOpen(s) && s.colonies.length === 0;
    if (this.section.hidden) return;
    setText(
      this.status,
      s.colonies.length
        ? `${s.colonies.length} ${s.colonies.length === 1 ? 'colony sends' : 'colonies send'} tribute to the hoard. They run themselves.`
        : `A named kobold with ${COLONY.experiences} experiences can leave with ${COLONY.settlers} kobolds to found a colony, from their card. Colonies run themselves, grow slowly and send tribute to the hoard.`,
    );
    const key = s.colonies.map((c) => `${c.id}:${Math.floor(c.pop)}:${c.history.length}:${c.history.at(-1)?.t}`).join('|') + `|${Math.floor(now / 60000)}`;
    if (key === this.key) return;
    this.key = key;
    const open = new Set([...this.list.querySelectorAll('details[open]')].map((d) => (d as HTMLElement).dataset.id));
    this.list.replaceChildren(
      ...s.colonies.map((c) => {
        const li = document.createElement('li');
        li.className = 'colony';
        li.innerHTML = '<details><summary><b></b> <span class="desc"></span></summary><div class="desc lead"></div><ul class="history"></ul></details>';
        const det = li.querySelector('details')!;
        det.dataset.id = String(c.id);
        det.open = open.has(String(c.id));
        li.querySelector('b')!.textContent = c.name;
        const r = tributeRate(s, c);
        const perHour = (r.copper + r.silver * 10) * 3600;
        li.querySelector('summary .desc')!.textContent = `${Math.floor(c.pop)} kobolds, about ${formatNumber(perHour)} copper's worth an hour`;
        li.querySelector('.lead')!.textContent = `Led by ${fullName(c.leader)}. Founded ${timeAgo(now - c.founded)}; ${formatNumber(c.sent)} copper's worth sent so far.`;
        const hist = li.querySelector('.history')!;
        for (const h of [...c.history].reverse()) {
          const item = document.createElement('li');
          const when = document.createElement('span');
          when.className = 'when';
          when.textContent = timeAgo(now - h.t);
          item.append(h.text, ' ', when);
          hist.append(item);
        }
        return li;
      }),
    );
  }
}

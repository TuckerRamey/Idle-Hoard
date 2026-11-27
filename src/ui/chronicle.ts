// The chronicle: a short story log of what happened, newest first.

import type { GameState } from '../game/state';
import { $ } from './dom';

const SHOWN = 6;

export function timeAgo(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export class ChronicleView {
  private list = $('#chronicle');
  private key = '';

  constructor(private getState: () => GameState) {}

  update(now: number) {
    const entries = this.getState().chronicle.slice(-SHOWN).reverse();
    // re-render when entries change, or once a minute so the "ago" labels stay right
    const key = `${entries.length}|${entries[0]?.t}|${entries[0]?.text}|${Math.floor(now / 60000)}`;
    if (key === this.key) return;
    this.key = key;
    this.list.replaceChildren(
      ...entries.map((e, i) => {
        const li = document.createElement('li');
        if (i === 0) li.className = 'latest';
        const when = document.createElement('span');
        when.className = 'when';
        when.textContent = timeAgo(now - e.t);
        li.append(e.text, ' ', when);
        return li;
      }),
    );
  }
}

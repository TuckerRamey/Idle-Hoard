// The tabbed panel: copper, the dragon and the goal stay pinned above; the
// rest is split into tabs. A tab only shows once it has something in it, a
// dot marks one with news you haven't looked at, and the chosen tab is
// remembered in this browser.

import { canPromote } from '../game/kobolds';
import type { GameState } from '../game/state';
import { $ } from './dom';

export type TabId = 'kobolds' | 'rooms' | 'stores' | 'research' | 'forge' | 'chief' | 'warren';

const TABS: { id: TabId; name: string }[] = [
  { id: 'kobolds', name: 'Kobolds' },
  { id: 'rooms', name: 'Rooms' },
  { id: 'stores', name: 'Stores' },
  { id: 'research', name: 'Research' },
  { id: 'forge', name: 'Forge' },
  { id: 'chief', name: 'Chief' },
  { id: 'warren', name: 'Warren' },
];

const STORE_KEY = 'idle-hoard-tab';

/** Something worth a dot when it changes: new names, finished projects, a Chief who can grow... */
function newsKey(s: GameState, tab: TabId): string {
  switch (tab) {
    case 'kobolds':
      return `${s.named.length}|${s.named.filter((k) => k.epithet).length}|${s.named.filter((k) => canPromote(s, k)).length}`;
    case 'research':
      return `${s.research.done.length}|${s.research.current ? '' : 'idle'}`;
    case 'forge':
      return `${s.art.pieces.length}|${s.forge.slots.filter((x) => !x.order).length}`;
    case 'warren':
      return `${s.colonies.length}|${s.colonies.reduce((a, c) => a + c.history.length, 0)}|${Object.keys(s.oddities).length}`;
    case 'chief':
      return document.querySelector('#chief-grow')?.hasAttribute('hidden') ? '' : 'grow';
    default:
      return '';
  }
}

/** Does this panel have anything showing in it? */
function hasContent(panel: HTMLElement): boolean {
  for (const el of panel.children) if (!(el as HTMLElement).hidden && !(el as HTMLElement).dataset.filler) return true;
  return false;
}

export class TabsView {
  private nav = $('#tabs');
  private buttons = new Map<TabId, HTMLButtonElement>();
  private panels = new Map<TabId, HTMLElement>();
  private seen = new Map<TabId, string>();
  private news = new Set<TabId>();
  private active: TabId;

  constructor(private getState: () => GameState) {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(STORE_KEY);
    } catch {
      /* no storage: start on the first tab */
    }
    this.active = TABS.some((t) => t.id === saved) ? (saved as TabId) : 'kobolds';
    for (const t of TABS) {
      const panel = document.querySelector<HTMLElement>(`.tab-panel[data-tab="${t.id}"]`)!;
      panel.id = `tab-${t.id}`;
      panel.setAttribute('role', 'tabpanel');
      this.panels.set(t.id, panel);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tab';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-controls', panel.id);
      b.innerHTML = '<span class="tab-name"></span><span class="dot" aria-hidden="true"></span>';
      b.querySelector('.tab-name')!.textContent = t.name;
      b.addEventListener('click', () => this.choose(t.id));
      this.buttons.set(t.id, b);
      this.nav.append(b);
    }
  }

  choose(id: TabId) {
    this.active = id;
    this.news.delete(id);
    try {
      localStorage.setItem(STORE_KEY, id);
    } catch {
      /* fine */
    }
    this.update();
    this.buttons.get(id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  update() {
    const s = this.getState();
    this.nav.hidden = !s.chief;
    const shown = TABS.filter((t) => hasContent(this.panels.get(t.id)!)).map((t) => t.id);
    // a remembered tab that isn't there yet falls back to the first one
    const active = shown.includes(this.active) ? this.active : (shown[0] ?? 'kobolds');
    for (const t of TABS) {
      const key = newsKey(s, t.id);
      const before = this.seen.get(t.id);
      if (before !== undefined && before !== key && t.id !== active) this.news.add(t.id);
      this.seen.set(t.id, key);
      if (t.id === active) this.news.delete(t.id);
      const b = this.buttons.get(t.id)!;
      const on = t.id === active;
      if (b.hidden !== !shown.includes(t.id)) b.hidden = !shown.includes(t.id);
      b.setAttribute('aria-selected', String(on));
      b.classList.toggle('on', on);
      b.classList.toggle('news', this.news.has(t.id));
      b.title = this.news.has(t.id) ? `${t.name}: something new` : t.name;
      const panel = this.panels.get(t.id)!;
      // before the Chief exists everything shows as it always did (the form is up top)
      const hide = !!s.chief && !on;
      if (panel.classList.contains('off') !== hide) panel.classList.toggle('off', hide);
    }
  }
}

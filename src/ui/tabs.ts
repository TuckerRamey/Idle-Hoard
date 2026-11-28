// The tabbed panel: copper, the dragon and the goal stay pinned above; the
// rest is split into tabs. A tab only shows once it has something in it, a
// dot marks one with news you haven't looked at, and the chosen tab is
// remembered in this browser. Settings has no tab: the gear by the copper opens it.

import { canPromote } from '../game/kobolds';
import type { GameState } from '../game/state';
import { $ } from './dom';

export type TabId = 'leaders' | 'colonies' | 'oddities' | 'kobolds' | 'rooms' | 'stores' | 'research' | 'forge' | 'settings';

/** Two rows: the warren's leaders and wider world on top, the day-to-day work below. */
const TABS: { id: TabId; name: string; row: 0 | 1 }[] = [
  { id: 'leaders', name: 'Leadership', row: 0 },
  { id: 'colonies', name: 'Colonies', row: 0 },
  { id: 'oddities', name: 'Oddities', row: 0 },
  { id: 'kobolds', name: 'Gathering', row: 1 },
  { id: 'rooms', name: 'Rooms', row: 1 },
  { id: 'stores', name: 'Stores', row: 1 },
  { id: 'research', name: 'Research', row: 1 },
  { id: 'forge', name: 'Forge', row: 1 },
  // opened from the gear by the copper, so it has no tab of its own
  { id: 'settings', name: 'Settings', row: 1 },
];

const STORE_KEY = 'idle-hoard-tab';

/** Something worth a dot when it changes: new names, finished projects, a Chief who can grow... */
function newsKey(s: GameState, tab: TabId): string {
  switch (tab) {
    case 'research':
      return `${s.research.done.length}|${s.research.current ? '' : 'idle'}`;
    case 'forge':
      return `${s.art.pieces.length}|${s.forge.slots.filter((x) => !x.order).length}`;
    case 'colonies':
      return `${s.colonies.length}|${s.colonies.reduce((a, c) => a + c.history.length, 0)}`;
    case 'oddities':
      return `${Object.keys(s.oddities).length}`;
    case 'leaders':
      return `${document.querySelector('#chief-grow')?.hasAttribute('hidden') ? '' : 'grow'}|${s.named.length}|${s.named.filter((k) => k.epithet).length}|${s.named.filter((k) => canPromote(s, k)).length}`;
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
    this.active = saved !== 'settings' && TABS.some((t) => t.id === saved) ? (saved as TabId) : 'kobolds';
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
      this.nav.querySelectorAll('.tabs')[t.row].append(b);
    }
  }

  /** The gear opens settings; pressing it again goes back where you were. */
  toggleSettings() {
    this.choose(this.active === 'settings' ? this.before : 'settings');
  }
  private before: TabId = 'kobolds';

  choose(id: TabId) {
    if (id === 'settings' && this.active !== 'settings') this.before = this.active;
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
    // the top row only shows once one of its tabs has something
    const top = this.nav.querySelectorAll<HTMLElement>('.tabs')[0];
    const topShown = TABS.some((t) => t.row === 0 && hasContent(this.panels.get(t.id)!));
    if (top.hidden !== !topShown) top.hidden = !topShown;
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
      const showBtn = shown.includes(t.id) && t.id !== 'settings';
      if (b.hidden !== !showBtn) b.hidden = !showBtn;
      b.setAttribute('aria-selected', String(on));
      b.classList.toggle('on', on);
      b.classList.toggle('news', this.news.has(t.id));
      b.title = this.news.has(t.id) ? `${t.name}: something new` : t.name;
      const panel = this.panels.get(t.id)!;
      // before the Chief exists everything shows as it always did (the form is up top)
      const hide = !!s.chief && !on;
      if (panel.classList.contains('off') !== hide) panel.classList.toggle('off', hide);
    }
    document.querySelector('#settings-open')?.setAttribute('aria-pressed', String(active === 'settings'));
  }
}

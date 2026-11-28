// The Explore panel on the Gathering tab: what the scouts are looking for,
// how close the next find is, and every area found so far with how much of
// it is being worked.

import {
  areaMix,
  areaName,
  exploreBlocked,
  exploreKinds,
  exploreRate,
  EXPLORE,
  fills,
  findCost,
  KINDS,
  kindDef,
  setExploreTarget,
  type AreaKind,
} from '../game/areas';
import { resourceDef, resourceOpen, workers } from '../game/economy';
import type { ResourceId } from '../game/data';
import { monsterDef } from '../game/hunting';
import type { GameState } from '../game/state';
import { $, setText } from './dom';
import { formatDuration, formatNumber } from './format';
import { row, syncOptions } from './hud';

const NOBODY = '';
const LOOK_FOR: Record<AreaKind, string> = { wood: 'Woodland', stone: 'Stone', copper: 'Copper', monsters: 'Monsters' };

export class ExploreView {
  private section = $('#explore-section');
  private select = $('#explore-target') as HTMLSelectElement;
  private status = $('#explore-status');
  private bar = $('#explore-bar > div');
  private list = $('#areas');
  private key = '';

  constructor(
    private getState: () => GameState,
    private onChange: () => void,
  ) {
    this.select.addEventListener('change', () => {
      const v = this.select.value === NOBODY ? null : (this.select.value as AreaKind);
      if (setExploreTarget(this.getState(), v)) this.onChange();
    });
  }

  update() {
    const s = this.getState();
    this.section.hidden = !s.chief;
    if (this.section.hidden) return;
    syncOptions(this.select, [[NOBODY, 'Nothing'], ...exploreKinds(s).map((k): [string, string] => [k, LOOK_FOR[k]])], s.explore.target ?? NOBODY);

    const kind = s.explore.target;
    const rate = exploreRate(s);
    let status: string;
    let pct = 0;
    if (!kind) status = 'The scouts are told to look for nothing, so they sit about.';
    else if (exploreBlocked(s, kind)) status = exploreBlocked(s, kind)!;
    else {
      const cost = findCost(s, kind);
      const have = s.explore.points[kind] ?? 0;
      pct = Math.min(100, (have / cost) * 100);
      if (workers(s, 'scout') === 0) status = 'Put some kobolds on scouting to start.';
      else {
        status = `${formatNumber(rate)} exploring / s. The next find is about ${formatDuration(Math.max(1, (cost - have) / Math.max(rate, 1e-9)))} away.`;
        if (resourceOpen(s, 'meat')) status += s.res.meat < 1 ? ' Out of meat for provisions, so the scouts go at half pace.' : ` Provisions: about ${formatNumber(rate * EXPLORE.meatPerPoint * 3600)} meat an hour.`;
      }
    }
    setText(this.status, status);
    this.bar.style.width = `${pct.toFixed(1)}%`;

    // found areas, by kind; rebuilt only when what's found or worked changes
    const sections: { head: string; lines: { name: string; text: string }[] }[] = [];
    for (const k of KINDS) {
      const f = fills(s, k.id);
      if (!f.fills.length) continue;
      const lines = f.fills.map((x) => {
        if (!x.area) return { name: 'The old workings', text: `${formatNumber(x.used)} of ${formatNumber(x.cap)} ${unit(k.id)} / s. Room the warren already had.` };
        const a = x.area;
        const name = areaName(s, a);
        if (k.id === 'monsters') {
          const kills = (x.used * 3600) / (a.killWork ?? 1);
          const who = (a.monsters ?? []).map((m) => monsterDef(m)?.plural ?? m).join(', ');
          return { name, text: `${formatNumber(kills)} of ${a.cap} kills an hour. ${who[0].toUpperCase()}${who.slice(1)}${a.meatMult ? ', bigger than usual' : ''}.` };
        }
        const mix = Object.entries(areaMix(s, a)) as [ResourceId, number][];
        const gives = mix.length > 1 ? ` Gives ${mix.map(([r, n]) => `${Math.round(n * 100)}% ${resourceDef(r).name.toLowerCase()}`).join(', ')}.` : '';
        const extra = a.extras?.amber ? ' Amber now and then.' : a.extras?.mana ? ' A little mana for the shamans.' : a.extras?.mithril ? ' Mithril now and then.' : a.extras?.adamant ? ' Adamant, very rarely.' : a.extras?.weapon ? ' Old weapons now and then.' : a.luck ? ' Rare finds three times as likely.' : '';
        return { name, text: `${formatNumber(x.used)} of ${a.cap} ${unit(k.id)} / s.${gives}${extra}` };
      });
      sections.push({ head: `${kindDef(k.id).name} · ${f.fills.filter((x) => x.area).length} found`, lines });
    }
    const key = JSON.stringify(sections);
    if (key === this.key) return;
    this.key = key;
    const items: HTMLElement[] = [];
    for (const sec of sections) {
      const head = document.createElement('li');
      head.className = 'room-group';
      head.textContent = sec.head;
      items.push(head);
      for (const l of sec.lines) {
        const li = row(`<div class="row-main"><b></b><div class="sub"></div></div>`);
        li.querySelector('b')!.textContent = l.name;
        li.querySelector('.sub')!.textContent = l.text;
        items.push(li);
      }
    }
    this.list.replaceChildren(...items);
  }
}

function unit(kind: AreaKind): string {
  return kind === 'wood' ? 'wood' : kind === 'stone' ? 'stone' : 'copper';
}

// The Explore panel on the Gathering tab: what the scouts are looking for,
// how close the next find is, and every area found so far with how much of
// it is being worked.

import {
  areaCap,
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
import { $, setText, setBar } from './dom';
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
    setBar(this.bar, pct / 100);

    // found areas, one folded line per kind with its total; rebuilt only when what's found or worked changes
    const sections: { kind: AreaKind; head: string; total: string; lines: { name: string; text: string }[] }[] = [];
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
          return { name, text: `${formatNumber(kills)} of ${formatNumber(areaCap(s, a))} kills an hour. ${who[0].toUpperCase()}${who.slice(1)}${a.meatMult ? ', bigger than usual' : ''}.` };
        }
        const mix = Object.entries(areaMix(s, a)) as [ResourceId, number][];
        const gives = mix.length > 1 ? ` Gives ${mix.map(([r, n]) => `${Math.round(n * 100)}% ${resourceDef(r).name.toLowerCase()}`).join(', ')}.` : '';
        const extra = a.extras?.amber ? ' Amber now and then.' : a.extras?.mana ? ' A little mana for the shamans.' : a.extras?.mithril ? ' Mithril now and then.' : a.extras?.adamant ? ' Adamant, very rarely.' : a.extras?.weapon ? ' Old weapons now and then.' : a.luck ? ' Rare finds three times as likely.' : '';
        return { name, text: `${formatNumber(x.used)} of ${formatNumber(areaCap(s, a))} ${unit(k.id)} / s.${gives}${extra}` };
      });
      let total: string;
      if (k.id === 'monsters') {
        const kills = f.fills.reduce((t, x) => t + (x.area ? (x.used * 3600) / (x.area.killWork ?? 1) : 0), 0);
        const cap = f.fills.reduce((t, x) => t + (x.area ? areaCap(s, x.area) : 0), 0);
        total = `${formatNumber(kills)} of ${formatNumber(cap)} kills an hour`;
      } else {
        const used = f.fills.reduce((t, x) => t + x.used, 0);
        const cap = f.fills.reduce((t, x) => t + x.cap, 0);
        total = `${formatNumber(used)} of ${formatNumber(cap)} ${unit(k.id)} / s`;
      }
      sections.push({ kind: k.id, head: `${kindDef(k.id).name} · ${f.fills.filter((x) => x.area).length} found`, total, lines });
    }
    const key = JSON.stringify(sections);
    if (key === this.key) return;
    this.key = key;
    // keep whichever kinds were opened
    const open = new Set([...this.list.querySelectorAll<HTMLDetailsElement>('details[open]')].map((d) => d.dataset.kind));
    const items: HTMLElement[] = [];
    for (const sec of sections) {
      const li = row(`<details class="area-kind"><summary><b></b> <span class="sub"></span></summary><ul class="list area-list"></ul></details>`);
      li.classList.add('named');
      const det = li.querySelector('details')!;
      det.dataset.kind = sec.kind;
      det.open = open.has(sec.kind);
      li.querySelector('summary b')!.textContent = sec.head;
      li.querySelector('summary .sub')!.textContent = sec.total;
      const inner = li.querySelector('ul')!;
      for (const l of sec.lines) {
        const a = row(`<div class="row-main"><b></b><div class="sub"></div></div>`);
        a.querySelector('b')!.textContent = l.name;
        a.querySelector('.sub')!.textContent = l.text;
        inner.append(a);
      }
      items.push(li);
    }
    this.list.replaceChildren(...items);
  }
}

function unit(kind: AreaKind): string {
  return kind === 'wood' ? 'wood' : kind === 'stone' ? 'stone' : 'copper';
}

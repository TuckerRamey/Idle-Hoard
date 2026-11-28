// The Areas panel on the Gathering tab: who is out looking for more places
// to work and how close the next find is, and every area found so far with how much of
// it is being worked.

import {
  areaCap,
  areaMix,
  areaName,
  exploreBlocked,
  exploreKinds,
  exploreRate,
  fills,
  findCost,
  KINDS,
  kindDef,
  searchers,
  type AreaKind,
} from '../game/areas';
import { jobDef, resourceDef } from '../game/economy';
import type { ResourceId } from '../game/data';
import { monsterDef } from '../game/hunting';
import type { GameState } from '../game/state';
import { $, setText } from './dom';
import { formatDuration, formatNumber } from './format';
import { row } from './hud';

const LOOK_FOR: Record<AreaKind, string> = { wood: 'woodland', stone: 'stone', copper: 'copper', monsters: 'hunting grounds' };

export class ExploreView {
  private section = $('#explore-section');
  private status = $('#explore-status');
  private list = $('#areas');
  private key = '';

  constructor(
    private getState: () => GameState,
    _onChange: () => void,
  ) {}

  update() {
    const s = this.getState();
    this.section.hidden = !s.chief;
    if (this.section.hidden) return;

    // gatherers with no room to work go looking for more of their kind of place
    const looking: string[] = [];
    for (const k of exploreKinds(s)) {
      const n = Math.round(searchers(s, k));
      if (n < 1) continue;
      const job = jobDef(KINDS.find((x) => x.id === k)!.job)!.name.toLowerCase();
      const blocked = exploreBlocked(s, k);
      if (blocked) {
        looking.push(`${n} ${job}${n === 1 ? ' has' : 's have'} no room to work. ${blocked}`);
        continue;
      }
      const left = Math.max(0, findCost(s, k) - (s.explore.points[k] ?? 0));
      looking.push(`${n} ${job}${n === 1 ? ' is' : 's are'} out looking for more ${LOOK_FOR[k]}: the next find in about ${formatDuration(Math.max(1, left / Math.max(exploreRate(s, k), 1e-9)))}.`);
    }
    setText(this.status, looking.length ? looking.join(' ') : 'Gatherers and hunters with no room to work go looking for more places on their own.');

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

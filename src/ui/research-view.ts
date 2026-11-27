// The research list: what the lab could work on next, what it's on now, and
// what each project still needs. Every project keeps its own progress.

import type { ResourceId } from '../game/data';
import { researchRate, resourceDef } from '../game/economy';
import {
  availableResearch,
  chooseResearch,
  researchDef,
  researchProgress,
  researchShortOf,
  spillTarget,
  type ResearchDef,
} from '../game/research';
import type { GameState } from '../game/state';
import { $, setText } from './dom';
import { formatDuration, formatNumber } from './format';
import { row } from './hud';

const resName = (id: ResourceId) => resourceDef(id).name.toLowerCase();

/** "150 wood (40 to go)" for each resource a project uses. */
function resourceLine(s: GameState, r: ResearchDef): string {
  const entries = Object.entries(r.resources ?? {}) as [ResourceId, number][];
  if (!entries.length) return '';
  const done = researchProgress(s, r.id) / r.cost;
  return (
    'Uses ' +
    entries
      .map(([res, n]) => {
        const left = n * (1 - done);
        return done > 0 ? `${formatNumber(n)} ${resName(res)} (${formatNumber(Math.ceil(left))} to go)` : `${formatNumber(n)} ${resName(res)}`;
      })
      .join(' and ') +
    ', a little with every point.'
  );
}

export class ResearchView {
  private section = $('#research-section');
  private list = $('#research');
  private status = $('#research-status');
  private key = '';
  private bars = new Map<string, { bar: HTMLElement; wrap: HTMLElement; btn: HTMLButtonElement; sub: HTMLElement; uses: HTMLElement }>();

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
    else if (!cur) status = `${formatNumber(rate)} research / s, with nothing chosen. Pick a project to use it.`;
    else {
      const short = researchShortOf(s, cur);
      if (short.length) {
        const other = spillTarget(s);
        status = `${cur.name} is waiting for ${short.map(resName).join(' and ')}. ${other ? `Meanwhile the lab works on ${other.name.toLowerCase()}.` : 'Nothing else can be worked on meanwhile.'}`;
      } else status = `${formatNumber(rate)} research / s. ${cur.name} done in about ${formatDuration(Math.max(0, cur.cost - researchProgress(s, cur.id)) / rate)}.`;
    }
    if (!avail.length) status = 'Everything known has been worked out, for now.';
    setText(this.status, `${status} ${s.research.done.length} discoveries so far.`);

    const key = avail.map((r) => r.id).join() + '|' + s.research.current;
    if (key !== this.key) {
      this.key = key;
      this.bars.clear();
      this.list.replaceChildren(
        ...avail.map((r) => {
          const li = row(
            `<div class="row-main"><b></b><div class="desc"></div><div class="uses desc"></div><div class="sub"></div><div class="bar"><div></div></div></div><button type="button"></button>`,
          );
          li.querySelector('b')!.textContent = r.name;
          li.querySelector('.desc')!.textContent = r.description;
          const btn = li.querySelector('button')!;
          btn.textContent = s.research.current === r.id ? 'Stop' : 'Research';
          btn.addEventListener('click', () => {
            const st = this.getState();
            const next = st.research.current === r.id ? null : r.id;
            if (chooseResearch(st, next)) this.onChoose(next);
          });
          this.bars.set(r.id, {
            bar: li.querySelector('.bar > div')!,
            wrap: li.querySelector<HTMLElement>('.bar')!,
            btn,
            sub: li.querySelector('.sub')!,
            uses: li.querySelector('.uses')!,
          });
          return li;
        }),
      );
    }
    for (const r of avail) {
      const b = this.bars.get(r.id)!;
      const p = researchProgress(s, r.id);
      b.wrap.hidden = p <= 0 && s.research.current !== r.id;
      b.bar.style.width = `${Math.min(100, (p / r.cost) * 100).toFixed(1)}%`;
      setText(b.sub, p > 0 ? `${formatNumber(Math.min(p, r.cost))} / ${formatNumber(r.cost)} research` : `${formatNumber(r.cost)} research`);
      setText(b.uses, resourceLine(s, r));
    }
  }
}

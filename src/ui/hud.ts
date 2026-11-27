// The DOM side panel. Updated once per economy tick, and only the bits of
// text that changed are written, so it costs next to nothing.

import { DRAGON_STAGES, UPGRADES, WORKERS } from '../game/data';
import {
  arrivalSeconds,
  attractionTarget,
  buyUpgrade,
  canPromote,
  demote,
  incomePerSecond,
  jobOpen,
  owned,
  population,
  promote,
  promotionCost,
  upgradeVisible,
  workerRate,
} from '../game/economy';
import type { GameState } from '../game/state';
import { formatNumber } from './format';
import { $, setDisabled, setText } from './dom';

export class Hud {
  private copper = $('#copper');
  private rate = $('#rate');
  private stageName = $('#stage-name');
  private stageBar = $<HTMLDivElement>('#stage-bar > div');
  private stageText = $('#stage-text');
  private workerList = $('#workers');
  private upgradeList = $('#upgrades');
  private workerKey = '';
  private upgradeKey = '';
  private rows = new Map<string, { count: HTMLElement; rate: HTMLElement; up?: HTMLButtonElement; down?: HTMLButtonElement }>();
  private popCount = $('#pop-count');
  private popText = $('#pop-text');
  private upRows = new Map<string, HTMLButtonElement>();

  constructor(
    private getState: () => GameState,
    private onChange: (kind: 'promote' | 'demote' | 'upgrade', id: string) => void,
  ) {}

  update() {
    const s = this.getState();
    setText(this.copper, formatNumber(s.copper));
    setText(this.rate, `${formatNumber(incomePerSecond(s))} / s`);

    const stage = DRAGON_STAGES[s.stage];
    const next = DRAGON_STAGES[s.stage + 1];
    setText(this.stageName, stage.name);
    if (next) {
      const pct = Math.min(100, ((s.totalEarned - stage.threshold) / (next.threshold - stage.threshold)) * 100);
      this.stageBar.style.width = `${pct.toFixed(1)}%`;
      const verb = s.stage === 0 ? 'Hatches' : `Grows into ${next.name.toLowerCase()}`;
      setText(this.stageText, `${verb} at ${formatNumber(next.threshold)} copper buried (${formatNumber(s.totalEarned)} so far)`);
    } else {
      this.stageBar.style.width = '100%';
      setText(this.stageText, `${formatNumber(s.totalEarned)} copper buried in all`);
    }

    this.updateWorkers(s);
    this.updateUpgrades(s);
  }

  private updateWorkers(s: GameState) {
    // the warren's size and the next arrival
    const pop = population(s);
    const target = attractionTarget(s);
    setText(this.popCount, `${pop} kobold${pop === 1 ? '' : 's'}`);
    if (!s.chief) setText(this.popText, 'Kobolds will come once there is a Chief.');
    else if (pop < target) {
      const wait = Math.max(0, arrivalSeconds(s) - s.arrivalProgress);
      setText(this.popText, `The hoard is drawing ${target}. Next one wanders in within ${Math.ceil(wait)}s.`);
    } else setText(this.popText, `The hoard is drawing ${target}. A bigger hoard or dragon draws more.`);

    const open = WORKERS.filter((w) => jobOpen(s, w));
    const nextLocked = WORKERS.find((w) => !jobOpen(s, w));
    const key = open.map((w) => w.id).join() + '|' + (nextLocked?.id ?? '');
    if (key !== this.workerKey) {
      this.workerKey = key;
      this.workerList.replaceChildren();
      this.rows.clear();
      open.forEach((def, i) => {
        const li = document.createElement('li');
        li.innerHTML = `<div class="row-main"><b></b> <span class="count"></span><div class="desc"></div><div class="sub"></div></div><div class="job-buttons"></div>`;
        li.querySelector('b')!.textContent = def.name;
        li.querySelector('.desc')!.textContent = def.description;
        const btns = li.querySelector('.job-buttons')!;
        let down: HTMLButtonElement | undefined;
        let up: HTMLButtonElement | undefined;
        if (i > 0) {
          down = document.createElement('button');
          down.className = 'small';
          down.textContent = '−';
          down.title = `Move one back to ${WORKERS[i - 1].name.toLowerCase()}`;
          down.setAttribute('aria-label', down.title);
          down.addEventListener('click', () => {
            if (demote(this.getState(), def.id)) this.onChange('demote', def.id);
          });
          up = document.createElement('button');
          up.addEventListener('click', () => {
            if (promote(this.getState(), def.id)) this.onChange('promote', def.id);
          });
          btns.append(down, up);
        }
        this.rows.set(def.id, { count: li.querySelector('.count')!, rate: li.querySelector('.sub')!, up, down });
        this.workerList.append(li);
      });
      if (nextLocked) {
        const li = document.createElement('li');
        li.className = 'locked';
        const stage = DRAGON_STAGES[nextLocked.unlockStage];
        const name = stage.name.toLowerCase();
        li.textContent = `A better job opens when the dragon is ${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name}.`;
        this.workerList.append(li);
      }
    }
    open.forEach((def, i) => {
      const row = this.rows.get(def.id)!;
      const n = owned(s, def.id);
      setText(row.count, `×${n}`);
      setText(row.rate, n > 0 ? `${formatNumber(workerRate(s, def))} / s` : `${formatNumber(def.rate)} / s each`);
      if (row.up && row.down) {
        const cost = promotionCost(s, def.id) ?? 0;
        setText(row.up, `Promote · ${formatNumber(cost)}`);
        row.up.title = `Train a ${WORKERS[i - 1].name.toLowerCase()} to be a ${def.name.toLowerCase()}`;
        setDisabled(row.up, !canPromote(s, def.id));
        setDisabled(row.down, n < 1);
      }
    });
  }

  private updateUpgrades(s: GameState) {
    const visible = UPGRADES.filter((u) => upgradeVisible(s, u));
    const key = visible.map((u) => u.id).join();
    if (key !== this.upgradeKey) {
      this.upgradeKey = key;
      this.upgradeList.replaceChildren();
      this.upRows.clear();
      $('#upgrades-section').hidden = visible.length === 0;
      for (const u of visible) {
        const li = document.createElement('li');
        li.innerHTML = `<div class="row-main"><b></b><div class="desc"></div></div><button></button>`;
        li.querySelector('b')!.textContent = u.name;
        li.querySelector('.desc')!.textContent = u.description;
        const btn = li.querySelector('button')!;
        btn.textContent = `Buy · ${formatNumber(u.cost)}`;
        btn.addEventListener('click', () => {
          if (buyUpgrade(this.getState(), u.id)) this.onChange('upgrade', u.id);
        });
        this.upRows.set(u.id, btn);
        this.upgradeList.append(li);
      }
    }
    for (const u of visible) setDisabled(this.upRows.get(u.id)!, s.copper < u.cost);
  }
}

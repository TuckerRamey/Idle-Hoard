// The DOM side panel. Updated once per economy tick, and only the bits of
// text that changed are written, so it costs next to nothing.

import { DRAGON_STAGES, UPGRADES, WORKERS } from '../game/data';
import {
  buyUpgrade,
  canHire,
  hire,
  incomePerSecond,
  owned,
  upgradeVisible,
  workerCost,
  workerRate,
} from '../game/economy';
import type { GameState } from '../game/state';
import { formatNumber } from './format';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

function setText(el: HTMLElement, text: string) {
  if (el.textContent !== text) el.textContent = text;
}
function setDisabled(el: HTMLButtonElement, v: boolean) {
  if (el.disabled !== v) el.disabled = v;
}

export class Hud {
  private copper = $('#copper');
  private rate = $('#rate');
  private stageName = $('#stage-name');
  private stageBar = $<HTMLDivElement>('#stage-bar > div');
  private stageText = $('#stage-text');
  private message = $('#message');
  private workerList = $('#workers');
  private upgradeList = $('#upgrades');
  private workerKey = '';
  private upgradeKey = '';
  private rows = new Map<string, { count: HTMLElement; rate: HTMLElement; btn: HTMLButtonElement }>();
  private upRows = new Map<string, HTMLButtonElement>();

  constructor(
    private getState: () => GameState,
    private onChange: () => void,
  ) {}

  say(text: string) {
    setText(this.message, text);
  }

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
    const unlocked = WORKERS.filter((w) => canHire(s, w));
    const nextLocked = WORKERS.find((w) => !canHire(s, w));
    const key = unlocked.map((w) => w.id).join() + '|' + (nextLocked?.id ?? '');
    if (key !== this.workerKey) {
      this.workerKey = key;
      this.workerList.replaceChildren();
      this.rows.clear();
      for (const def of unlocked) {
        const li = document.createElement('li');
        li.innerHTML = `<div class="row-main"><b></b> <span class="count"></span><div class="desc"></div><div class="sub"></div></div><button></button>`;
        li.querySelector('b')!.textContent = def.name;
        li.querySelector('.desc')!.textContent = def.description;
        const btn = li.querySelector('button')!;
        btn.addEventListener('click', () => {
          if (hire(this.getState(), def.id)) this.onChange();
        });
        this.rows.set(def.id, { count: li.querySelector('.count')!, rate: li.querySelector('.sub')!, btn });
        this.workerList.append(li);
      }
      if (nextLocked) {
        const li = document.createElement('li');
        li.className = 'locked';
        const stage = DRAGON_STAGES[nextLocked.unlockStage];
        const name = stage.name.toLowerCase();
        li.textContent = `More kobolds will come when the dragon is ${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name}.`;
        this.workerList.append(li);
      }
    }
    for (const def of unlocked) {
      const row = this.rows.get(def.id)!;
      const n = owned(s, def.id);
      const cost = workerCost(def, n);
      setText(row.count, `×${n}`);
      setText(row.rate, n > 0 ? `${formatNumber(workerRate(s, def))} / s` : `${formatNumber(def.rate)} / s each`);
      setText(row.btn, `Hire · ${formatNumber(cost)}`);
      setDisabled(row.btn, s.copper < cost);
    }
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
          if (buyUpgrade(this.getState(), u.id)) this.onChange();
        });
        this.upRows.set(u.id, btn);
        this.upgradeList.append(li);
      }
    }
    for (const u of visible) setDisabled(this.upRows.get(u.id)!, s.copper < u.cost);
  }
}

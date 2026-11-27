// The Chief's part of the side panel: making a Chief, their card, renown and skills.

import { BRANCHES, quirkOf, rollChief, SKILLS, STATS, type Chief } from '../game/chief';
import { canLearn, learnSkill, renown, renownForPoint, skillPointsEarned, skillPointsFree, skillPointsSpent } from '../game/economy';
import type { GameState } from '../game/state';
import { $, setDisabled, setText } from './dom';
import { formatNumber } from './format';

export class ChiefPanel {
  private create = $('#chief-create');
  private card = $('#chief-card');
  private nameInput = $<HTMLInputElement>('#chief-name');
  private rollStats = $('#roll-stats');
  private rollQuirk = $('#roll-quirk');
  private title = $('#chief-title');
  private quirk = $('#chief-quirk');
  private stats = $('#chief-stats');
  private renownBar = $<HTMLDivElement>('#renown-bar > div');
  private renownText = $('#renown-text');
  private points = $('#skill-points');
  private skillList = $('#skills');
  private skillButtons = new Map<string, HTMLButtonElement>();
  private skillKey = '';
  private roll: Chief;

  constructor(
    private getState: () => GameState,
    private onLearn: (skillId: string) => void,
    private onFound: (chief: Chief) => void,
  ) {
    this.roll = rollChief(Math.random);
    this.nameInput.value = this.roll.name;
    this.showRoll();
    $('#reroll').addEventListener('click', () => {
      this.roll = rollChief(Math.random, this.roll.name);
      this.showRoll();
    });
    $('#random-name').addEventListener('click', () => {
      this.nameInput.value = rollChief(Math.random).name;
    });
    $('#chief-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = this.nameInput.value.trim().slice(0, 24);
      if (!name) {
        this.nameInput.focus();
        return;
      }
      this.onFound({ ...this.roll, name });
    });
  }

  private showRoll() {
    this.rollStats.replaceChildren(...STATS.map((st) => statRow(st.name, this.roll[st.id], st.effect)));
    const q = quirkOf(this.roll);
    this.rollQuirk.replaceChildren(quirkLine(q?.name ?? '', q?.description ?? ''));
  }

  update() {
    const s = this.getState();
    this.create.hidden = s.chief !== null;
    this.card.hidden = s.chief === null;
    if (!s.chief) return;
    const c = s.chief;
    const q = quirkOf(c);
    setText(this.title, `Chief ${c.name}`);
    setText(this.quirk, q ? `${q.name}: ${q.description}` : '');
    const statKey = STATS.map((st) => c[st.id]).join();
    if (this.stats.dataset.key !== statKey) {
      this.stats.dataset.key = statKey;
      this.stats.replaceChildren(...STATS.map((st) => statRow(st.name, c[st.id], st.effect)));
    }

    // renown progress toward the next skill point (stage bonuses are separate)
    const r = renown(s);
    const fromRenown = skillPointsEarned(s) - s.stage;
    const prev = fromRenown === 0 ? 0 : renownForPoint(fromRenown);
    const next = renownForPoint(fromRenown + 1);
    this.renownBar.style.width = `${Math.min(100, ((r - prev) / (next - prev)) * 100).toFixed(1)}%`;
    setText(this.renownText, `Renown ${formatNumber(r)}. Next skill point at ${formatNumber(next)}.`);

    const free = skillPointsFree(s);
    setText(this.points, free === 1 ? '1 skill point to spend' : `${free} skill points to spend`);
    this.updateSkills(s);
  }

  private updateSkills(s: GameState) {
    const key = s.skills.join() + '|' + skillPointsSpent(s);
    if (key !== this.skillKey) {
      this.skillKey = key;
      this.skillList.replaceChildren();
      this.skillButtons.clear();
      for (const sk of SKILLS) {
        const branch = BRANCHES.find((b) => b.id === sk.branch);
        if (!branch?.available) continue;
        const li = document.createElement('li');
        const has = s.skills.includes(sk.id);
        const missing = sk.requires.filter((r) => !s.skills.includes(r));
        if (has) li.className = 'learned';
        li.innerHTML = `<div class="row-main"><b></b><div class="desc"></div><div class="sub"></div></div>`;
        li.querySelector('b')!.textContent = sk.name;
        li.querySelector('.desc')!.textContent = sk.description;
        const sub = li.querySelector('.sub')!;
        if (has) sub.textContent = 'Learned';
        else if (missing.length) sub.textContent = `Needs ${missing.map((m) => SKILLS.find((x) => x.id === m)?.name ?? m).join(' and ')}`;
        if (!has) {
          const btn = document.createElement('button');
          btn.textContent = `Learn · ${sk.cost} pt`;
          btn.addEventListener('click', () => {
            if (learnSkill(this.getState(), sk.id)) this.onLearn(sk.id);
          });
          li.append(btn);
          this.skillButtons.set(sk.id, btn);
        }
        this.skillList.append(li);
      }
      const later = BRANCHES.filter((b) => !b.available).map((b) => b.name);
      if (later.length) {
        const li = document.createElement('li');
        li.className = 'locked';
        li.textContent = `${later.join(', ')} skills arrive in later updates.`;
        this.skillList.append(li);
      }
    }
    for (const sk of SKILLS) {
      const btn = this.skillButtons.get(sk.id);
      if (btn) setDisabled(btn, !canLearn(s, sk));
    }
  }
}

function statRow(name: string, value: number, effect: string) {
  const row = document.createElement('div');
  row.className = 'stat';
  const pips = '●'.repeat(value) + '○'.repeat(Math.max(0, 4 - value));
  row.innerHTML = `<span class="stat-name"></span><span class="pips" aria-hidden="true"></span><span class="desc"></span>`;
  row.querySelector('.stat-name')!.textContent = `${name} ${value}`;
  row.querySelector('.pips')!.textContent = pips;
  row.querySelector('.desc')!.textContent = effect;
  return row;
}

function quirkLine(name: string, description: string) {
  const p = document.createElement('p');
  p.className = 'desc';
  p.innerHTML = '<b></b> ';
  p.querySelector('b')!.textContent = name;
  p.append(description);
  return p;
}

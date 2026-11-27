// The Chief's part of the side panel: making a Chief and their card.

import { MAX_PIPS, pipRoom, quirkOf, rollChief, spendPip, STATS, type Chief, type StatId } from '../game/chief';
import type { GameState } from '../game/state';
import { $, setText } from './dom';

export class ChiefPanel {
  private create = $('#chief-create');
  private card = $('#chief-card');
  private nameInput = $<HTMLInputElement>('#chief-name');
  private rollStats = $('#roll-stats');
  private rollQuirk = $('#roll-quirk');
  private title = $('#chief-title');
  private quirk = $('#chief-quirk');
  private stats = $('#chief-stats');
  private grow = $('#chief-grow');
  private growButtons = $('#chief-grow-buttons');
  private roll: Chief;

  constructor(
    private getState: () => GameState,
    private onFound: (chief: Chief) => void,
    private onGrow: (stat: StatId) => void = () => {},
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
    const pending = s.chiefMarks.pending > 0 && pipRoom(c);
    this.grow.hidden = !pending;
    const growKey = pending ? statKey + '|' + s.chiefMarks.pending : '';
    if (pending && this.growButtons.dataset.key !== growKey) {
      this.growButtons.dataset.key = growKey;
      this.grow.querySelector('p')!.textContent = `${c.name} can grow${s.chiefMarks.pending > 1 ? ` (${s.chiefMarks.pending} times)` : ''}. Pick one:`;
      this.growButtons.replaceChildren(
        ...STATS.map((st) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'small';
          b.textContent = `+ ${st.name}`;
          b.disabled = c[st.id] >= MAX_PIPS;
          b.addEventListener('click', () => {
            if (spendPip(this.getState(), st.id)) this.onGrow(st.id);
          });
          return b;
        }),
      );
    }
  }
}

function statRow(name: string, value: number, effect: string) {
  const row = document.createElement('div');
  row.className = 'stat';
  const pips = '●'.repeat(value) + '○'.repeat(Math.max(0, MAX_PIPS - value));
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

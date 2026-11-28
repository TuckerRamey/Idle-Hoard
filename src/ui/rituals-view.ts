// Rituals on the Leadership tab: what the shamans can do with their mana.

import { MAGIC, magicOpen, performRitual, ritualBlocked, RITUALS } from '../game/magic';
import type { GameState } from '../game/state';
import { $, setDisabled, setText } from './dom';
import { formatDuration, formatNumber } from './format';
import { row } from './hud';

export class RitualsView {
  private section = $('#rituals-section');
  private status = $('#rituals-status');
  private list = $('#rituals');
  private rows = new Map<string, { note: HTMLElement; button: HTMLButtonElement }>();

  constructor(
    private getState: () => GameState,
    private onLine: (line: string) => void,
  ) {
    for (const r of RITUALS) {
      const li = row(
        `<div class="row-main"><b></b> <span class="count"></span><div class="desc"></div><div class="sub"></div></div><div class="job-buttons"><button type="button" class="small">Do it</button></div>`,
      );
      li.querySelector('b')!.textContent = r.name;
      li.querySelector('.count')!.textContent = `${r.cost} mana`;
      li.querySelector('.desc')!.textContent = r.text;
      const button = li.querySelector('button')!;
      button.setAttribute('aria-label', `${r.name}, ${r.cost} mana`);
      button.addEventListener('click', () => {
        const line = performRitual(this.getState(), r.id);
        if (line) this.onLine(line);
      });
      this.rows.set(r.id, { note: li.querySelector('.sub')!, button });
      this.list.append(li);
    }
  }

  update() {
    const s = this.getState();
    this.section.hidden = !magicOpen(s);
    if (this.section.hidden) return;
    const m = s.magic;
    setText(
      this.status,
      `${formatNumber(Math.floor(m.mana))} of ${MAGIC.maxMana} mana. The shamans have ${formatNumber(Math.floor(m.bones))} bones and ${formatNumber(Math.floor(m.dust))} dragon dust to work with.`,
    );
    for (const r of RITUALS) {
      const { note, button } = this.rows.get(r.id)!;
      const blocked = ritualBlocked(s, r);
      setDisabled(button, !!blocked);
      let text = '';
      if (r.id === 'bless' && m.blessed) text = 'Blessed: its next raid goes with the runes on.';
      else if (r.id === 'stone-song' && m.stoneSong > 0) text = `Singing: ${formatDuration(m.stoneSong)} left.`;
      else if (r.id === 'read-bones' && m.vision > 0) text = `Read: the dragon card shows a day ahead for ${formatDuration(m.vision)} more.`;
      else if (r.id === 'charm' && m.charms > 0) text = `${m.charms} lucky find${m.charms === 1 ? '' : 's'} to come.`;
      else if (blocked && blocked !== 'Needs shamans') text = blocked + '.';
      setText(note, text);
    }
  }
}

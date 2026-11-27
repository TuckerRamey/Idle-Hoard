// The art on show in the hoard room, and what the artisans are working on.

import { ART, artAppeal, artisans, artOpen, displaySlots, nextMaterial } from '../game/art';
import { fullName } from '../game/kobolds';
import type { GameState } from '../game/state';
import { timeAgo } from './chronicle';
import { $, setText } from './dom';
import { formatDuration } from './format';

export class ArtView {
  private section = $('#art-section');
  private list = $('#art');
  private status = $('#art-status');
  private key = '';

  constructor(private getState: () => GameState) {}

  update(now: number) {
    const s = this.getState();
    this.section.hidden = !artOpen(s) && s.art.pieces.length === 0;
    if (this.section.hidden) return;
    const working = artisans(s);
    const parts = [`${s.art.pieces.length} of ${displaySlots(s)} spaces filled, appeal +${Math.round(artAppeal(s) * 10) / 10}. A bigger hoard room fits more.`];
    if (!working.length) parts.push('No artisans yet: an experienced named kobold can become one from their card.');
    for (const k of working) {
      const left = ART.hours * 3600 - (k.artWork ?? 0);
      const m = nextMaterial(s, k);
      parts.push(left > 1 ? `${fullName(k)} finishes their next piece in about ${formatDuration(left)}.` : m ? `${fullName(k)} is putting the last touches on a piece.` : `${fullName(k)} is waiting for materials.`);
    }
    setText(this.status, parts.join(' '));
    const key = s.art.pieces.map((p) => p.id).join() + '|' + Math.floor(now / 60000);
    if (key === this.key) return;
    this.key = key;
    this.list.replaceChildren(
      ...[...s.art.pieces]
        .sort((a, b) => b.appeal - a.appeal)
        .map((p) => {
          const li = document.createElement('li');
          li.innerHTML = '<div class="row-main"><b></b><div class="desc"></div></div>';
          li.querySelector('b')!.textContent = p.title[0].toUpperCase() + p.title.slice(1);
          li.querySelector('.desc')!.textContent = `${p.by ? `By ${p.by}` : 'Unsigned'}, ${timeAgo(now - p.t)}. Appeal +${p.appeal}.`;
          return li;
        }),
    );
  }
}

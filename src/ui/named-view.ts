// Named kobolds: each one's card, with their job, likes, traits, gifts and story.

import { ART, ARTISAN, artOpen, canBecomeArtisan, makeArtisan } from '../game/art';
import { IDLE, JOBS, ROOMS } from '../game/data';
import { jobOpen, namedDigRoom, roomOpen } from '../game/economy';
import {
  canPromote,
  fullName,
  giftDef,
  LIEUTENANT_EXPERIENCES,
  lieutenants,
  lieutenantSlots,
  makeLieutenant,
  moveNamed,
  setNamedRoom,
  personalMult,
  personalParts,
  standDown,
  type NamedKobold,
} from '../game/kobolds';
import { colonyBlocked, coloniesOpen, foundColony } from '../game/colonies';
import { rng, type GameState } from '../game/state';
import { timeAgo } from './chronicle';
import { $, confirmTap, setDisabled, setText } from './dom';
import { syncOptions } from './hud';
import { formatDuration } from './format';

/** ×1.5, ×3.2, ×0.75 */
export const timesText = (m: number) => `×${m.toFixed(2).replace(/0$/, '').replace(/\.0$/, '')}`;

const jobName = (id: string) => (id === IDLE ? 'Idle' : id === ARTISAN ? 'Artisan' : (JOBS.find((j) => j.id === id)?.name ?? id));

export class NamedView {
  private section = $('#named-section');
  private list = $('#named');
  private summary = $('#named-summary');
  private key = '';

  constructor(
    private getState: () => GameState,
    private onChange: (k: NamedKobold, what: 'job' | 'lieutenant' | 'stand-down' | 'artisan' | 'colony', line?: string) => void,
  ) {}

  update(now: number) {
    const s = this.getState();
    this.section.hidden = s.named.length === 0;
    if (!s.named.length) return;
    setText(this.summary, `${s.named.length} named · ${lieutenants(s).length} of ${lieutenantSlots(s)} lieutenants`);
    const key =
      s.named.map((k) => `${k.id}:${k.job}:${k.job === 'digger' ? namedDigRoom(s, k) : ''}:${k.lieutenant}:${k.history.length}:${k.gifts.length}:${k.traits.length}:${k.talents?.length ?? 0}:${k.epithet ?? ''}:${Math.ceil((k.restLeft ?? 0) / 600)}`).join('|') +
      `|${lieutenantSlots(s)}|${Math.floor(now / 60000)}|${JOBS.filter((j) => jobOpen(s, j)).length}|${artOpen(s)}|${coloniesOpen(s)}|${s.named.map((k) => colonyBlocked(s, k) ?? '').join()}`;
    if (key === this.key) return;
    this.key = key;
    const open = this.list.querySelectorAll('details[open]');
    const openIds = new Set([...open].map((d) => (d as HTMLElement).dataset.id));
    this.list.replaceChildren(...s.named.map((k) => this.card(s, k, now, openIds.has(String(k.id)))));
  }

  private card(s: GameState, k: NamedKobold, now: number, isOpen: boolean): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'named';
    li.innerHTML = `<details><summary><b></b> <span class="desc job"></span></summary><div class="named-body"><div class="desc likes"></div><div class="desc mods"></div><div class="desc traits"></div><div class="named-controls"><label class="desc">Job <select class="job-pick"></select></label><label class="desc room-pick" hidden>Digging <select></select></label><button type="button" class="lt"></button><button type="button" class="art"></button><button type="button" class="colony-btn"></button></div><div class="desc lt-note"></div><ul class="history"></ul></div></details>`;
    const det = li.querySelector('details')!;
    det.dataset.id = String(k.id);
    det.open = isOpen;
    li.querySelector('b')!.textContent = `${k.lieutenant ? '★ ' : ''}${fullName(k)}`;
    const working = k.job !== IDLE && k.job !== ARTISAN;
    const rest = (k.restLeft ?? 0) > 0 ? ` · hurt, resting by the hoard (${formatDuration(k.restLeft!)} left)` : '';
    li.querySelector('.job')!.textContent = (working ? `${jobName(k.job)} ${timesText(personalMult(k))}` : jobName(k.job)) + rest;
    li.querySelector('.mods')!.textContent = working ? modsText(k) : '';
    li.querySelector('.likes')!.textContent = `Loves ${jobName(k.loves).toLowerCase()}, hates ${jobName(k.hates).toLowerCase()}.`;
    const extras = [
      ...(k.epithet ? [`The kobold who ${k.epithet}`] : []),
      ...(k.talents ?? []).map((t) => `${t.name} (${jobName(t.job).toLowerCase()} +${Math.round((t.mult - 1) * 100)}%)`),
      ...k.traits,
      ...k.gifts.map((g) => `Gift: ${giftDef(g)?.name ?? g}`),
    ];
    li.querySelector('.traits')!.textContent = extras.join(' · ');
    const sel = li.querySelector<HTMLSelectElement>('.job-pick')!;
    // a named digger digs a room of their own
    const roomLabel = li.querySelector<HTMLElement>('.room-pick')!;
    roomLabel.hidden = k.job !== 'digger';
    if (k.job === 'digger') {
      const roomSel = roomLabel.querySelector('select')!;
      syncOptions(roomSel, ROOMS.filter((r) => roomOpen(s, r)).map((r) => [r.id, `The ${r.name.toLowerCase()}`] as [string, string]), namedDigRoom(s, k));
      roomSel.addEventListener('change', () => {
        if (setNamedRoom(this.getState(), k.id, roomSel.value)) this.onChange(k, 'job');
      });
    }
    syncOptions(sel, [[IDLE, 'Idle'], ...JOBS.filter((j) => jobOpen(s, j)).map((j) => [j.id, `${j.name} ${timesText(personalMult(k, j.id))}`] as [string, string]), ...(k.job === ARTISAN ? [[ARTISAN, 'Artisan'] as [string, string]] : [])], k.job);
    sel.addEventListener('change', () => {
      if (moveNamed(this.getState(), k.id, sel.value)) this.onChange(k, 'job');
    });
    const btn = li.querySelector<HTMLButtonElement>('.lt')!;
    const note = li.querySelector<HTMLElement>('.lt-note')!;
    if (k.lieutenant) {
      btn.textContent = 'Stand down';
      btn.addEventListener('click', () => {
        if (standDown(this.getState(), k.id, Date.now())) this.onChange(k, 'stand-down');
      });
      note.textContent = 'A lieutenant lifts their whole crew by 15%.';
    } else {
      btn.textContent = 'Make lieutenant';
      setDisabled(btn, !canPromote(s, k));
      btn.addEventListener('click', () => {
        if (makeLieutenant(this.getState(), k.id, Date.now())) this.onChange(k, 'lieutenant');
      });
      note.textContent =
        k.history.length < LIEUTENANT_EXPERIENCES
          ? `${k.history.length} of ${LIEUTENANT_EXPERIENCES} experiences needed to be a lieutenant.`
          : lieutenants(s).length >= lieutenantSlots(s)
            ? 'No lieutenant slots free. A bigger dragon brings more.'
            : 'Ready to be a lieutenant.';
    }
    const art = li.querySelector<HTMLButtonElement>('.art')!;
    art.hidden = !artOpen(s) || k.job === ARTISAN;
    art.textContent = 'Make artisan';
    setDisabled(art, !canBecomeArtisan(s, k));
    art.title = canBecomeArtisan(s, k) ? 'Leave their job to make art for the hoard room' : `Needs ${ART.experiences} experiences`;
    art.addEventListener('click', () => {
      if (makeArtisan(this.getState(), k.id, Date.now())) this.onChange(k, 'artisan');
    });
    if (k.job === ARTISAN) btn.hidden = true;
    const col = li.querySelector<HTMLButtonElement>('.colony-btn')!;
    const why = colonyBlocked(s, k);
    col.hidden = !coloniesOpen(s);
    col.textContent = 'Found a colony';
    setDisabled(col, !!why);
    col.title = why ?? 'Leave with a few kobolds to found a colony that sends tribute to the hoard. For good.';
    col.addEventListener('click', () => {
      if (!confirmTap(col, 'Tap again: they leave for good')) return;
      const st = this.getState();
      const line = foundColony(st, k.id, Date.now(), rng(st));
      if (line) this.onChange(k, 'colony', line);
    });
    const hist = li.querySelector('.history')!;
    for (const h of [...k.history].reverse()) {
      const item = document.createElement('li');
      const when = document.createElement('span');
      when.className = 'when';
      when.textContent = timeAgo(now - h.t);
      item.append(h.text, ' ', when);
      hist.append(item);
    }
    return li;
  }
}

/** "As a digger: ×1.9 a crowd kobold's work (loves it ×1.5, Shovel-hands ×1.25)." */
export function modsText(k: NamedKobold): string {
  const parts = personalParts(k);
  const m = personalMult(k);
  let text = `As a ${jobName(k.job).toLowerCase()}: ${timesText(m)} a crowd kobold's work`;
  text += parts.length ? ` (${parts.map((p) => `${p.label} ${timesText(p.mult)}`).join(', ')}).` : '.';
  return text;
}

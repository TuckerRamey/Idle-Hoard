// The dragon's part of the panel once it hatches: how it feels, what it
// craves, what it wants right now, and what its next molt needs.

import { meatOnHand } from '../game/hunting';
import { nextRaid, RAID, raidDef, raidForecast, raidTarget } from '../game/raids';
import { animalName, boostLeft, dragonStat, STATS, trainCap, dismissRequest, FAVOR, favorJobs, favorName, grantRequest, mood, moltNeeds, DIET, refineRates, sizeCap, SIZE, useFavor } from '../game/dragon';
import { hoardValue, resourceDef, resourceOpen } from '../game/economy';
import { rng, type GameState } from '../game/state';
import { $, setDisabled, setText } from './dom';
import { formatDuration, formatNumber } from './format';
import { syncOptions } from './hud';

export class DragonView {
  private box = $('#dragon');
  private moodEl = $('#dragon-mood');
  private sizeEl = $('#dragon-size');
  private statsEl = $('#dragon-stats');
  private raidEl = $('#dragon-raid');
  private crave = $('#dragon-craving');
  private req = $('#dragon-request');
  private reqText = $('#request-text');
  private grant = $<HTMLButtonElement>('#request-grant');
  private dismiss = $<HTMLButtonElement>('#request-dismiss');
  private molt = $('#molt-needs');
  private favor = $('#dragon-favor');
  private favorText = $('#favor-text');
  private favorJob = $<HTMLSelectElement>('#favor-job');
  private favorUse = $<HTMLButtonElement>('#favor-use');
  private boosts = $('#dragon-boosts');
  private moltKey = '';

  constructor(
    private getState: () => GameState,
    private onLine: (text: string) => void,
  ) {
    this.grant.addEventListener('click', () => {
      const s = this.getState();
      const line = grantRequest(s, Date.now(), rng(s));
      if (line) this.onLine(line);
    });
    this.favorUse.addEventListener('click', () => {
      // what you just asked for shows in the panel; it doesn't need a chronicle line
      if (useFavor(this.getState(), this.favorJob.value)) this.onLine('');
    });
    this.dismiss.addEventListener('click', () => {
      const line = dismissRequest(this.getState());
      if (line) this.onLine(line);
    });
  }

  update() {
    const s = this.getState();
    this.box.hidden = s.stage === 0;
    if (s.stage === 0) return;
    const d = s.dragon;
    const m = mood(s);
    const meatOpen = resourceOpen(s, 'meat');
    const moodText = {
      egg: '',
      hungry: meatOpen ? 'Hungry: no meat in the stores. It won’t grow until it’s fed.' : 'Hungry. Research crab wrangling to start a pasture and feed it.',
      fed: `Fed and content. Everything +${Math.round((DIET.fedMult - 1) * 100)}%.`,
      delighted: `Delighted: eating the ${animalName(s.herd)} it craves. Everything +${Math.round((DIET.delightedMult - 1) * 100)}%.`,
    }[m];
    setText(this.moodEl, moodText);
    this.moodEl.classList.toggle('warn', m === 'hungry');

    let crave = '';
    if (meatOpen) {
      crave = `Craves ${animalName(d.craving)}.`;
      if (d.warned && d.next !== d.craving) crave += ` In about ${formatDuration(Math.max(0, d.changeAt - d.clock))} it will crave ${animalName(d.next)}.`;
    }
    setText(this.crave, crave);

    const room = sizeCap(s);
    const rates = refineRates(s);
    let size = `${formatNumber(d.size)} cubic paces, room to grow to ${formatNumber(room)}${d.size >= room - 0.5 ? (room >= (SIZE.capByStage[s.stage] ?? 0) ? ' (as big as it gets until it evolves)' : ' (dig the hoard room bigger)') : ''}.`;
    if (rates.copper > 0) size += ` It eats ${formatNumber(rates.copper * 3600)} copper an hour and sheds silver${rates.silver > 0 ? `, and ${formatNumber(rates.silver * 3600)} silver an hour into gold` : ''}. Hoard worth ${formatNumber(hoardValue(s))} copper.`;
    else if (s.stage > 0) size += ` Once it's fed and content, it grows and turns copper into silver.`;
    setText(this.sizeEl, size);

    // stats, and what they're good for
    const cap = trainCap(s);
    setText(
      this.statsEl,
      STATS.map((x) => `${x.name} ${dragonStat(s, x.id)}`).join(' · ') +
        `. Monster meat trains each by up to ${formatNumber(cap)} at this size (${STATS.map((x) => `${formatNumber(Math.min(d.trained[x.id], cap))}`).join(' / ')} so far)` +
        (meatOnHand(s) >= 1 ? `; ${formatNumber(meatOnHand(s))} bites of monster meat waiting.` : '.'),
    );
    this.statsEl.title = STATS.map((x) => `${x.name}: ${x.text}`).join('\n');
    let raid = '';
    if (d.raid) {
      const def = raidDef(d.raid.target);
      raid = `Away raiding a ${def?.name ?? 'somewhere'}, back in about ${formatDuration(Math.max(0, d.raid.until - d.clock))}.`;
    } else if (s.stage >= RAID.fromStage) {
      const target = raidTarget(s);
      const next = nextRaid(s);
      const when = d.nextRaidAt > d.clock ? ` in about ${formatDuration(d.nextRaidAt - d.clock)}` : ' once it’s fed and content';
      raid = target ? `Next raid: a ${target.name}${when}${s.magic.blessed ? ', blessed' : ''}.` : '';
      if (target && s.magic.vision > 0) raid += ` The bones say it will bring back ${raidForecast(s, target)}.`;
      if (next) raid += ` A ${next.def.name} needs ${next.needs.join(' and ')}.`;
    } else raid = 'Once it’s a young dragon, it will go raiding on its own.';
    setText(this.raidEl, raid.trim());

    this.favor.hidden = d.boons < 1;
    if (d.boons > 0) {
      const jobs = favorJobs(s);
      setText(this.favorText, `It owes you ${d.boons === 1 ? 'a favor' : `${d.boons} favors`} (it remembers up to ${FAVOR.max}). Ask, and it helps one job work twice as fast for an hour.`);
      syncOptions(this.favorJob, jobs.map((j) => [j, favorName(j)]), jobs.includes(this.favorJob.value) ? this.favorJob.value : (jobs[0] ?? ''));
      setDisabled(this.favorUse, jobs.length === 0);
    }
    setText(
      this.boosts,
      d.boosts
        .filter((b) => boostLeft(s, b.job) > 0)
        .map((b) => `${favorName(b.job)}: ${formatDuration(boostLeft(s, b.job))} left.`)
        .join(' '),
    );

    const r = d.raid ? null : d.request;
    this.req.hidden = !r;
    if (r) {
      const left = `Fades in ${formatDuration(Math.max(0, r.until - d.clock))}.`;
      if (r.kind === 'give') {
        setText(this.reqText, `${r.text} It wants ${formatNumber(r.amount)} ${resourceDef(r.resource).name.toLowerCase()}. ${left}`);
        setText(this.grant, 'Give it');
        setDisabled(this.grant, s.res[r.resource] < r.amount);
      } else {
        setText(this.reqText, `The dragon wants to speak with ${r.name}. ${left}`);
        setText(this.grant, 'Send them');
        setDisabled(this.grant, false);
      }
    }

    const needs = moltNeeds(s);
    const key = needs ? needs.map((n) => `${n.label}:${n.have}:${n.met}`).join('|') : 'none';
    if (key !== this.moltKey) {
      this.moltKey = key;
      if (!needs) {
        this.molt.replaceChildren();
        const li = document.createElement('li');
        li.textContent = 'Fully grown.';
        this.molt.append(li);
      } else
        this.molt.replaceChildren(
          ...needs.map((n) => {
            const li = document.createElement('li');
            li.className = n.met ? 'met' : '';
            li.textContent = `${n.met ? '✓' : '○'} ${n.label}${n.met ? '' : ` (${n.have} so far)`}`;
            return li;
          }),
        );
    }
  }
}

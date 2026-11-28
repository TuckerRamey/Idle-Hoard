import './style.css';
import { RitualsView } from './ui/rituals-view';
import type { Chief } from './game/chief';
import { CONFIG, DRAGON_STAGES, JOBS, RESOURCES, ROOMS } from './game/data';
import { advanceTo, beds, cached, emptyAdvance, mergeResult, hoardValue, offlineCap, population, roomCapacity, stageFor, workers, type AdvanceResult } from './game/economy';
import { awayHappenings, happen, happeningChance } from './game/happenings';
import { nextGoal } from './game/goals';
import { ColoniesView } from './ui/colonies-view';
import { browserStore, exportSave, importSave, load, write } from './game/save';
import { addChronicle, newGame, type GameState } from './game/state';
import { Renderer } from './render/renderer';
import { ChiefPanel } from './ui/chief-panel';
import { ChronicleView } from './ui/chronicle';
import { confirmTap } from './ui/dom';
import { formatDuration, formatNumber } from './ui/format';
import { Hud } from './ui/hud';
import { OdditiesView } from './ui/oddities-view';
import { DragonView } from './ui/dragon-view';
import { ResearchView } from './ui/research-view';
import { ForgeView } from './ui/forge-view';
import { ExploreView } from './ui/explore-view';
import { areaDef } from './game/areas';
import { ArtView } from './ui/art-view';
import { NamedView } from './ui/named-view';
import { TabsView } from './ui/tabs';
import { researchDef } from './game/research';

const TICK_MS = 1000;
const AUTOSAVE_MS = 60_000;

const store = browserStore;
const loaded = load(store, Date.now());
let state: GameState = loaded.state;
const getState = () => state;

const chiefName = () => state.chief?.name ?? 'The Chief';
/** Add a line to the chronicle. */
function tell(text: string) {
  addChronicle(state, Date.now(), text.replaceAll('{chief}', chiefName()));
}
/** Add a line only if the chronicle doesn't already have it (for "first ..." lines). */
function tellOnce(text: string) {
  const filled = text.replaceAll('{chief}', chiefName());
  if (!state.chronicle.some((e) => e.text === filled)) tell(filled);
}

/** "First woodcutter" style lines, once per job. */
function firstOnJobs() {
  for (const def of JOBS) if (workers(state, def.id) > 0) tellOnce(def.firstText);
}

// The chronicle is for things that happen, not for what you just did: moving
// kobolds, picking research or a herd, making lieutenants and so on get no line.
const hud = new Hud(getState, (e) => {
  if (e.kind === 'assign' || e.kind === 'dig') firstOnJobs();
  refresh();
});
const dragonView = new DragonView(getState, (line) => {
  if (line) tell(line);
  refresh();
  save();
});
const researchView = new ResearchView(getState, () => refresh());
const exploreView = new ExploreView(getState, () => {
  refresh();
  save();
});
const forgeView = new ForgeView(getState, () => {
  refresh();
  save();
});
const namedView = new NamedView(getState, (_k, _what, line) => {
  if (line) tell(line);
  refresh();
  save();
});
const chiefPanel = new ChiefPanel(
  getState,
  (chief) => foundChief(chief),
  () => {
    refresh();
    save();
  },
);
const artView = new ArtView(getState);
const coloniesView = new ColoniesView(getState);
const ritualsView = new RitualsView(getState, (line) => {
  tell(line);
  refresh();
  save();
});
const goalEl = document.querySelector('#goal') as HTMLElement;
const awayEl = document.querySelector('#away') as HTMLElement;
const awayTitle = document.querySelector('#away-title') as HTMLElement;
const awayList = document.querySelector('#away-list') as HTMLElement;
document.querySelector('#away-close')!.addEventListener('click', () => (awayEl.hidden = true));
const chronicle = new ChronicleView(getState);
const oddities = new OdditiesView(getState);
const tabs = new TabsView(getState);
document.querySelector('#settings-open')!.addEventListener('click', () => tabs.toggleSettings());
const renderer = new Renderer(document.querySelector('#scene') as HTMLCanvasElement, getState);

function updatePanels() {
  // the panels ask for the same job outputs many times over; work them out once per update
  cached(updatePanelsNow);
}

function updatePanelsNow() {
  hud.update();
  dragonView.update();
  researchView.update();
  exploreView.update();
  forgeView.update();
  artView.update(Date.now());
  namedView.update(Date.now());
  coloniesView.update(Date.now());
  ritualsView.update();
  const goal = state.settings.goal ? nextGoal(state) : null;
  goalEl.hidden = !goal;
  if (goal && goalEl.textContent !== goal) goalEl.textContent = goal;
}

function refresh() {
  updatePanels();
  chiefPanel.update();
  chronicle.update(Date.now());
  oddities.update(Date.now());
  tabs.update();
  renderer.invalidate();
}

function save() {
  write(store, state, Date.now());
}

function foundChief(chief: Chief) {
  state.chief = chief;
  // a brand new game starts ticking from the moment the Chief exists
  if (state.totalEarned === 0) {
    state.lastTick = Date.now();
    tell('{chief} found a warm egg in the dark and began burying it in copper, hoping to hatch it.');
  } else {
    tell('{chief} took charge of the warren.');
  }
  save();
  refresh();
}

// ---------- opening + offline progress ----------
if (loaded.kind === 'error') {
  tell(`Your old save couldn't be read (${loaded.error}). It was kept as a backup and a new game started.`);
} else if (loaded.kind === 'loaded' && loaded.migratedFrom === 1) {
  tell('The warren was rebuilt for a new way of working: crews, rooms and storage. {chief}, the chronicle and the oddities shelf came along, and the egg is back in the copper. A backup of the old save was kept.');
} else if (loaded.kind === 'loaded' && loaded.migratedFrom === 2) {
  tell('The warren was dug out again, measured in cubic paces this time, with separate stores and a place for a forge. {chief}, the chronicle and the oddities shelf came along, and the egg is back in the copper. A backup of the old save was kept.');
} else if (loaded.kind === 'loaded' && loaded.migratedFrom) {
  tell(`Save updated from version ${loaded.migratedFrom}. A backup of the old one was kept.`);
}

/** Credit all time since the last tick. Adds a chronicle line after a long absence. */
function creditTime(isReturn: boolean) {
  const before = population(state);
  report(advanceTo(state, Date.now()), before, isReturn);
}

/** Game time worked through in one go while catching up (seconds). */
const CATCH_UP_SLICE = 1800;
/** How long one go may hold the page (ms) before it lets the browser draw and take taps. */
const CATCH_UP_BUDGET_MS = 25;
let catching: Promise<void> | null = null;

/**
 * Credit time since the last tick like creditTime, but a long absence is
 * worked through half an hour at a time, letting the page draw in between.
 * A day away can take a phone several seconds to work through; this way it
 * never freezes, and closing the game part way keeps what's been worked
 * through so far (the rest is credited next time).
 */
function catchUp(): Promise<void> {
  if (catching) return catching;
  const now = Date.now();
  const elapsed = Math.max(0, (now - state.lastTick) / 1000);
  if (elapsed <= CATCH_UP_SLICE) {
    creditTime(true);
    return Promise.resolve();
  }
  const s = state;
  const credited = Math.min(elapsed, offlineCap(s));
  s.lastTick = now - credited * 1000;
  const before = population(s);
  const total = emptyAdvance(elapsed, credited);
  awayTitle.textContent = `Catching up on ${formatDuration(credited)} away…`;
  awayList.replaceChildren();
  awayEl.hidden = false;
  catching = new Promise((done) => {
    const slice = () => {
      // a save was loaded or the game started over meanwhile: that game has its own time
      if (state !== s) {
        catching = null;
        awayEl.hidden = true;
        return done();
      }
      const until = performance.now() + CATCH_UP_BUDGET_MS;
      while (s.lastTick < now && performance.now() < until) mergeResult(total, advanceTo(s, Math.min(now, s.lastTick + CATCH_UP_SLICE * 1000)));
      if (s.lastTick < now) {
        setTimeout(slice, 0);
        return;
      }
      catching = null;
      awayEl.hidden = true;
      report(total, before, true);
      refresh();
      done();
    };
    slice();
  });
  return catching;
}

/** Chronicle lines and the away card for a stretch of credited time. */
function report(r: AdvanceResult, before: number, isReturn: boolean) {
  const after = population(state);
  if (after > before) firstOnJobs();
  for (let m = Math.floor(before / 10) * 10 + 10; m <= after; m += 10) tell(`The warren has grown to ${m} kobolds.`);
  if (before < beds(state) && after >= beds(state) && after > 0) tell('Every bed in the den is taken. Newcomers will have to wait until it is dug bigger.');
  for (const d of r.dug) {
    const room = ROOMS.find((x) => x.id === d.room)!;
    const cap = roomCapacity(state, room, d.volume);
    const holds = room.holds === 'beds' ? `: ${cap} beds` : room.holds === 'herders' ? `: room for ${cap} herders` : room.holds === 'smiths' ? `: room for ${cap} blacksmiths` : '';
    tell(`The ${room.name.toLowerCase()} was dug out to ${formatNumber(d.volume)} cubic paces${holds}.`);
  }
  // research, mishaps and the dragon; after a long absence keep only the latest few
  for (const line of r.events.slice(-12)) tell(line);
  if (r.arrived > 0 || r.dug.length || r.events.length) renderer.invalidate();
  if (isReturn && r.credited >= CONFIG.awayNoticeSeconds) {
    // something silly probably happened while you were gone, more the longer it was
    const n = awayHappenings(r.credited);
    let happened = 0;
    for (let i = 0; i < n; i++) if (maybeHappen()) happened++;
    showAway(r, happened);
  }
  if (r.newStage === 1) {
    tell(DRAGON_STAGES[1].flavor);
    renderer.invalidate();
  }
}

/** A silly happening; a reward can tip the egg into hatching. */
function maybeHappen(): boolean {
  if (!happen(state, Date.now(), Math.random)) return false;
  const s = stageFor(hoardValue(state));
  if (s > state.stage) {
    state.stage = s;
    tell(DRAGON_STAGES[s].flavor);
  }
  renderer.invalidate();
  return true;
}

/** The "while you were away" card: what was gathered, lost, dug, learned and finished. */
function showAway(r: AdvanceResult, happened: number) {
  const items: string[] = [];
  const made = RESOURCES.filter((x) => r.gained[x.id] >= 1).map((x) => `${formatNumber(r.gained[x.id])} ${x.name.toLowerCase()}`);
  if (made.length) items.push(`Gathered ${made.join(', ')}.`);
  const lost = RESOURCES.filter((x) => r.lost[x.id] >= 1).map((x) => `${formatNumber(r.lost[x.id])} ${x.name.toLowerCase()}`);
  if (lost.length) items.push(`Lost for want of room: ${lost.join(', ')}.`);
  if (r.arrived > 0) items.push(`${r.arrived} new kobold${r.arrived === 1 ? '' : 's'} moved in.`);
  if (r.explored.length) items.push(`Kobolds looking for work found ${r.explored.map((id) => (areaDef(id)?.name ?? id).replace(/^\w/, (c) => c.toLowerCase())).join(', ')}.`);
  const lostJobs = Object.entries(r.died).filter(([, n]) => n > 0);
  if (lostJobs.length) items.push(`Lost ${lostJobs.map(([job, n]) => `${n} ${job}${n === 1 ? '' : 's'}`).join(' and ')} on dangerous work.`);
  if (r.starved > 0) items.push(`${r.starved} hungry kobold${r.starved === 1 ? '' : 's'} left to find food elsewhere. Put more on farming.`);
  if (r.wandered > 0) items.push(`${r.wandered} idle kobold${r.wandered === 1 ? '' : 's'} wandered off for want of work.`);
  const dug = new Map<string, number>();
  for (const d of r.dug) dug.set(d.room, d.volume);
  if (dug.size)
    items.push(`Dug out ${[...dug].map(([id, v]) => `the ${ROOMS.find((x) => x.id === id)?.name.toLowerCase() ?? id} to ${formatNumber(v)} cubic paces`).join(', ')}.`);
  const learned = r.learned.map((id) => researchDef(id)?.name).filter(Boolean);
  if (learned.length) items.push(`Learned ${learned.join(', ')}.`);
  const molted = r.events.filter((e) => e.startsWith('The dragon molted')).length;
  if (molted) items.push('The dragon molted!');
  const art = r.events.filter((e) => / finished (an|a) /.test(e) && e.includes('hoard room')).length;
  if (art) items.push(`${art} piece${art === 1 ? '' : 's'} of art finished.`);
  const other = r.events.length + happened - r.learned.length - molted - art;
  if (other > 0) items.push(`${other} other thing${other === 1 ? '' : 's'} happened. The chronicle has the stories.`);
  if (r.elapsed > r.credited + 60) items.push(`Only the first ${formatDuration(offlineCap(state))} counted.`);
  if (!items.length) return;
  awayTitle.textContent = `While you were away (${formatDuration(r.elapsed)})`;
  awayList.replaceChildren(
    ...items.map((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      return li;
    }),
  );
  awayEl.hidden = false;
}

// ---------- loops: run only while visible ----------
let tickTimer: number | undefined;
let saveTimer: number | undefined;

/** Debug speed: each real second credits this many game seconds. Not saved; a reload is back to 1×. */
let speed = 1;

function tickOnce() {
  if (catching) return;
  if (speed > 1) state.lastTick -= (speed - 1) * TICK_MS;
  // a laptop that slept with the game showing skips visibilitychange, so a long gap here is caught up like a return
  if (Date.now() - state.lastTick > CATCH_UP_SLICE * 1000) {
    catchUp();
    return;
  }
  creditTime(true);
  if (Math.random() < happeningChance(state, TICK_MS / 1000)) maybeHappen();
  updatePanels();
  chiefPanel.update();
  chronicle.update(Date.now());
  oddities.update(Date.now());
  tabs.update();
}

function resume() {
  catchUp();
  refresh();
  renderer.start();
  if (tickTimer === undefined) tickTimer = window.setInterval(tickOnce, TICK_MS);
  if (saveTimer === undefined) saveTimer = window.setInterval(save, AUTOSAVE_MS);
}

function pause() {
  // part way through catching up, the rest is picked up again on return
  if (!catching) creditTime(false);
  save();
  renderer.stop();
  clearInterval(tickTimer);
  clearInterval(saveTimer);
  tickTimer = saveTimer = undefined;
}

document.addEventListener('visibilitychange', () => (document.hidden ? pause() : resume()));
window.addEventListener('pagehide', () => {
  if (!catching) creditTime(false);
  save();
});
if (!document.hidden) resume();
else refresh();

// ---------- settings ----------
const motionBtn = document.querySelector('#motion') as HTMLButtonElement;
function showMotion() {
  motionBtn.textContent = state.settings.motion === 'low' ? 'Animation: low (1 fps)' : 'Animation: normal';
}
if (loaded.kind === 'new' && matchMedia('(prefers-reduced-motion: reduce)').matches) state.settings.motion = 'low';
showMotion();
const goalBtn = document.querySelector('#goal-toggle') as HTMLButtonElement;
function showGoalSetting() {
  goalBtn.textContent = state.settings.goal ? 'Next-goal line: on' : 'Next-goal line: off';
}
showGoalSetting();
goalBtn.addEventListener('click', () => {
  state.settings.goal = !state.settings.goal;
  showGoalSetting();
  updatePanels();
  save();
});
motionBtn.addEventListener('click', () => {
  state.settings.motion = state.settings.motion === 'low' ? 'normal' : 'low';
  showMotion();
  renderer.invalidate();
  save();
});

const saveText = document.querySelector('#save-text') as HTMLTextAreaElement;


const saveStatus = document.querySelector('#save-status') as HTMLElement;

document.querySelector('#export')!.addEventListener('click', async () => {
  creditTime(false);
  const text = exportSave(state, Date.now());
  saveText.value = text;
  saveText.select();
  try {
    await navigator.clipboard.writeText(text);
    saveStatus.textContent = 'Save copied to the clipboard and shown above.';
  } catch {
    saveStatus.textContent = 'Save shown above. Copy it somewhere safe.';
  }
});

document.querySelector('#download')!.addEventListener('click', () => {
  creditTime(false);
  const blob = new Blob([exportSave(state, Date.now())], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `idle-hoard-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  saveStatus.textContent = 'Save downloaded.';
});

function applyImport(text: string) {
  try {
    const imported = importSave(text, Date.now());
    state = imported;
    creditTime(true);
    save();
    showMotion();
    showGoalSetting();
    refresh();
    saveStatus.textContent = 'Save loaded.';
  } catch (e) {
    saveStatus.textContent = `Couldn't load that save: ${(e as Error).message}`;
  }
}

const importBtn = document.querySelector('#import') as HTMLButtonElement;
importBtn.addEventListener('click', () => {
  if (!saveText.value.trim()) {
    saveStatus.textContent = 'Paste a save into the box first.';
    return;
  }
  if (confirmTap(importBtn, 'Tap again to replace your game')) applyImport(saveText.value);
});
document.querySelector('#import-file')!.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) applyImport(await file.text());
});

function startOver() {
  const motion = state.settings.motion;
  state = newGame(Date.now());
  state.settings.motion = motion;
  save();
  refresh();
}
const resetBtn = document.querySelector('#reset') as HTMLButtonElement;
resetBtn.addEventListener('click', () => {
  if (confirmTap(resetBtn, 'Tap again to erase your hoard')) startOver();
});

// ---------- debug tools (folded away in settings) ----------
const debugStatus = document.querySelector('#debug-status') as HTMLElement;
const speedBadge = document.querySelector('#speed-badge') as HTMLElement;
const speedBtns = [...document.querySelectorAll<HTMLButtonElement>('#debug-speed button')];
function showSpeed() {
  for (const b of speedBtns) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === speed));
  speedBadge.hidden = speed === 1;
  speedBadge.textContent = `${speed}×`;
}
showSpeed();
for (const b of speedBtns)
  b.addEventListener('click', () => {
    speed = Number(b.dataset.speed) || 1;
    showSpeed();
  });
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-skip]'))
  b.addEventListener('click', async () => {
    if (catching || !state.chief) return;
    const secs = Math.min(Number(b.dataset.skip) || 0, offlineCap(state));
    creditTime(false);
    state.lastTick -= secs * 1000;
    debugStatus.textContent = `Skipping ${formatDuration(secs)}…`;
    await catchUp();
    refresh();
    save();
    debugStatus.textContent = `Skipped ${formatDuration(secs)}.`;
  });
const debugReset = document.querySelector('#debug-reset') as HTMLButtonElement;
debugReset.addEventListener('click', () => {
  if (!confirmTap(debugReset, 'Tap again to reset everything')) return;
  speed = 1;
  showSpeed();
  startOver();
  debugStatus.textContent = 'Progress reset.';
});

// ---------- debug readout: add ?debug to the URL ----------
if (new URLSearchParams(location.search).has('debug')) {
  const el = document.querySelector('#debug') as HTMLElement;
  el.hidden = false;
  let last = renderer.draws;
  setInterval(() => {
    el.textContent = `canvas draws last 5s: ${renderer.draws - last} · hidden: ${document.hidden}`;
    last = renderer.draws;
  }, 5000);
  // handy in the console: hoard.state, hoard.save()
  (window as any).hoard = { get state() { return state; }, save, skip: (s: number) => { state.lastTick -= s * 1000; catchUp(); refresh(); } };
}

import './style.css';
import { SKILLS, type Chief } from './game/chief';
import { CONFIG, DRAGON_STAGES, UPGRADES, WORKERS } from './game/data';
import { advanceTo, offlineCap, stageFor } from './game/economy';
import { happen, happeningChance } from './game/happenings';
import { browserStore, exportSave, importSave, load, write } from './game/save';
import { addChronicle, newGame, type GameState } from './game/state';
import { Renderer } from './render/renderer';
import { ChiefPanel } from './ui/chief-panel';
import { ChronicleView } from './ui/chronicle';
import { confirmTap } from './ui/dom';
import { formatDuration, formatNumber } from './ui/format';
import { Hud } from './ui/hud';

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

const hud = new Hud(getState, (kind, id) => {
  if (kind === 'hire') {
    const def = WORKERS.find((w) => w.id === id);
    if (def && state.workers[id] === 1) tell(def.joinText);
  } else {
    const u = UPGRADES.find((x) => x.id === id);
    if (u) tell(`{chief} ordered ${u.name.toLowerCase()} for the warren.`);
  }
  refresh();
});
const chiefPanel = new ChiefPanel(
  getState,
  (skillId) => {
    const sk = SKILLS.find((x) => x.id === skillId);
    if (sk) tell(`{chief} learned ${sk.name}.`);
    refresh();
    save();
  },
  (chief) => foundChief(chief),
);
const chronicle = new ChronicleView(getState);
const renderer = new Renderer(document.querySelector('#scene') as HTMLCanvasElement, getState);

function refresh() {
  hud.update();
  chiefPanel.update();
  chronicle.update(Date.now());
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
} else if (loaded.kind === 'loaded' && loaded.migratedFrom) {
  tell(`Save updated from version ${loaded.migratedFrom}. A backup of the old one was kept.`);
}
creditTime(true);

/** Credit all time since the last tick. Adds a chronicle line after a long absence. */
function creditTime(isReturn: boolean) {
  const r = advanceTo(state, Date.now());
  if (isReturn && r.credited >= CONFIG.awayNoticeSeconds && r.gained > 0) {
    const capped = r.elapsed > r.credited ? ` Only the first ${formatDuration(offlineCap(state))} counted.` : '';
    tell(`While you were away for ${formatDuration(r.elapsed)}, the warren buried ${formatNumber(r.gained)} copper.${capped}`);
    // something silly probably happened while you were gone
    if (r.credited >= 30 * 60) maybeHappen();
  }
  if (r.newStage !== null) {
    tell(DRAGON_STAGES[r.newStage].flavor);
    renderer.invalidate();
  }
}

/** A silly happening; a reward can tip the dragon into its next stage. */
function maybeHappen() {
  if (!happen(state, Date.now(), Math.random)) return;
  const s = stageFor(state.totalEarned);
  if (s > state.stage) {
    state.stage = s;
    tell(DRAGON_STAGES[s].flavor);
  }
  renderer.invalidate();
}

// ---------- loops: run only while visible ----------
let tickTimer: number | undefined;
let saveTimer: number | undefined;

function tickOnce() {
  creditTime(false);
  if (Math.random() < happeningChance(TICK_MS / 1000)) maybeHappen();
  hud.update();
  chiefPanel.update();
  chronicle.update(Date.now());
}

function resume() {
  creditTime(true);
  refresh();
  renderer.start();
  if (tickTimer === undefined) tickTimer = window.setInterval(tickOnce, TICK_MS);
  if (saveTimer === undefined) saveTimer = window.setInterval(save, AUTOSAVE_MS);
}

function pause() {
  creditTime(false);
  save();
  renderer.stop();
  clearInterval(tickTimer);
  clearInterval(saveTimer);
  tickTimer = saveTimer = undefined;
}

document.addEventListener('visibilitychange', () => (document.hidden ? pause() : resume()));
window.addEventListener('pagehide', () => {
  creditTime(false);
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

const resetBtn = document.querySelector('#reset') as HTMLButtonElement;
resetBtn.addEventListener('click', () => {
  if (!confirmTap(resetBtn, 'Tap again to erase your hoard')) return;
  const motion = state.settings.motion;
  state = newGame(Date.now());
  state.settings.motion = motion;
  save();
  refresh();
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
  (window as any).hoard = { get state() { return state; }, save, skip: (s: number) => { state.lastTick -= s * 1000; creditTime(true); refresh(); } };
}

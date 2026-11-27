import './style.css';
import { CONFIG, DRAGON_STAGES } from './game/data';
import { advanceTo } from './game/economy';
import { browserStore, exportSave, importSave, load, write } from './game/save';
import { newGame, type GameState } from './game/state';
import { Renderer } from './render/renderer';
import { Hud } from './ui/hud';
import { formatDuration, formatNumber } from './ui/format';

const TICK_MS = 1000;
const AUTOSAVE_MS = 60_000;

const store = browserStore;
const loaded = load(store, Date.now());
let state: GameState = loaded.state;
const getState = () => state;

const hud = new Hud(getState, () => {
  hud.update();
  renderer.invalidate();
});
const renderer = new Renderer(document.querySelector('#scene') as HTMLCanvasElement, getState);

function save() {
  write(store, state, Date.now());
}

// ---------- opening message + offline progress ----------
if (loaded.kind === 'new') {
  hud.say(DRAGON_STAGES[0].flavor);
} else if (loaded.kind === 'error') {
  hud.say(`Your old save couldn't be read (${loaded.error}). It was kept as a backup and a new game started.`);
} else {
  hud.say(loaded.migratedFrom ? `Save updated from version ${loaded.migratedFrom}. A backup of the old one was kept.` : 'Welcome back.');
}
creditTime(true);

/** Credit all time since the last tick. Shows a note after a long absence. */
function creditTime(isReturn: boolean) {
  const r = advanceTo(state, Date.now());
  if (r.newStage !== null) hud.say(DRAGON_STAGES[r.newStage].flavor);
  else if (isReturn && r.credited >= CONFIG.awayNoticeSeconds && r.gained > 0) {
    const capped = r.elapsed > r.credited ? ` (progress is capped at ${formatDuration(CONFIG.offlineCapSeconds)})` : '';
    hud.say(`While you were away for ${formatDuration(r.elapsed)}, your kobolds buried ${formatNumber(r.gained)} copper${capped}.`);
  }
  if (r.newStage !== null) renderer.invalidate();
}

// ---------- loops: run only while visible ----------
let tickTimer: number | undefined;
let saveTimer: number | undefined;

function resume() {
  creditTime(true);
  hud.update();
  renderer.start();
  if (tickTimer === undefined)
    tickTimer = window.setInterval(() => {
      creditTime(false);
      hud.update();
    }, TICK_MS);
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
else hud.update();

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
    if (!confirm('Replace your current game with this save?')) return;
    state = imported;
    creditTime(true);
    save();
    showMotion();
    hud.update();
    renderer.invalidate();
    saveStatus.textContent = 'Save loaded.';
  } catch (e) {
    saveStatus.textContent = `Couldn't load that save: ${(e as Error).message}`;
  }
}

document.querySelector('#import')!.addEventListener('click', () => applyImport(saveText.value));
document.querySelector('#import-file')!.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) applyImport(await file.text());
});

document.querySelector('#reset')!.addEventListener('click', () => {
  if (!confirm('Start over? Your current hoard will be lost unless you exported it.')) return;
  const motion = state.settings.motion;
  state = newGame(Date.now());
  state.settings.motion = motion;
  save();
  hud.say(DRAGON_STAGES[0].flavor);
  hud.update();
  renderer.invalidate();
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
  (window as any).hoard = { get state() { return state; }, save, skip: (s: number) => { state.lastTick -= s * 1000; creditTime(true); hud.update(); } };
}

import './style.css';
import type { Chief } from './game/chief';
import { CONFIG, DRAGON_STAGES, JOBS, RESOURCES, ROOMS, UPGRADES } from './game/data';
import { advanceTo, beds, offlineCap, population, roomCapacity, stageFor, workers } from './game/economy';
import { happen, happeningChance } from './game/happenings';
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
import { NamedView } from './ui/named-view';
import { animalName } from './game/dragon';
import { fullName } from './game/kobolds';
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

const hud = new Hud(getState, (e) => {
  if (e.kind === 'assign') firstOnJobs();
  else if (e.kind === 'dig' && e.room) {
    const room = ROOMS.find((r) => r.id === e.room);
    if (room) tell(`{chief} set the diggers to work on the ${room.name.toLowerCase()}.`);
  } else if (e.kind === 'upgrade') {
    const u = UPGRADES.find((x) => x.id === e.id);
    if (u) tell(u.effect.kind === 'appeal' ? `${u.name} now stands in the hoard room.` : `{chief} ordered ${u.name.toLowerCase()} for the warren.`);
  } else if (e.kind === 'herd') tell(`{chief} had the pasture switched over to ${animalName(e.animal)}. The new herd will take half an hour to settle.`);
  refresh();
});
const dragonView = new DragonView(getState, (line) => {
  tell(line);
  refresh();
  save();
});
const researchView = new ResearchView(getState, (id) => {
  const def = id ? researchDef(id) : undefined;
  if (def) tell(`{chief} told the researchers to work on ${def.name.toLowerCase()}.`);
  refresh();
});
const forgeView = new ForgeView(getState, () => {
  refresh();
  save();
});
const namedView = new NamedView(getState, (k, what) => {
  if (what === 'lieutenant') tell(`{chief} made ${fullName(k)} a lieutenant.`);
  else if (what === 'stand-down') tell(`${fullName(k)} stepped down as lieutenant.`);
  refresh();
  save();
});
const chiefPanel = new ChiefPanel(getState, (chief) => foundChief(chief));
const chronicle = new ChronicleView(getState);
const oddities = new OdditiesView(getState);
const renderer = new Renderer(document.querySelector('#scene') as HTMLCanvasElement, getState);

function updatePanels() {
  hud.update();
  dragonView.update();
  researchView.update();
  forgeView.update();
  namedView.update(Date.now());
}

function refresh() {
  updatePanels();
  chiefPanel.update();
  chronicle.update(Date.now());
  oddities.update(Date.now());
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
creditTime(true);

/** Credit all time since the last tick. Adds a chronicle line after a long absence. */
function creditTime(isReturn: boolean) {
  const before = population(state);
  const r = advanceTo(state, Date.now());
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
  const made = RESOURCES.filter((x) => r.gained[x.id] >= 1).map((x) => `${formatNumber(r.gained[x.id])} ${x.name.toLowerCase()}`);
  if (isReturn && r.credited >= CONFIG.awayNoticeSeconds && made.length) {
    const capped = r.elapsed > r.credited ? ` Only the first ${formatDuration(offlineCap(state))} counted.` : '';
    const moved = r.arrived > 0 ? ` ${r.arrived} new kobold${r.arrived === 1 ? '' : 's'} moved in.` : '';
    const lost = RESOURCES.filter((x) => r.lost[x.id] >= 1).map((x) => x.name.toLowerCase());
    const full = lost.length ? ` Some ${lost.join(' and ')} was lost because there was no room for it.` : '';
    tell(`While you were away for ${formatDuration(r.elapsed)}, the warren gathered ${made.join(', ')}.${moved}${full}${capped}`);
    // something silly probably happened while you were gone
    if (r.credited >= 30 * 60) maybeHappen();
  }
  if (r.newStage === 1) {
    tell(DRAGON_STAGES[1].flavor);
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
  updatePanels();
  chiefPanel.update();
  chronicle.update(Date.now());
  oddities.update(Date.now());
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

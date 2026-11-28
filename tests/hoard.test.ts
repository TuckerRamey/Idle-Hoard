// The hoard as the point of the game: precious metals, the dragon's size and
// refining, art in the hoard room, and the Chief growing.
import { describe, expect, it } from 'vitest';
import { ART, ART_MATERIALS, artisans, canBecomeArtisan, display, displaySlots, makeArtisan } from '../src/game/art';
import { MAX_PIPS, spendPip, type Chief } from '../src/game/chief';
import { DRAGON_STAGES } from '../src/game/data';
import { grantRequest, MOLTS, moltNeeds, REFINE, SIZE, sizeCap } from '../src/game/dragon';
import { capacity, hoardValue, resourceOpen, stageFor, tick } from '../src/game/economy';
import { HAPPENINGS, happen } from '../src/game/happenings';
import { addHistory, nameKobold } from '../src/game/kobolds';
import { newGame, rng, type GameState } from '../src/game/state';

const T0 = 1_700_000_000_000;
const chief: Chief = { name: 'Snik', cunning: 1, voice: 1, nerve: 1, quirk: 'none' };

function game(): GameState {
  const s = newGame(T0);
  s.chief = { ...chief };
  s.newcomerJob = 'idle';
  s.seed = 12345;
  return s;
}

/** A hatched, fed dragon with a pasture going. */
function fed(stage = 1): GameState {
  const s = game();
  s.stage = stage;
  s.research.done.push('crab-wrangling');
  s.res.meat = 1_000;
  s.crews.herder = { n: 3 };
  s.dragon.hungry = false;
  s.dragon.nextRequestAt = 1e12;
  s.rooms.hoard.volume = 2_000;
  return s;
}

describe('precious metals', () => {
  it('silver and gold come with the dragon, not research', () => {
    const s = game();
    expect(resourceOpen(s, 'silver')).toBe(false);
    s.stage = 1;
    expect(resourceOpen(s, 'silver')).toBe(true);
    expect(resourceOpen(s, 'gold')).toBe(false);
    s.stage = 2;
    expect(resourceOpen(s, 'gold')).toBe(true);
  });

  it('share the hoard room, and better metals take less space for their worth', () => {
    const s = game();
    s.stage = 1;
    const room = capacity(s, 'copper');
    s.res.copper = room / 2;
    expect(capacity(s, 'copper')).toBe(room);
    expect(capacity(s, 'silver')).toBe(room); // half the room left, and silver packs twice as tight
    expect(hoardValue(s)).toBe(room / 2);
    s.res.silver = 10;
    expect(hoardValue(s)).toBe(room / 2 + 100);
  });

  it('the egg hatches from the hoard worth', () => {
    expect(stageFor(DRAGON_STAGES[1].threshold! - 1)).toBe(0);
    expect(stageFor(DRAGON_STAGES[1].threshold!)).toBe(1);
  });
});

describe('the dragon grows and refines', () => {
  it('does nothing before it eats meat', () => {
    const s = game();
    s.stage = 1;
    s.res.copper = 1_000;
    tick(s, 3600);
    expect(s.res.silver).toBe(0);
    expect(s.dragon.size).toBe(SIZE.hatch);
  });

  it('while content, eats copper and sheds silver, gaining worth', () => {
    const s = fed();
    s.chief = null; // no Chief bringing in copper of their own
    s.res.copper = 1_000;
    const before = hoardValue(s);
    tick(s, 600);
    expect(s.res.silver).toBeGreaterThan(0);
    expect(s.res.copper).toBeLessThan(1_000);
    expect(hoardValue(s)).toBeGreaterThan(before);
    expect(s.res.copper + s.res.silver * REFINE.copperPerSilver).toBeCloseTo(1_000);
  });

  it('grows into the hoard room, up to its stage limit', () => {
    const s = fed();
    s.rooms.hoard.volume = 100;
    expect(sizeCap(s)).toBe(50);
    tick(s, 10 * 3600);
    expect(s.dragon.size).toBeCloseTo(50);
    s.rooms.hoard.volume = 1e6;
    expect(sizeCap(s)).toBe(SIZE.capByStage[1]);
  });

  it('makes gold once it is a young dragon', () => {
    const s = fed(2);
    s.dragon.size = 1_000;
    s.res.silver = 1_000;
    tick(s, 600);
    expect(s.res.gold).toBeGreaterThan(0);
  });

  it('the first evolution needs a hoard worth, but no art; the second needs art', () => {
    const s = fed();
    expect(moltNeeds(s)!.some((n) => /worth/.test(n.label))).toBe(true);
    expect(moltNeeds(s)!.some((n) => /art/.test(n.label))).toBe(false);
    s.stage = 2;
    expect(moltNeeds(s)!.some((n) => /art/.test(n.label))).toBe(true);
    expect(MOLTS[0].pieces).toBe(0);
  });
});

describe('art', () => {
  function withArtist(): { s: GameState; id: number } {
    const s = game();
    s.research.done.push('artistry');
    s.crews.quarrier = { n: 2 };
    const k = nameKobold(s, 'quarrier', 'the Test', 'Was tested.', T0, rng(s))!;
    k.loves = 'quarrier';
    return { s, id: k.id };
  }

  it('needs artistry and an experienced named kobold', () => {
    const { s, id } = withArtist();
    const k = s.named.find((x) => x.id === id)!;
    expect(canBecomeArtisan(s, k)).toBe(false);
    for (let i = 0; i < ART.experiences; i++) addHistory(k, T0, 'Did a thing.');
    expect(canBecomeArtisan(s, k)).toBe(true);
    s.research.done = [];
    expect(canBecomeArtisan(s, k)).toBe(false);
  });

  it('an artisan finishes a signed piece with materials, and it goes on display', () => {
    const { s, id } = withArtist();
    const k = s.named.find((x) => x.id === id)!;
    for (let i = 0; i < ART.experiences; i++) addHistory(k, T0, 'Did a thing.');
    expect(makeArtisan(s, id, T0)).toBe(true);
    expect(artisans(s)).toHaveLength(1);
    s.crews.quarrier = { n: 0 }; // no new stone while they work
    s.chief = null;
    s.res.stone = 1_000;
    s.res.wood = 1_000;
    const r = tick(s, ART.hours * 3600 + 20);
    expect(s.art.pieces).toHaveLength(1);
    const p = s.art.pieces[0];
    expect(p.material).toBe('carving'); // they love quarrying
    expect(p.by).toContain(k.name);
    expect(s.res.stone).toBe(1_000 - ART_MATERIALS.find((m) => m.id === 'carving')!.cost.stone!);
    expect(r.events.some((e) => e.includes('finished'))).toBe(true);
  });

  it('a full hoard room swaps out its weakest piece for a better one', () => {
    const s = game();
    const slots = displaySlots(s);
    for (let i = 0; i < slots; i++) display(s, { id: i, title: `p${i}`, by: '', material: 'totem', appeal: 5 + i, t: T0 });
    expect(display(s, { id: 99, title: 'worse', by: '', material: 'totem', appeal: 1, t: T0 })).toBe(false);
    expect(display(s, { id: 100, title: 'better', by: '', material: 'statue', appeal: 50, t: T0 })).toBe(true);
    expect(s.art.pieces.map((p) => p.title)).not.toContain('p0');
    s.rooms.hoard.volume *= 10;
    expect(displaySlots(s)).toBeGreaterThan(slots);
  });
});

describe('the Chief grows', () => {
  it('evolving earns a pip of your choice, up to the cap', () => {
    const s = fed();
    const m = MOLTS[0];
    s.rooms.hoard.volume = m.hoard;
    s.res.copper = m.value;
    s.dragon.granted = m.granted;
    s.dragon.content = m.contentHours * 3600;
    tick(s, 10);
    expect(s.stage).toBe(2);
    expect(s.chiefMarks.pending).toBe(1);
    expect(spendPip(s, 'nerve')).toBe(true);
    expect(s.chief!.nerve).toBe(2);
    expect(spendPip(s, 'nerve')).toBe(false);
    s.chiefMarks.pending = 10;
    s.chief!.voice = MAX_PIPS;
    expect(spendPip(s, 'voice')).toBe(false);
  });

  it('granted requests no longer earn pips', () => {
    const s = fed();
    s.res.wood = 1e6;
    s.dragon.favor = 9;
    s.dragon.request = { kind: 'give', resource: 'wood', amount: 1, text: 'x', until: 1e12 };
    grantRequest(s, T0, rng(s));
    expect(s.chiefMarks.pending).toBe(0);
  });

  it('every five kinds of oddity makes the Chief more cunning', () => {
    const s = game();
    for (const id of ['a', 'b', 'c', 'd', 'e']) s.oddities[id] = { count: 1, firstAt: T0 };
    const r = tick(s, 1);
    expect(s.chief!.cunning).toBe(2);
    expect(r.events.some((e) => /Cunning \+1/.test(e))).toBe(true);
    tick(s, 1);
    expect(s.chief!.cunning).toBe(2);
  });

  it('a lesson happening raises a stat once', () => {
    const s = game();
    const lesson = HAPPENINGS.find((h) => h.id === 'rival-band')!;
    expect(lesson.chiefPip).toBe('voice');
    // force it: everything else ineligible, and the rarity roll passes
    let n = 0;
    const rand = () => (n++ === 0 ? 0 : 0.01);
    const saved = HAPPENINGS.splice(0, HAPPENINGS.length, lesson);
    try {
      expect(happen(s, T0, rand)?.id).toBe('rival-band');
      expect(s.chief!.voice).toBe(2);
      expect(happen(s, T0, rand)).toBeNull();
    } finally {
      HAPPENINGS.splice(0, HAPPENINGS.length, ...saved);
    }
  });
});

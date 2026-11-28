// The next-goal line: one short suggestion of what to aim for next. It only
// reads the state; it never changes anything.

import { DRAGON_STAGES } from './data';
import { moltNeeds } from './dragon';
import { beds, diggersIn, hoardValue, population, workers } from './economy';
import { opened } from './research';
import type { GameState } from './state';

export function nextGoal(state: GameState): string | null {
  if (!state.chief) return null;
  const full = population(state) >= beds(state);
  if (state.stage === 0) {
    if (full && diggersIn(state, 'den') === 0) return 'Next: put some diggers on the den, so more kobolds can move in.';
    const hatch = DRAGON_STAGES[1].threshold ?? 0;
    return `Next: a hoard worth ${hatch.toLocaleString('en-US')} copper hatches the egg (${Math.floor(hoardValue(state)).toLocaleString('en-US')} so far).`;
  }
  if (!opened(state, 'crab-wrangling'))
    return workers(state, 'researcher') > 0
      ? 'Next: research crab wrangling, so the dragon has something to eat.'
      : 'Next: put some kobolds on research and work toward crab wrangling, so the dragon has something to eat.';
  if (state.dragon.hungry) return 'Next: the dragon is hungry. Put more kobolds on herding.';
  const needs = moltNeeds(state);
  const need = needs?.find((n) => !n.met);
  if (need) return `Next molt: ${need.label.charAt(0).toLowerCase()}${need.label.slice(1)} (${need.have.toLocaleString('en-US')} so far).`;
  if (needs) return 'Next: everything is ready. The dragon will molt any moment.';
  return 'The dragon is fully grown. Keep the hoard growing.';
}

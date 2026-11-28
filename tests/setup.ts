// Kobolds eating is switched off for every test file but the food tests, so
// the long runs elsewhere test what they're about rather than a warren
// starving for want of farmers. tests/food.test.ts switches it back on.
import { FOOD } from '../src/game/losses';

FOOD.perKobold = 0;

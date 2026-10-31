import test from 'node:test';
import assert from 'node:assert/strict';
import { calc } from '../src/calc.js';
test('calc adds one', () => assert.equal(calc(1), 2));

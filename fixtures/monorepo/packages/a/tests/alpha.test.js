import test from 'node:test';
import assert from 'node:assert/strict';
import { alpha } from '../src/alpha.js';
test('alpha adds one', () => assert.equal(alpha(1), 2));

import test from 'node:test';
import assert from 'node:assert/strict';
import { beta } from '../src/beta.js';
test('beta adds one', () => assert.equal(beta(1), 2));

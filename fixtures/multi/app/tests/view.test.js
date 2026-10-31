import test from 'node:test';
import assert from 'node:assert/strict';
import { view } from '../src/view.js';
test('view adds one', () => assert.equal(view(1), 2));

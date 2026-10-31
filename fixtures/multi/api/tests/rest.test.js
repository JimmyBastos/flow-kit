import test from 'node:test';
import assert from 'node:assert/strict';
import { rest } from '../src/rest.js';
test('rest adds one', () => assert.equal(rest(1), 2));

import test from 'node:test';
import assert from 'node:assert/strict';
import { greet } from '../src/greeter.js';

test('sample issue is resolved by greeting a user', () => assert.equal(greet('Codex'), 'Hello, Codex!'));
test('empty names are rejected', () => assert.throws(() => greet('  '), /name is required/));

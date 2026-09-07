const test = require('node:test');
const assert = require('node:assert/strict');
const { assertLatestMainBase } = require('../src/base-sync-guard.cjs');

test('base sync guard fetches origin and requires latest main ancestor', () => {
  const calls = [];
  const result = assertLatestMainBase('repo', 'base', (root, args) => { calls.push(args); if (args[0] === 'rev-parse') return 'main'; return ''; });
  assert.deepEqual(result, { latestMain: 'main', baseRevision: 'base', synchronized: true });
  assert.deepEqual(calls, [['fetch', 'origin'], ['rev-parse', 'origin/main'], ['merge-base', '--is-ancestor', 'main', 'base']]);
});

test('base sync guard fails closed when fetch or comparison is unavailable', () => {
  assert.throws(() => assertLatestMainBase('repo', 'base', () => { throw new Error('AUTH_FAILED'); }), /BASE_SYNC_REQUIRED/);
});

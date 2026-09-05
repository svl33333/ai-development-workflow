import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFinding } from '../src/review.js';

test('only blocking in-scope findings without specification change auto-fix', () => {
  assert.equal(classifyFinding({ severity: 'IMPORTANT', blocks_progress: true, requires_spec_change: false, in_scope: true }).action, 'AUTO_FIX_TEST_REVIEW');
  assert.equal(classifyFinding({ severity: 'IMPORTANT', blocks_progress: false, requires_spec_change: false, in_scope: true }).action, 'RECORD');
  assert.equal(classifyFinding({ severity: 'CRITICAL', blocks_progress: true, requires_spec_change: true, in_scope: true }).action, 'HUMAN_DECISION');
});

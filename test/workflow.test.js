import test from 'node:test';
import assert from 'node:assert/strict';
import { nextStage, canTransition } from '../src/workflow.js';
import { createApproval } from '../src/approvals.js';
import { createRequest, sanitizeRequest, parseResponse } from '../src/adapters/chatgpt-c2c.js';
import { desiredProject, verifyProject } from '../src/adapters/chatgpt-project.js';

test('production grilling stops for specification approval before Issue creation', () => {
  assert.equal(nextStage('production_grilling'), 'production_spec_waiting_approval');
  assert.equal(canTransition('production_grilling', 'production_issue_ready'), false);
});

test('production Issue review is an explicit approval gate after Issue creation', () => {
  assert.equal(nextStage('production_spec_waiting_approval'), 'production_issue_creating');
  assert.equal(nextStage('production_issue_creating'), 'production_issue_waiting_review');
  assert.equal(nextStage('production_issue_waiting_review'), 'production_issue_ready');
  assert.equal(createApproval({ kind: 'production_issue_review', approved_by: 'human', work_id: 'w', presentation_id: 'p', artifact_digest: 'd', canonical_revision: 'r', issue_identity: { repository: 'o/r', number: 1 } }).valid, true);
});

test('approval kinds bind dangerous operations and artifacts', () => {
  assert.throws(() => createApproval({ kind: 'destructive_operation', approved_by: 'human', work_id: 'w' }), /operation_id/);
  assert.equal(createApproval({ kind: 'production_spec', approved_by: 'human', work_id: 'w', artifact_version: 1 }).valid, true);
});

test('C2C request is bounded and secret-like content is rejected', () => {
  const request = createRequest({ taskId: 't', iteration: 1, operation: 'pr_review', workspace: 'repo', workId: 'w', stage: 'production_pr_review', expected: 'DONE' });
  assert.equal(sanitizeRequest(request).protocol, 'c2c');
  assert.throws(() => sanitizeRequest({ ...request, inputs: ['.env'] }), /forbidden/);
  assert.equal(parseResponse({ state: 'DONE', status: 'ok', findings: [] }).state, 'DONE');
});

test('prototype and production Projects are distinct', () => {
  assert.notEqual(desiredProject('prototype').name, desiredProject('production').name);
  assert.equal(verifyProject(desiredProject('prototype'), 'prototype'), true);
  assert.equal(verifyProject({ name: 'wrong', purpose: 'wrong' }, 'prototype'), false);
});

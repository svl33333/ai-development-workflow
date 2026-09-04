import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StateStore, parseFrontMatter } from '../src/state-store.js';
import { validateProduct } from '../src/validation.js';

test('front matter round-trip preserves markdown body and agent state', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-workflow-')); const store = new StateStore(root);
  await store.setup({ project_id: 'test-product' }); const before = await store.read();
  await store.update((state) => ({ ...state, stage: 'prototype_design', next_action: 'chatgpt_prototype_design', artifacts: [{ kind: 'concept', path: 'concept.md', version: 1 }], agent_state: { ...state.agent_state, stage: 'prototype_design', next_action: 'chatgpt_prototype_design' } }));
  const after = await store.read(); assert.equal(after.state.stage, 'prototype_design'); assert.deepEqual(after.state.artifacts, [{ kind: 'concept', path: 'concept.md', version: 1 }]); assert.match(after.body, /AI workflow state/); assert.equal(after.state.revision, 2);
});

test('parser rejects missing front matter', () => assert.throws(() => parseFrontMatter('# no'), /front matter/));

test('parser accepts cloned state files with CRLF line endings', () => {
  const parsed = parseFrontMatter('---\r\nproject_id: cloned\r\nwork_id: work-1\r\n---\r\n# body\r\n');
  assert.equal(parsed.meta.project_id, 'cloned');
  assert.equal(parsed.meta.work_id, 'work-1');
  assert.match(parsed.body, /# body/);
});

test('production PR stages require a Git repository outside fixtures', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-workflow-git-evidence-'));
  const store = new StateStore(root);
  await store.setup({ project_id: 'git-evidence' });
  await store.update((state) => ({ ...state, stage: 'production_pr_review', status: 'ready', next_action: 'human_approve_publish', agent_state: { ...state.agent_state, stage: 'production_pr_review', status: 'ready', next_action: 'human_approve_publish' } }));
  const result = await validateProduct(root);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.id === 'GIT_REPOSITORY_REQUIRED'));
});

test('stale expected revision is rejected without overwriting current state', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-workflow-conflict-')); const store = new StateStore(root); await store.setup({ project_id: 'conflict' });
  await assert.rejects(() => store.update((state) => state, 0), /revision conflict/); assert.equal((await store.read()).state.revision, 1);
});

test('lock collision never removes the owner lock', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-workflow-lock-')); const store = new StateStore(root); await store.setup({ project_id: 'lock-product' });
  let release; const held = new Promise((resolve) => { release = resolve; });
  const first = store.withLock('lock-work', async () => held);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await assert.rejects(() => store.withLock('lock-work', async () => {}), /state lock exists/);
  await fs.access(path.join(root, '.ai-workflow', 'locks', 'lock-work.lock'));
  release(); await first;
});


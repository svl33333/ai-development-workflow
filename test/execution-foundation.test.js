import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { TaskScheduler, canMigrate } from '../src/task-scheduler.js';
import { WorktreeManager } from '../src/worktree-manager.js';
import { IntegrationManager } from '../src/integration-manager.js';
import { ChildTaskRunner } from '../src/child-task-runner.js';

const unit = (id, deps = []) => ({ unit_id: id, purpose: id, dependency_ids: deps, change_scope: [`src/${id}.js`], acceptance_criteria: ['works'], unit_tests: ['test'], integration_criteria: ['integrates'] });
const result = (id, generation = 1) => ({ unit_id: id, run_id: `${id}-run`, generation, base_revision: 'base', status: 'SUCCEEDED', commit: `${id}-commit`, tests: { ok: true }, local_review: { reviewer: 'codex', reviewed_revision: `${id}-commit`, findings: [], blocking_count: 0, disposition: 'approved' }, artifact_digest: `${id}-digest` });

test('scheduler executes independent units in parallel and rejects cycles', () => {
  const scheduler = new TaskScheduler(); scheduler.load({ max_parallel_codex_tasks: 3, units: [unit('a'), unit('b'), unit('c', ['a'])] });
  assert.deepEqual(scheduler.ready().map((u) => u.unit_id), ['a', 'b']); scheduler.start('a'); scheduler.start('b');
  assert.throws(() => scheduler.start('c'), /not ready/); scheduler.complete('a', result('a')); scheduler.complete('b', result('b')); scheduler.start('c');
  assert.throws(() => new TaskScheduler().load({ max_parallel_codex_tasks: 3, units: [unit('a', ['b']), unit('b', ['a'])] }), /dependency cycle/);
});

test('superseded generation rejects state-changing operations', () => {
  const scheduler = new TaskScheduler({ generation: 1 }); scheduler.load({ max_parallel_codex_tasks: 3, units: [unit('a')] }); scheduler.activateSuccessor(2);
  assert.throws(() => scheduler.start('a', 1), /superseded/); assert.deepEqual(canMigrate({ active_children: 0 }), { ok: true, blockers: [] }); assert.equal(canMigrate({ active_children: 1 }).ok, false);
});

test('integration requires local review and generation match', async () => {
  const manager = new IntegrationManager({ generation: 1, integrate: async () => {}, test: async () => ({ ok: true }) });
  await assert.rejects(() => manager.integrateResult({ ...result('a'), local_review: { reviewer: 'codex', reviewed_revision: 'a', findings: [], blocking_count: 1, disposition: 'changes_required' } }), /local review gate/);
  await manager.integrateResult(result('a')); assert.equal((await manager.finalSuite()).ok, true); await assert.rejects(() => manager.integrateResult(result('b', 2)), /superseded/);
});

test('child runner exposes restricted capabilities and worktree identity', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-workflow-child-')); const manager = new WorktreeManager(root);
  const runner = new ChildTaskRunner({ root, worktreeManager: manager, adapter: { run: async ({ capabilities }) => { assert.equal(capabilities.can_publish, false); assert.equal(capabilities.can_merge, false); return { status: 'SUCCEEDED', commit: 'abc', tests: { ok: true }, artifact_digest: 'digest' }; } } });
  const output = await runner.run({ ...unit('a'), run_id: 'run-a', generation: 1 }, { baseRevision: 'base', prompt: 'implement' }); assert.match(output.worktree, /^\.ai-workflow\/worktrees\//); assert.equal(output.local_review.disposition, 'approved');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkflowOrchestrator } from '../src/orchestrator.js';
import { createFakeGitHubAdapter } from '../src/adapters/github.js';
import { createFakeC2CAdapter } from '../src/adapters/chatgpt-c2c.js';

test('fixture completes the approved prototype-to-merge vertical slice', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-workflow-e2e-')); const github = createFakeGitHubAdapter(); const flow = new WorkflowOrchestrator(root, github);
  await flow.begin(); await flow.prototypeDesignApproved(); await flow.prototypeImplemented(); await flow.evaluatePrototype('PROMOTE_CANDIDATE');
  await flow.promotionApproved(); await flow.productionGrilled(); await flow.productionSpecApproved(); await flow.issueCreated(); await flow.planReviewed(); await flow.planApproved();
  await flow.implementationComplete(); await flow.prReviewed(); await flow.publishApproved(); await flow.publish(); await flow.mergeApproved(); await flow.merge();
  assert.equal((await flow.state()).stage, 'completed'); assert.deepEqual(github.calls.map((c) => c.operation), ['createPullRequest', 'mergePullRequest']);
  assert.ok(await fs.stat(path.join(root, '.ai-workflow', 'approvals', 'production_spec.json')));
});

test('prototype STOP cannot reach production', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-workflow-stop-')); const flow = new WorkflowOrchestrator(root, createFakeGitHubAdapter());
  await flow.begin(); await flow.prototypeDesignApproved(); await flow.prototypeImplemented(); await flow.evaluatePrototype('STOP');
  assert.equal((await flow.state()).stage, 'stopped');
});

test('publish and merge reject calls without bound human approvals', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-workflow-gate-')); const github = createFakeGitHubAdapter(); const flow = new WorkflowOrchestrator(root, github);
  await flow.begin();
  await assert.rejects(() => flow.publish(), /pr_publish approval is required/);
  assert.equal(github.calls.length, 0);
});

test('stale publish approval and missing merge approval never call GitHub', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-workflow-stale-')); const github = createFakeGitHubAdapter(); const flow = new WorkflowOrchestrator(root, github);
  await flow.begin(); await flow.prototypeDesignApproved(); await flow.prototypeImplemented(); await flow.evaluatePrototype('PROMOTE_CANDIDATE'); await flow.promotionApproved(); await flow.productionGrilled(); await flow.productionSpecApproved(); await flow.issueCreated(); await flow.planReviewed(); await flow.planApproved(); await flow.implementationComplete(); await flow.prReviewed(); await flow.publishApproved();
  const approvalPath = path.join(root, '.ai-workflow', 'approvals', 'pr_publish.json'); const approval = JSON.parse(await fs.readFile(approvalPath, 'utf8')); approval.target_revision = 'stale-head'; await fs.writeFile(approvalPath, JSON.stringify(approval));
  await assert.rejects(() => flow.publish(), /binding is stale/); assert.equal(github.calls.length, 0);
  await assert.rejects(() => flow.merge(), /pr_merge approval is required/); assert.equal(github.calls.length, 0);
});

test('prototype design uses C2C and a fresh orchestrator resumes from durable state', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-workflow-c2c-')); const c2c = createFakeC2CAdapter();
  const flow = new WorkflowOrchestrator(root, createFakeGitHubAdapter(), null, c2c);
  await flow.begin();
  assert.equal(c2c.calls.length, 1); assert.equal(c2c.calls[0].operation, 'prototype_design');
  assert.equal((await flow.state()).stage, 'prototype_design');
  const resumed = new WorkflowOrchestrator(root, createFakeGitHubAdapter(), null, c2c);
  assert.equal((await resumed.state()).stage, 'prototype_design');
});

test('wrong ChatGPT Project fails closed before C2C', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-workflow-project-')); const c2c = createFakeC2CAdapter();
  const wrongProject = async () => ({ name: 'wrong', purpose: 'wrong' });
  const flow = new WorkflowOrchestrator(root, createFakeGitHubAdapter(), null, c2c, wrongProject);
  await flow.store.setup({ project_id: 'project-test' });
  await flow.store.update((s) => ({ ...s, work_id: 'project-work' }));
  await assert.rejects(() => flow.chatgptStep('prototype_design', 'prototype_design'), /Project verification failed/);
  assert.equal(c2c.calls.length, 0);
});

test('default adapters fail closed outside fixtures', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-workflow-live-'));
  const flow = new WorkflowOrchestrator(root);
  await assert.rejects(() => flow.begin(), /live ChatGPT C2C adapter is required/);
});

test('next resumes an approved human gate from durable approval', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-workflow-next-'));
  const flow = new WorkflowOrchestrator(root, createFakeGitHubAdapter());
  await flow.begin();
  const stopped = await flow.next();
  assert.equal(stopped.requires_approval, true);
  await flow.approve('prototype_implementation');
  const resumed = await flow.next();
  assert.equal(resumed.mutation, true);
  assert.equal((await flow.state()).stage, 'prototype_implementation');
});

test('next dispatches approved publish and merge gates', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-workflow-next-pr-')); const github = createFakeGitHubAdapter(); const flow = new WorkflowOrchestrator(root, github);
  await flow.begin(); await flow.prototypeDesignApproved(); await flow.prototypeImplemented(); await flow.evaluatePrototype('PROMOTE_CANDIDATE'); await flow.promotionApproved(); await flow.productionGrilled(); await flow.productionSpecApproved(); await flow.issueCreated(); await flow.planReviewed(); await flow.planApproved(); await flow.implementationComplete(); await flow.prReviewed(); await flow.publishApproved();
  const published = await flow.next(); assert.equal(published.mutation, true); assert.equal((await flow.state()).stage, 'production_published'); assert.equal(github.calls.at(-1).operation, 'createPullRequest');
  await flow.mergeApproved(); const completed = await flow.next(); assert.equal(completed.mutation, true); assert.equal((await flow.state()).stage, 'completed'); assert.equal(github.calls.at(-1).operation, 'mergePullRequest');
});

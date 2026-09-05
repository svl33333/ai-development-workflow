import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkflowOrchestrator } from '../src/orchestrator.js';
import { createFakeGitHubAdapter } from '../src/adapters/github.js';
import { createFakeC2CAdapter } from '../src/adapters/chatgpt-c2c.js';
import { desiredProject } from '../src/adapters/chatgpt-project.js';

test('fixture completes the approved prototype-to-merge vertical slice', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-workflow-e2e-')); const github = createFakeGitHubAdapter(); const flow = new WorkflowOrchestrator(root, github);
  await flow.begin(); await flow.prototypeDesignApproved(); await flow.prototypeImplemented(); await flow.evaluatePrototype('PROMOTE_CANDIDATE');
  await flow.promotionApproved(); await flow.productionGrilled(); await flow.productionSpecApproved(); await flow.issueCreated();
  for (let round = 1; round <= 3; round += 1) { await flow.planReviewed(); await flow.planImproved(); }
  await flow.planApproved();
  await flow.implementationComplete(); await flow.prReviewed(); await flow.publishApproved(); await flow.publish(); await flow.mergeApproved(); await flow.merge();
  assert.equal((await flow.state()).stage, 'completed'); assert.deepEqual(github.calls.map((c) => c.operation), ['createPullRequest', 'mergePullRequest']);
  assert.ok(await fs.stat(path.join(root, '.ai-workflow', 'approvals', 'production_spec.json')));
});

test('production implementation plan requires three qualifying reviews in one dedicated conversation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-workflow-plan-review-'));
  const c2c = createFakeC2CAdapter();
  const flow = new WorkflowOrchestrator(root, createFakeGitHubAdapter(), null, c2c);

  await flow.begin(); await flow.prototypeDesignApproved(); await flow.prototypeImplemented(); await flow.evaluatePrototype('PROMOTE_CANDIDATE');
  await flow.promotionApproved(); await flow.productionGrilled(); await flow.productionSpecApproved(); await flow.issueCreated();

  await flow.planReviewed();
  assert.equal((await flow.state()).stage, 'production_plan_improvement');
  await assert.rejects(() => flow.planApproved(), /three qualifying review rounds/);

  await flow.planImproved(); await flow.planReviewed();
  assert.equal((await flow.state()).stage, 'production_plan_improvement');
  await flow.planImproved(); await flow.planReviewed();
  assert.equal((await flow.state()).stage, 'production_plan_improvement');
  await flow.planImproved();
  assert.equal((await flow.state()).stage, 'production_plan_waiting_approval');
  assert.equal((await flow.state()).plan_review_iteration, 3);
  assert.equal((await flow.state()).qualifying_plan_review_iteration, 3);
  assert.equal((await flow.state()).review_history.length, 3);
  assert.equal(new Set((await flow.state()).review_history.map((review) => review.conversation_id)).size, 1);

  await flow.planApproved();
  assert.equal((await flow.state()).stage, 'production_implementation');
  assert.equal(c2c.calls.filter((call) => call.operation === 'startConversation').length >= 2, true);
  assert.equal(c2c.calls.filter((call) => call.operation === 'resumeConversation').length >= 3, true);
});

test('new Issue path creates and binds a presented Issue artifact before planning', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-workflow-issue-path-'));
  const flow = new WorkflowOrchestrator(root, createFakeGitHubAdapter());
  await flow.begin(); await flow.prototypeDesignApproved(); await flow.prototypeImplemented(); await flow.evaluatePrototype('PROMOTE_CANDIDATE');
  await flow.promotionApproved(); await flow.productionGrilled(); await flow.productionSpecApproved();
  assert.equal((await flow.state()).stage, 'production_issue_creating');
  await flow.next();
  const state = await flow.state();
  assert.equal(state.stage, 'production_issue_waiting_review');
  const issue = state.artifacts.find((artifact) => artifact.kind === 'issue');
  const receipt = await flow.presentArtifact({ artifactPath: issue.path, artifactKind: 'issue', present: async () => ({ success: true, reference: 'test-view' }) });
  await flow.approve('production_issue_review', { presentation_id: receipt.presentation_id });
  await flow.next();
  assert.equal((await flow.state()).stage, 'production_issue_ready');
});

test('next completes three plan review and improvement rounds before it requests plan approval', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-workflow-next-plan-review-'));
  const flow = new WorkflowOrchestrator(root, createFakeGitHubAdapter());

  await flow.begin(); await flow.prototypeDesignApproved(); await flow.prototypeImplemented(); await flow.evaluatePrototype('PROMOTE_CANDIDATE');
  await flow.promotionApproved(); await flow.productionGrilled(); await flow.productionSpecApproved(); await flow.issueCreated();

  for (let step = 0; step < 6; step += 1) await flow.next();

  const state = await flow.state();
  assert.equal(state.stage, 'production_plan_waiting_approval');
  assert.equal(state.plan_review_iteration, 3);
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
  await flow.begin(); await flow.prototypeDesignApproved(); await flow.prototypeImplemented(); await flow.evaluatePrototype('PROMOTE_CANDIDATE'); await flow.promotionApproved(); await flow.productionGrilled(); await flow.productionSpecApproved(); await flow.issueCreated();
  for (let round = 1; round <= 3; round += 1) { await flow.planReviewed(); await flow.planImproved(); }
  await flow.planApproved(); await flow.implementationComplete(); await flow.prReviewed(); await flow.publishApproved();
  const approvalPath = path.join(root, '.ai-workflow', 'approvals', 'pr_publish.json'); const approval = JSON.parse(await fs.readFile(approvalPath, 'utf8')); approval.target_revision = 'stale-head'; await fs.writeFile(approvalPath, JSON.stringify(approval));
  await assert.rejects(() => flow.publish(), /binding is stale/); assert.equal(github.calls.length, 0);
  await assert.rejects(() => flow.merge(), /pr_merge approval is required/); assert.equal(github.calls.length, 0);
});

test('prototype design uses C2C and a fresh orchestrator resumes from durable state', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-workflow-c2c-')); const c2c = createFakeC2CAdapter();
  const flow = new WorkflowOrchestrator(root, createFakeGitHubAdapter(), null, c2c);
  await flow.begin();
  assert.equal(c2c.calls[0].operation, 'startConversation');
  assert.equal(c2c.calls.some((call) => call.operation === 'sendMessage'), true);
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
  await assert.rejects(() => flow.chatgptStep('prototype_design', 'prototype_design'), /Project resolution or binding verification failed/);
  assert.equal(c2c.calls.length, 0);
});

test('C2C operations route prototype and production work to their distinct Projects', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-workflow-project-routing-'));
  const c2c = createFakeC2CAdapter();
  const requestedKinds = [];
  const projectProvider = async (kind) => { requestedKinds.push(kind); return desiredProject(kind); };
  const flow = new WorkflowOrchestrator(root, createFakeGitHubAdapter(), null, c2c, projectProvider);
  await flow.store.setup({ project_id: 'routing-test' });
  await flow.store.update((state) => ({ ...state, work_id: 'routing-work' }));
  await flow.chatgptStep('prototype_design', 'prototype_design');
  await flow.store.update((state) => ({ ...state, stage: 'production_issue_ready', next_action: 'chatgpt_production_plan', agent_state: { ...state.agent_state, stage: 'production_issue_ready', next_action: 'chatgpt_production_plan' } }));
  await flow.chatgptStep('production_plan', 'production_planning');
  assert.deepEqual(requestedKinds, ['prototype', 'production']);
});

test('an ambiguously resolved Project cannot start a ChatGPT conversation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-workflow-project-ambiguous-')); const c2c = createFakeC2CAdapter();
  const flow = new WorkflowOrchestrator(root, createFakeGitHubAdapter(), null, c2c, null, async () => ({ status: 'ambiguous', candidates: [{ name: 'same' }, { name: 'same' }] }));
  await flow.store.setup({ project_id: 'project-ambiguous' }); await flow.store.update((state) => ({ ...state, work_id: 'project-work' }));
  await assert.rejects(() => flow.chatgptStep('prototype_design', 'prototype_design'), /Project resolution or binding verification failed/);
  assert.equal(c2c.calls.length, 0);
});

test('a Project bound to the wrong repository cannot start a ChatGPT conversation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-workflow-project-repository-')); const c2c = createFakeC2CAdapter();
  const resolver = async (kind, state) => ({ status: 'resolved', project: { name: `${kind}-project`, workspace: state.project_id, repository: 'owner/wrong' } });
  const flow = new WorkflowOrchestrator(root, createFakeGitHubAdapter(), null, c2c, null, resolver, 'owner/expected');
  await flow.store.setup({ project_id: 'project-repository' }); await flow.store.update((state) => ({ ...state, work_id: 'project-work' }));
  await assert.rejects(() => flow.chatgptStep('prototype_design', 'prototype_design'), /Project resolution or binding verification failed/);
  assert.equal(c2c.calls.length, 0);
});

test('C2C operations route prototype and production work to their distinct Projects', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-workflow-project-routing-'));
  const c2c = createFakeC2CAdapter();
  const requestedKinds = [];
  const projectProvider = async (kind) => { requestedKinds.push(kind); return desiredProject(kind); };
  const flow = new WorkflowOrchestrator(root, createFakeGitHubAdapter(), null, c2c, projectProvider);
  await flow.store.setup({ project_id: 'routing-test' });
  await flow.store.update((state) => ({ ...state, work_id: 'routing-work' }));
  await flow.chatgptStep('prototype_design', 'prototype_design');
  await flow.store.update((state) => ({ ...state, stage: 'production_issue_ready', next_action: 'chatgpt_production_plan', agent_state: { ...state.agent_state, stage: 'production_issue_ready', next_action: 'chatgpt_production_plan' } }));
  await flow.chatgptStep('production_plan', 'production_planning');
  assert.deepEqual(requestedKinds, ['prototype', 'production']);
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
  await flow.begin(); await flow.prototypeDesignApproved(); await flow.prototypeImplemented(); await flow.evaluatePrototype('PROMOTE_CANDIDATE'); await flow.promotionApproved(); await flow.productionGrilled(); await flow.productionSpecApproved(); await flow.issueCreated();
  for (let round = 1; round <= 3; round += 1) { await flow.planReviewed(); await flow.planImproved(); }
  await flow.planApproved(); await flow.implementationComplete(); await flow.prReviewed(); await flow.publishApproved();
  const published = await flow.next(); assert.equal(published.mutation, true); assert.equal((await flow.state()).stage, 'production_published'); assert.equal(github.calls.at(-1).operation, 'createPullRequest');
  await flow.mergeApproved(); const completed = await flow.next(); assert.equal(completed.mutation, true); assert.equal((await flow.state()).stage, 'completed'); assert.equal(github.calls.at(-1).operation, 'mergePullRequest');
});
test('legacy review counters and mixed review conversations cannot approve a production plan', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-workflow-legacy-review-'));
  const flow = new WorkflowOrchestrator(root, createFakeGitHubAdapter());
  await flow.store.setup({ project_id: 'legacy-review' });
  await flow.store.update((state) => ({ ...state, work_id: 'legacy-work', stage: 'production_plan_waiting_approval', status: 'waiting_for_human', next_action: 'codex_implement', plan_review_iteration: 3, qualifying_plan_review_iteration: 0, review_history: [] , agent_state: { ...state.agent_state, stage: 'production_plan_waiting_approval', status: 'waiting_for_human', next_action: 'codex_implement' } }));
  await assert.rejects(() => flow.planApproved(), /qualifying review rounds/);
  await flow.approve('production_plan');
  const bypass = await flow.next();
  assert.equal(bypass.blocked, true);
  assert.equal((await flow.state()).stage, 'production_plan_waiting_approval');
});

test('replacing a non-resumable plan review conversation requires a bound human approval', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-workflow-review-replacement-'));
  const flow = new WorkflowOrchestrator(root, createFakeGitHubAdapter());
  await flow.store.setup({ project_id: 'replacement-review' });
  await flow.store.update((state) => ({ ...state, work_id: 'replacement-work', stage: 'production_plan_review', review_context: { ...state.review_context, active_plan_review_conversation_id: 'reviewer-a', active_plan_review_project_id: 'project-a', active_plan_review_history_revision: 4, active_plan_review_non_resumable_reason: 'conversation deleted' }, agent_state: { ...state.agent_state, stage: 'production_plan_review' } }));
  await assert.rejects(() => flow.replacePlanReviewConversation(), /review_conversation_replacement approval is required/);
  await flow.approve('review_conversation_replacement', { review_stage: 'production_plan_review', review_role: 'plan_review', old_conversation_id: 'reviewer-a', replacement_reason: 'conversation deleted', review_history_revision: 4 });
  await flow.replacePlanReviewConversation();
  const state = await flow.state();
  assert.notEqual(state.review_context.active_plan_review_conversation_id, 'reviewer-a');
  assert.equal(state.qualifying_plan_review_iteration, 0);
});

test('unresolved blocking plan-review findings cannot reach the human approval stage', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-workflow-blocking-review-'));
  const c2c = createFakeC2CAdapter({ responseForMessage(input) {
    const operation = JSON.parse(input.message).operation;
    if (operation === 'independent_plan_review') return { state: 'DONE', status: 'DONE', findings: [{ id: 'CR-1', severity: 'CRITICAL' }] };
    if (operation === 'production_plan_refinement') return { state: 'DONE', status: 'DONE', findings: [], dispositions: [{ finding_id: 'CR-1', disposition: 'adopted', rationale: 'not yet fixed', plan_change: 'none', resolved: false }] };
    return { state: 'DONE', status: 'DONE', findings: [] };
  } });
  const flow = new WorkflowOrchestrator(root, createFakeGitHubAdapter(), null, c2c);
  await flow.begin(); await flow.prototypeDesignApproved(); await flow.prototypeImplemented(); await flow.evaluatePrototype('PROMOTE_CANDIDATE'); await flow.promotionApproved(); await flow.productionGrilled(); await flow.productionSpecApproved(); await flow.issueCreated();
  await flow.planReviewed(); await flow.planImproved();
  assert.equal((await flow.state()).stage, 'production_plan_review');
  assert.equal((await flow.state()).review_history[0].unresolved_blocking_findings, 1);
});

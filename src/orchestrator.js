import fs from 'node:fs/promises';
import path from 'node:path';
import { StateStore } from './state-store.js';
import { deriveQualifyingPlanReviewIteration } from './model.js';
import { createApproval } from './approvals.js';
import { createFakeGitHubAdapter } from './adapters/github.js';
import { writeArtifact } from './artifacts.js';
import { createRequest, sanitizeRequest, parseResponse, createFakeC2CAdapter } from './adapters/chatgpt-c2c.js';
import { desiredProject, verifyProject, verifyProjectBinding } from './adapters/chatgpt-project.js';
import { nextStage } from './workflow.js';
import { ConversationRunner } from './conversation-runner.js';

const actions = {
  prototype_intake: 'chatgpt_prototype_design', prototype_design: 'human_approve_prototype_implementation',
  prototype_implementation: 'chatgpt_prototype_evaluation', prototype_evaluation: 'human_decide_prototype_evaluation',
  promotion_waiting_approval: 'human_approve_promotion', production_grilling: 'human_approve_production_spec',
  production_spec_waiting_approval: 'create_production_issue', production_issue_ready: 'chatgpt_production_plan',
  production_planning: 'chatgpt_independent_plan_review', production_plan_review: 'chatgpt_independent_plan_review',
  production_plan_improvement: 'chatgpt_refine_production_plan',
  production_plan_waiting_approval: 'codex_implement', production_implementation: 'create_local_pr_draft',
  production_pr_draft: 'chatgpt_pr_review', production_pr_review: 'human_approve_publish',
  production_publish_waiting_approval: 'publish_github_pr', production_published: 'human_approve_merge',
  production_merge_waiting_approval: 'merge_github_pr', completed: null
};

export class WorkflowOrchestrator {
  constructor(productPath, github = null, evidenceProvider = null, c2c = null, projectProvider = null, projectResolver = null, expectedRepository = null) { this.productPath = productPath; this.store = new StateStore(productPath); this.syntheticEvidence = path.resolve(productPath).includes(`${path.sep}fixtures${path.sep}`) || github?.synthetic === true; this.github = github ?? (this.syntheticEvidence ? createFakeGitHubAdapter() : null); this.c2c = c2c ?? (this.syntheticEvidence ? createFakeC2CAdapter() : null); this.expectedRepository = expectedRepository ?? 'fixture/repository'; this.projectProvider = projectProvider ?? (async (kind) => { if (!this.syntheticEvidence) throw Object.assign(new Error('live ChatGPT Project provider is required'), { code: 4 }); return desiredProject(kind); }); this.projectResolver = projectResolver ?? (async (kind, state) => { const project = await this.projectProvider(kind); if (!verifyProject(project, kind)) return { status: 'binding_mismatch', project }; return { status: 'resolved', project: { ...project, workspace: state.project_id, repository: this.expectedRepository } }; }); this.evidenceProvider = evidenceProvider ?? (async (state) => { if (!this.syntheticEvidence) throw new Error('live evidence provider is required outside fixtures'); return { pr_number: state.pr_number ?? 1, target_revision: state.current_revision ?? state.base_revision ?? 'workspace-head', test_run_id: state.test_run_id ?? 'phase1-local-001', test_artifact: state.test_artifact ?? 'work/runs/phase1-test-run.md', review_artifact: state.review_artifact ?? 'work/local-pr-draft.md', review_iteration: state.review_iteration ?? 0, unresolved_blocking_findings: state.unresolved_blocking_findings ?? 0 }; }); }
  async state() { return (await this.store.read()).state; }
  async setStage(stage, status = 'ready', nextAction = actions[stage]) {
    const action = nextAction ?? 'none'; const current = await this.state();
    const artifact = await writeArtifact(this.productPath, { projectId: current.project_id, stage, workId: current.work_id, artifactType: 'stage-log', version: current.revision + 1 }, `# Stage transition\n\n- from: ${current.stage}\n- to: ${stage}\n- status: ${status}\n- next_action: ${action}`);
    return this.store.update((state) => ({ ...state, stage, status, next_action: action, artifacts: [...(state.artifacts ?? []), { kind: 'stage-log', path: artifact, version: state.revision + 1 }], agent_state: { ...state.agent_state, stage, status, next_action: action, waiting_reason: status.includes('waiting') ? action : null, error: null } }));
  }
  async chatgptStep(operation, stage, { conversationId = null } = {}) {
    if (!this.c2c) throw Object.assign(new Error('live ChatGPT C2C adapter is required'), { code: 4 });
    const state = await this.state(); const kind = operation.includes('prototype') ? 'prototype' : 'production';
    const resolved = await this.projectResolver(kind, state); if (resolved.status !== 'resolved' || !verifyProjectBinding(resolved.project, { workspace: state.project_id, repository: this.expectedRepository })) throw Object.assign(new Error('ChatGPT Project resolution or binding verification failed'), { code: 4 });
    const actual = resolved.project;
    const request = sanitizeRequest(createRequest({ taskId: `workflow-${operation}`, iteration: state.revision, operation, workspace: state.project_id, workId: state.work_id, stage, inputs: state.artifacts.map((a) => a.path), readScope: ['state', 'artifacts'], expected: 'structured response' }));
    const runner = new ConversationRunner({ adapter: this.c2c, stateStore: this.store });
    const role = operation === 'independent_plan_review' ? 'plan_review' : operation === 'pr_review' ? 'pr_review' : 'planning';
    const response = parseResponse(await runner.run({ taskId: request.task_id, iteration: request.iteration, messageId: `${operation}-${state.revision}`, project: actual, workspace: state.project_id, role, stage, message: JSON.stringify(request), conversationId }));
    const persisted = await this.state(); const actualConversationId = persisted.conversation.conversation_id;
    const artifact = await writeArtifact(this.productPath, { projectId: state.project_id, stage, workId: state.work_id, artifactType: operation, version: state.revision + 1 }, response.artifact ?? JSON.stringify(response, null, 2));
    await this.store.update((current) => ({ ...current, artifacts: [...(current.artifacts ?? []), { kind: operation, path: artifact, version: current.revision + 1 }] }));
    return { ...response, conversation_id: actualConversationId, project_id: actual.id ?? actual.name };
  }
  async next() {
    const current = await this.state(); const target = nextStage(current.stage); if (!target) return { stage: current.stage, next_stage: null, mutation: false, stopped: true };
    const gateKinds = { prototype_design: 'prototype_implementation', promotion_waiting_approval: 'promotion', production_spec_waiting_approval: 'production_spec', production_plan_waiting_approval: 'production_plan', production_pr_review: 'pr_publish', production_publish_waiting_approval: 'pr_publish', production_published: 'pr_merge', production_merge_waiting_approval: 'pr_merge' };
    const gateKind = gateKinds[current.stage];
    if (gateKind) {
      const before = current.stage;
      if (current.stage === 'production_plan_waiting_approval' && (current.qualifying_plan_review_iteration < 3 || current.review_history.some((entry) => entry.unresolved_blocking_findings > 0))) {
        return { stage: current.stage, next_stage: target, mutation: false, requires_approval: false, blocked: true };
      }
      try { const approval = await this.loadApproval(gateKind); if (approval.valid !== true || approval.work_id !== current.work_id) throw new Error('invalid approval'); }
      catch { return { stage: current.stage, next_stage: target, mutation: false, requires_approval: true }; }
      if (current.stage === 'prototype_design') await this.setStage('prototype_implementation', 'running');
      else if (current.stage === 'promotion_waiting_approval') await this.setStage('production_grilling', 'running');
      else if (current.stage === 'production_spec_waiting_approval') await this.setStage('production_issue_ready', 'running');
      else if (current.stage === 'production_plan_waiting_approval') await this.setStage('production_implementation', 'running');
      else if (current.stage === 'production_pr_review') await this.setStage('production_publish_waiting_approval', 'ready');
      else if (current.stage === 'production_publish_waiting_approval') await this.publish();
      else if (current.stage === 'production_published') await this.setStage('production_merge_waiting_approval', 'ready');
      else if (current.stage === 'production_merge_waiting_approval') await this.merge();
      return { stage: before, next_stage: (await this.state()).stage, mutation: true, requires_approval: false };
    }
    if (current.status === 'waiting_for_human' || actions[current.stage]?.startsWith('human_') || current.stage.includes('waiting_approval')) return { stage: current.stage, next_stage: target, mutation: false, requires_approval: true };
    const before = current.stage;
    if (current.stage === 'prototype_intake') { await this.chatgptStep('prototype_design', 'prototype_design'); await this.setStage('prototype_design', 'waiting_for_chatgpt'); }
    else if (current.stage === 'prototype_implementation') await this.prototypeImplemented();
    else if (current.stage === 'production_issue_ready') await this.issueCreated();
    else if (['production_planning', 'production_plan_review'].includes(current.stage)) await this.planReviewed();
    else if (current.stage === 'production_plan_improvement') await this.planImproved();
    else if (current.stage === 'production_implementation') await this.implementationComplete();
    else if (current.stage === 'production_pr_draft') await this.prReviewed();
    else await this.setStage(target, 'ready');
    return { stage: before, next_stage: (await this.state()).stage, mutation: true, requires_approval: false };
  }
  async approve(kind, extra = {}) {
    const state = await this.state(); const approval = createApproval({ kind, approved_by: 'human', work_id: state.work_id === 'unassigned' ? 'fixture-work' : state.work_id, artifact_version: 1, ...extra });
    await fs.mkdir(path.join(this.productPath, '.ai-workflow', 'approvals'), { recursive: true });
    await fs.writeFile(path.join(this.productPath, '.ai-workflow', 'approvals', `${kind}.json`), JSON.stringify(approval, null, 2));
    return approval;
  }
  async begin() { await this.store.setup({ project_id: 'sample-product' }); await this.store.update((s) => ({ ...s, work_id: 'fixture-work' })); await this.chatgptStep('prototype_design', 'prototype_design'); return this.setStage('prototype_design', 'waiting_for_chatgpt'); }
  async prototypeDesignApproved() { await this.approve('prototype_implementation'); return this.setStage('prototype_implementation', 'running'); }
  async prototypeImplemented() { await this.chatgptStep('prototype_evaluation', 'prototype_evaluation'); return this.setStage('prototype_evaluation', 'waiting_for_chatgpt'); }
  async evaluatePrototype(decision) {
    if (!['ITERATE', 'PROMOTE_CANDIDATE', 'STOP'].includes(decision)) throw new Error(`invalid prototype decision: ${decision}`);
    if (decision === 'ITERATE') return this.setStage('prototype_implementation', 'waiting_for_human');
    if (decision === 'STOP') return this.setStage('stopped', 'stopped', null);
    return this.setStage('promotion_waiting_approval', 'waiting_for_human');
  }
  async promotionApproved() { await this.approve('promotion'); return this.setStage('production_grilling', 'running'); }
  async productionGrilled() { return this.setStage('production_spec_waiting_approval', 'waiting_for_human'); }
  async productionSpecApproved() { await this.approve('production_spec'); return this.setStage('production_issue_ready', 'running'); }
  async issueCreated() {
    const plan = await this.chatgptStep('production_plan', 'production_planning');
    await this.store.update((state) => ({ ...state, review_context: { ...state.review_context, planning_conversation_id: plan.conversation_id } }));
    return this.setStage('production_planning', 'waiting_for_chatgpt');
  }
  async planReviewed() {
    const before = await this.state();
    if (!before.review_context.planning_conversation_id) throw new Error('planning conversation is required before plan review');
    const review = await this.chatgptStep('independent_plan_review', 'production_plan_review', { conversationId: before.review_context.active_plan_review_conversation_id });
    if (review.conversation_id === before.review_context.planning_conversation_id) throw new Error('plan review must use a conversation separate from planning');
    const findings = review.findings ?? [];
    const updated = await this.store.update((current) => {
      const activeConversationId = current.review_context.active_plan_review_conversation_id ?? review.conversation_id;
      if (activeConversationId !== review.conversation_id) throw new Error('plan review conversation changed without replacement approval');
      const round = current.review_history.filter((entry) => entry.stage === 'production_plan_review' && entry.role === 'plan_review' && entry.conversation_id === activeConversationId).length + 1;
      const reviewHistory = [...current.review_history, {
        stage: 'production_plan_review', role: 'plan_review', round, conversation_id: review.conversation_id,
        project_id: review.project_id, findings: findings.map((finding, index) => ({ finding_id: finding.id ?? `R${round}-${index + 1}`, severity: finding.severity ?? 'SUGGESTION', disposition: null, rationale: null, plan_change: null, resolved: false })),
        unresolved_blocking_findings: findings.filter((finding) => ['CRITICAL', 'HIGH', 'IMPORTANT'].includes(finding.severity)).length,
        dispositions_complete: false, improved: false
      }];
      return { ...current, plan_review_iteration: current.plan_review_iteration + 1, review_history: reviewHistory,
        review_context: { ...current.review_context, active_plan_review_conversation_id: activeConversationId, active_plan_review_project_id: review.project_id, active_plan_review_history_revision: current.revision + 1, active_plan_review_non_resumable_reason: null },
        qualifying_plan_review_iteration: deriveQualifyingPlanReviewIteration(reviewHistory, activeConversationId) };
    });
    return this.setStage('production_plan_improvement', 'running');
  }
  async planImproved() {
    const before = await this.state();
    if (!before.review_context.planning_conversation_id) throw new Error('planning conversation is required for plan improvement');
    const refinement = await this.chatgptStep('production_plan_refinement', 'production_plan_improvement', { conversationId: before.review_context.planning_conversation_id });
    const updated = await this.store.update((current) => {
      const dispositions = new Map((refinement.dispositions ?? []).map((disposition) => [disposition.finding_id, disposition]));
      const reviewHistory = current.review_history.map((entry, index, all) => index === all.length - 1
        ? (() => {
          const findings = entry.findings.map((finding) => ({ ...finding, ...(dispositions.get(finding.finding_id) ?? {}) }));
          const dispositionsComplete = findings.every((finding) => ['adopted', 'rejected', 'human_decision'].includes(finding.disposition) && finding.rationale && (finding.plan_change || finding.disposition !== 'adopted'));
          const unresolvedBlockingFindings = findings.filter((finding) => ['CRITICAL', 'HIGH', 'IMPORTANT'].includes(finding.severity) && !finding.resolved).length;
          return { ...entry, improved: dispositionsComplete, dispositions_complete: dispositionsComplete, findings, unresolved_blocking_findings: unresolvedBlockingFindings };
        })()
        : entry);
      return { ...current, review_history: reviewHistory,
        qualifying_plan_review_iteration: deriveQualifyingPlanReviewIteration(reviewHistory, current.review_context.active_plan_review_conversation_id) };
    });
    if (updated.qualifying_plan_review_iteration >= 3 && !updated.review_history.some((entry) => entry.unresolved_blocking_findings > 0)) return this.setStage('production_plan_waiting_approval', 'waiting_for_human');
    return this.setStage('production_plan_review', 'ready');
  }
  async planApproved() {
    const state = await this.state();
    if (state.qualifying_plan_review_iteration < 3) throw new Error('production plan requires three qualifying review rounds before approval');
    if (state.stage !== 'production_plan_waiting_approval') throw new Error('production plan is not ready for approval');
    await this.approve('production_plan'); return this.setStage('production_implementation', 'running');
  }
  async replacePlanReviewConversation() {
    const state = await this.state(); const context = state.review_context;
    if (!context.active_plan_review_non_resumable_reason) throw new Error('active plan review conversation is still resumable');
    let approval;
    try { approval = await this.loadApproval('review_conversation_replacement'); } catch { throw Object.assign(new Error('review_conversation_replacement approval is required'), { code: 4 }); }
    const expected = { work_id: state.work_id, review_stage: 'production_plan_review', review_role: 'plan_review', old_conversation_id: context.active_plan_review_conversation_id, replacement_reason: context.active_plan_review_non_resumable_reason, review_history_revision: context.active_plan_review_history_revision };
    if (!approval.valid || Object.entries(expected).some(([key, value]) => approval[key] !== value)) throw Object.assign(new Error('review_conversation_replacement approval is stale or incomplete'), { code: 4 });
    const resolved = await this.projectResolver('production', state); if (resolved.status !== 'resolved' || !verifyProjectBinding(resolved.project, { workspace: state.project_id, repository: this.expectedRepository })) throw Object.assign(new Error('ChatGPT Project resolution or binding verification failed'), { code: 4 }); const project = resolved.project;
    const replacement = await this.c2c.startConversation({ project });
    await fs.unlink(path.join(this.productPath, '.ai-workflow', 'approvals', 'review_conversation_replacement.json'));
    return this.store.update((current) => ({ ...current, qualifying_plan_review_iteration: 0, review_context: { ...current.review_context, active_plan_review_conversation_id: replacement.conversationId, active_plan_review_project_id: project.id ?? project.name, active_plan_review_history_revision: current.revision + 1, active_plan_review_non_resumable_reason: null, replacement_history: [...current.review_context.replacement_history, { old_conversation_id: context.active_plan_review_conversation_id, new_conversation_id: replacement.conversationId, reason: context.active_plan_review_non_resumable_reason }] } }));
  }
  async implementationComplete() { return this.setStage('production_pr_draft', 'running'); }
  async prReviewed() { await this.chatgptStep('pr_review', 'production_pr_review'); return this.setStage('production_pr_review', 'waiting_for_human'); }
  async publishApproved() { const evidence = await this.evidenceProvider(await this.state()); await this.approve('pr_publish', evidence); return this.setStage('production_publish_waiting_approval', 'ready'); }
  async loadApproval(kind) { return JSON.parse(await fs.readFile(path.join(this.productPath, '.ai-workflow', 'approvals', `${kind}.json`), 'utf8')); }
  async requireApproval(kind, expected = {}) {
    let approval; try { approval = await this.loadApproval(kind); } catch { throw Object.assign(new Error(`${kind} approval is required`), { code: 4 }); }
    const required = ['valid', 'work_id', 'pr_number', 'target_revision', 'test_run_id', 'test_artifact', 'review_artifact', 'review_iteration', 'unresolved_blocking_findings'];
    if (!approval.valid || required.some((key) => approval[key] === undefined || approval[key] === null) || approval.unresolved_blocking_findings !== 0 || Object.entries(expected).some(([key, value]) => approval[key] !== value)) throw Object.assign(new Error(`${kind} approval binding is stale or incomplete`), { code: 4 });
    return approval;
  }
  async publish() { if (!this.github) throw Object.assign(new Error('live GitHub adapter is required'), { code: 4 }); const state = await this.state(); const evidence = await this.evidenceProvider(state); await this.requireApproval('pr_publish', { work_id: state.work_id, ...evidence }); await this.github.createPullRequest({ head: evidence.target_revision, issue_url: 'https://example.invalid/issues/1' }); return this.setStage('production_published', 'waiting_for_human'); }
  async mergeApproved() { const evidence = await this.evidenceProvider(await this.state()); await this.approve('pr_merge', evidence); return this.setStage('production_merge_waiting_approval', 'ready'); }
  async merge() { if (!this.github) throw Object.assign(new Error('live GitHub adapter is required'), { code: 4 }); const state = await this.state(); const evidence = await this.evidenceProvider(state); await this.requireApproval('pr_merge', { work_id: state.work_id, ...evidence }); await this.github.mergePullRequest({ number: evidence.pr_number, head: evidence.target_revision }); return this.setStage('completed', 'completed', null); }
}

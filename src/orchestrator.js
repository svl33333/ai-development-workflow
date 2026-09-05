import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { StateStore } from './state-store.js';
import { deriveQualifyingPlanReviewIteration } from './model.js';
import { createApproval } from './approvals.js';
import { createFakeGitHubAdapter } from './adapters/github.js';
import { writeArtifact } from './artifacts.js';
import { createPresentationReceipt, verifyPresentationReceipt } from './artifact-presenter.js';
import { createRequest, sanitizeRequest, parseResponse, createFakeC2CAdapter } from './adapters/chatgpt-c2c.js';
import { desiredProject, verifyProject, verifyProjectBinding } from './adapters/chatgpt-project.js';
import { nextStage } from './workflow.js';
import { ConversationRunner } from './conversation-runner.js';
import { ensureOrchestrator } from './orchestrator-lifecycle.js';

const actions = {
  prototype_intake: 'chatgpt_prototype_design', prototype_design: 'human_approve_prototype_implementation',
  prototype_implementation: 'chatgpt_prototype_evaluation', prototype_evaluation: 'human_decide_prototype_evaluation',
  promotion_waiting_approval: 'human_approve_promotion', production_grilling: 'human_approve_production_spec',
  production_spec_waiting_approval: 'create_production_issue', production_issue_creating: 'create_production_issue', production_issue_waiting_review: 'human_review_issue', production_issue_ready: 'chatgpt_production_plan',
  production_planning: 'chatgpt_independent_plan_review', production_plan_review: 'chatgpt_independent_plan_review',
  production_plan_improvement: 'chatgpt_refine_production_plan',
  production_plan_waiting_approval: 'codex_implement', production_implementation: 'create_local_pr_draft',
  production_pr_draft: 'chatgpt_pr_review', production_pr_review: 'human_approve_publish',
  production_publish_waiting_approval: 'publish_github_pr', production_published: 'human_approve_merge',
  production_merge_waiting_approval: 'merge_github_pr', completed: null
};

export class WorkflowOrchestrator {
  constructor(productPath, github = null, evidenceProvider = null, c2c = null, projectProvider = null, projectResolver = null, expectedRepository = null, executionEngine = null, issueGateway = null) { this.productPath = productPath; this.store = new StateStore(productPath); this.generation = null; this.syntheticEvidence = path.resolve(productPath).includes(`${path.sep}fixtures${path.sep}`) || github?.synthetic === true; this.github = github ?? (this.syntheticEvidence ? createFakeGitHubAdapter() : null); this.executionEngine = executionEngine; this.issueGateway = issueGateway; this.c2c = c2c ?? (this.syntheticEvidence ? createFakeC2CAdapter() : null); this.expectedRepository = expectedRepository ?? 'fixture/repository'; this.projectProvider = projectProvider ?? (async (kind) => { if (!this.syntheticEvidence) throw Object.assign(new Error('live ChatGPT Project provider is required'), { code: 4 }); return desiredProject(kind); }); this.projectResolver = projectResolver ?? (async (kind, state) => { const project = await this.projectProvider(kind); if (!verifyProject(project, kind)) return { status: 'binding_mismatch', project }; return { status: 'resolved', project: { ...project, workspace: state.project_id, repository: this.expectedRepository } }; }); this.evidenceProvider = evidenceProvider ?? (async (state) => { if (!this.syntheticEvidence) throw new Error('live evidence provider is required outside fixtures'); return { pr_number: state.pr_number ?? 1, target_revision: state.current_revision ?? state.base_revision ?? 'workspace-head', test_run_id: state.test_run_id ?? 'phase1-local-001', test_artifact: state.test_artifact ?? 'work/runs/phase1-test-run.md', review_artifact: state.review_artifact ?? 'work/local-pr-draft.md', review_iteration: state.review_iteration ?? 0, unresolved_blocking_findings: state.unresolved_blocking_findings ?? 0 }; }); }
  async state() { return (await this.store.read()).state; }
  async assertActiveGeneration(state = null) { const current = state ?? await this.state(); if (this.generation !== null && current.orchestrator_generation !== this.generation) throw Object.assign(new Error('orchestrator generation is superseded'), { code: 3 }); this.generation ??= current.orchestrator_generation; return current; }
  async setStage(stage, status = 'ready', nextAction = actions[stage]) {
    const action = nextAction ?? 'none'; const current = await this.assertActiveGeneration();
    const artifact = await writeArtifact(this.productPath, { projectId: current.project_id, stage, workId: current.work_id, artifactType: 'stage-log', version: current.revision + 1 }, `# Stage transition\n\n- from: ${current.stage}\n- to: ${stage}\n- status: ${status}\n- next_action: ${action}`);
    return this.store.update((state) => ({ ...state, stage, status, next_action: action, artifacts: [...(state.artifacts ?? []), { kind: 'stage-log', path: artifact, version: state.revision + 1 }], agent_state: { ...state.agent_state, stage, status, next_action: action, waiting_reason: status.includes('waiting') ? action : null, error: null } }));
  }
  async chatgptStep(operation, stage, { conversationId = null } = {}) {
    if (!this.c2c) throw Object.assign(new Error('live ChatGPT C2C adapter is required'), { code: 4 });
    const state = await this.assertActiveGeneration(); const kind = operation.includes('prototype') ? 'prototype' : 'production';
    const resolved = await this.projectResolver(kind, state); if (resolved.status !== 'resolved' || !verifyProjectBinding(resolved.project, { workspace: state.project_id, repository: this.expectedRepository })) throw Object.assign(new Error('ChatGPT Project resolution or binding verification failed'), { code: 4 });
    const actual = resolved.project;
    const request = sanitizeRequest(createRequest({ taskId: `workflow-${operation}`, iteration: state.revision, operation, workspace: state.project_id, workId: state.work_id, stage, inputs: state.artifacts.map((a) => a.path), readScope: ['state', 'artifacts'], expected: 'structured response' }));
    const runner = new ConversationRunner({ adapter: this.c2c, stateStore: this.store });
    const role = operation === 'independent_plan_review' ? 'plan_review' : operation === 'pr_review' ? 'pr_review' : 'planning';
    const response = parseResponse(await runner.run({ taskId: request.task_id, iteration: request.iteration, messageId: `${operation}-${state.revision}`, project: actual, workspace: state.project_id, role, stage, message: JSON.stringify(request), conversationId }));
    const persisted = await this.state(); const actualConversationId = persisted.conversation.conversation_id;
    const artifact = await writeArtifact(this.productPath, { projectId: state.project_id, stage, workId: state.work_id, artifactType: operation, version: state.revision + 1 }, response.artifact ?? JSON.stringify(response, null, 2));
    await this.store.update((current) => ({ ...current, artifacts: [...(current.artifacts ?? []), { kind: operation, path: artifact, version: current.revision + 1 }], ...(response.execution_plan ? { execution_plan: response.execution_plan } : {}) }));
    return { ...response, conversation_id: actualConversationId, project_id: actual.id ?? actual.name };
  }
  async next() {
    const current = await this.state(); const target = nextStage(current.stage); if (!target) return { stage: current.stage, next_stage: null, mutation: false, stopped: true };
    const gateKinds = { prototype_design: 'prototype_implementation', promotion_waiting_approval: 'promotion', production_spec_waiting_approval: 'production_spec', production_issue_waiting_review: 'production_issue_review', production_plan_waiting_approval: 'production_plan', production_pr_review: 'pr_publish', production_publish_waiting_approval: 'pr_publish', production_published: 'pr_merge', production_merge_waiting_approval: 'pr_merge' };
    const gateKind = gateKinds[current.stage];
    if (gateKind) {
      const before = current.stage;
      if (current.stage === 'production_plan_waiting_approval' && (current.qualifying_plan_review_iteration < 3 || current.review_history.some((entry) => entry.unresolved_blocking_findings > 0))) {
        return { stage: current.stage, next_stage: target, mutation: false, requires_approval: false, blocked: true };
      }
      const requiredPresentationKinds = {
        production_spec_waiting_approval: ['spec', 'production_spec'],
        production_plan_waiting_approval: ['plan', 'production_plan'],
        production_pr_review: ['pr_review', 'pr'],
        production_publish_waiting_approval: ['pr', 'pr_publish', 'pr_review'],
        production_published: ['pr', 'pr_merge']
      }[current.stage];
      if (requiredPresentationKinds && !(await this.hasCurrentPresentation(current, requiredPresentationKinds))) {
        return { stage: current.stage, next_stage: target, mutation: false, requires_approval: false, blocked: true, reason: 'review artifact must be presented before approval' };
      }
      const currentIssueArtifact = [...(current.artifacts ?? [])].reverse().find((artifact) => artifact.kind === 'issue');
      if (current.stage === 'production_issue_waiting_review' && !(current.presentation_receipts ?? []).some((receipt) => receipt.artifact_kind === 'issue' && receipt.artifact_path === currentIssueArtifact?.path && receipt.approval_status === 'pending' && JSON.stringify(receipt.issue_identity) === JSON.stringify(current.issue_identity) && receipt.work_id === current.work_id)) {
        return { stage: current.stage, next_stage: target, mutation: false, requires_approval: false, blocked: true, reason: 'issue artifact must be presented before approval' };
      }
      try { const approval = await this.loadApproval(gateKind); if (approval.valid !== true || approval.work_id !== current.work_id) throw new Error('invalid approval'); }
      catch { return { stage: current.stage, next_stage: target, mutation: false, requires_approval: true }; }
      if (current.stage === 'prototype_design') await this.setStage('prototype_implementation', 'running');
      else if (current.stage === 'promotion_waiting_approval') await this.setStage('production_grilling', 'running');
      else if (current.stage === 'production_spec_waiting_approval') await this.setStage('production_issue_creating', 'running');
      else if (current.stage === 'production_issue_waiting_review') await this.setStage('production_issue_ready', 'running');
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
    else if (current.stage === 'production_issue_creating') await this.createProductionIssue();
    else if (current.stage === 'production_issue_ready') await this.issueCreated();
    else if (['production_planning', 'production_plan_review'].includes(current.stage)) await this.planReviewed();
    else if (current.stage === 'production_plan_improvement') await this.planImproved();
    else if (current.stage === 'production_implementation') await this.implementationComplete();
    else if (current.stage === 'production_pr_draft') await this.prReviewed();
    else if (current.stage === 'production_fix') await this.productionFixCompleted();
    else await this.setStage(target, 'ready');
    return { stage: before, next_stage: (await this.state()).stage, mutation: true, requires_approval: false };
  }
  async approve(kind, extra = {}) {
    const state = await this.state();
    if (kind === 'production_issue_review') {
      const currentIssueArtifact = [...(state.artifacts ?? [])].reverse().find((artifact) => artifact.kind === 'issue');
      const receipt = (state.presentation_receipts ?? []).find((item) => item.presentation_id === extra.presentation_id && item.artifact_kind === 'issue' && item.artifact_path === currentIssueArtifact?.path && item.approval_status === 'pending' && item.work_id === state.work_id && JSON.stringify(item.issue_identity) === JSON.stringify(state.issue_identity));
      if (!receipt) throw new Error('production issue approval requires a current issue presentation receipt');
      const verified = await verifyPresentationReceipt(this.productPath, receipt, { canonicalRevision: extra.canonical_revision ?? receipt.canonical_revision });
      if (!verified.ok) throw new Error('production issue presentation is stale');
      extra = { ...extra, artifact_digest: receipt.digest, canonical_revision: receipt.canonical_revision, issue_identity: state.issue_identity ?? extra.issue_identity };
    }
    const requiredPresentationKinds = (this.syntheticEvidence && kind === 'prototype_implementation') ? null : {
      prototype_implementation: ['prototype_design'],
      production_spec: ['spec', 'production_spec'],
      production_plan: ['plan', 'production_plan'],
      pr_publish: ['pr_review', 'pr'],
      pr_merge: ['pr']
    }[kind];
    if (requiredPresentationKinds && !(await this.hasCurrentPresentation(state, requiredPresentationKinds))) throw new Error(`${kind} approval requires a current presented artifact`);
    if (requiredPresentationKinds && !extra.presentation_id) {
      const artifact = [...(state.artifacts ?? [])].reverse().find((item) => requiredPresentationKinds.includes(item.kind));
      const receipt = [...(state.presentation_receipts ?? [])].reverse().find((item) => item.work_id === state.work_id && item.approval_status === 'pending' && item.artifact_path === artifact?.path && requiredPresentationKinds.includes(item.artifact_kind));
      if (!receipt) throw new Error(`${kind} approval requires a current presentation receipt`);
      const verified = await verifyPresentationReceipt(this.productPath, receipt, { canonicalRevision: receipt.canonical_revision });
      if (!verified.ok) throw new Error(`${kind} presentation is stale`);
      extra = { ...extra, presentation_id: receipt.presentation_id, artifact_digest: receipt.digest, canonical_revision: receipt.canonical_revision };
    }
    const approval = createApproval({ kind, approved_by: 'human', work_id: state.work_id === 'unassigned' ? 'fixture-work' : state.work_id, artifact_version: 1, ...extra });
    await fs.mkdir(path.join(this.productPath, '.ai-workflow', 'approvals'), { recursive: true });
    await fs.writeFile(path.join(this.productPath, '.ai-workflow', 'approvals', `${kind}.json`), JSON.stringify(approval, null, 2));
    return approval;
  }
  async hasCurrentPresentation(state, kinds) {
    const currentArtifact = [...(state.artifacts ?? [])].reverse().find((artifact) => kinds.includes(artifact.kind));
    if (!currentArtifact) return false;
    for (const receipt of state.presentation_receipts ?? []) {
      if (receipt.work_id !== state.work_id || receipt.approval_status !== 'pending' || receipt.artifact_path !== currentArtifact.path || !kinds.includes(receipt.artifact_kind)) continue;
      const verified = await verifyPresentationReceipt(this.productPath, receipt, { canonicalRevision: receipt.canonical_revision });
      if (verified.ok) return true;
    }
    return false;
  }
  async presentArtifact({ artifactPath, artifactKind, canonicalRevision = null, present }) {
    const state = await this.state();
    const receipt = await createPresentationReceipt(this.productPath, { path: artifactPath, kind: artifactKind }, { canonicalRevision, present });
    const persistedReceipt = { ...receipt, approval_status: 'pending', work_id: state.work_id, issue_identity: state.issue_identity };
    await this.store.update((current) => ({ ...current, presentation_receipts: [...(current.presentation_receipts ?? []).map((item) => item.artifact_path === persistedReceipt.artifact_path ? { ...item, approval_status: 'stale' } : item), persistedReceipt] }));
    return persistedReceipt;
  }
  async begin() { await this.store.setup({ project_id: 'sample-product' }); await this.store.update((s) => ({ ...s, work_id: 'fixture-work' })); const lifecycle = await ensureOrchestrator(this.store); this.generation = lifecycle.generation; await this.chatgptStep('prototype_design', 'prototype_design'); return this.setStage('prototype_design', 'waiting_for_chatgpt'); }
  async prototypeDesignApproved() { if (!this.syntheticEvidence && !(await this.hasCurrentPresentation(await this.state(), ['prototype_design']))) throw new Error('prototype design must be presented before approval'); await this.approve('prototype_implementation', this.syntheticEvidence ? {} : { require_presentation_binding: true }); return this.setStage('prototype_implementation', 'running'); }
  async prototypeImplemented() { const state = await this.state(); if (this.executionEngine && state.execution_plan?.stage === 'prototype') { const execution = await this.executionEngine.run(state.execution_plan, { baseRevision: state.current_revision ?? state.base_revision ?? 'HEAD', prompt: 'Execute the approved prototype units' }); await this.store.update((current) => ({ ...current, execution_result: execution, current_revision: execution.current_revision ?? current.current_revision })); } await this.chatgptStep('prototype_evaluation', 'prototype_evaluation'); return this.setStage('prototype_evaluation', 'waiting_for_chatgpt'); }
  async evaluatePrototype(decision) {
    if (!['ITERATE', 'PROMOTE_CANDIDATE', 'STOP'].includes(decision)) throw new Error(`invalid prototype decision: ${decision}`);
    if (decision === 'ITERATE') return this.setStage('prototype_implementation', 'waiting_for_human');
    if (decision === 'STOP') return this.setStage('stopped', 'stopped', null);
    return this.setStage('promotion_waiting_approval', 'waiting_for_human');
  }
  async promotionApproved() { await this.approve('promotion'); return this.setStage('production_grilling', 'running'); }
  async productionGrilled() {
    const state = await this.state();
    const artifact = await writeArtifact(this.productPath, { projectId: state.project_id, stage: 'production_spec_waiting_approval', workId: state.work_id, artifactType: 'production-spec', version: state.revision + 1 }, `# Production Specification\n\n- work_id: ${state.work_id}\n- source: approved grilling record\n`);
    await this.store.update((current) => ({ ...current, artifacts: [...(current.artifacts ?? []), { kind: 'production_spec', path: artifact, version: current.revision + 1 }] }));
    return this.setStage('production_spec_waiting_approval', 'waiting_for_human');
  }
  async productionSpecApproved() { await this.approve('production_spec'); return this.setStage('production_issue_creating', 'running'); }
  async createProductionIssue() {
    const state = await this.state();
    const body = `# Production Issue\n\n- work_id: ${state.work_id}\n- repository: ${this.expectedRepository}\n- source_stage: ${state.stage}\n\nThis Issue was generated from the approved production specification.\n`;
    const artifact = await writeArtifact(this.productPath, { projectId: state.project_id, stage: 'production_issue_waiting_review', workId: state.work_id, artifactType: 'production-issue', version: state.revision + 1 }, body);
    if (!this.syntheticEvidence && !this.issueGateway) throw Object.assign(new Error("Issue #4 gateway is required before live Issue creation"), { code: 4 }); const transport = this.issueGateway ?? this.github; const created = transport?.createIssue ? await transport.createIssue({ title: `Production work: ${state.work_id}`, body, repository: this.expectedRepository }) : {};
    const issueIdentity = { repository: this.expectedRepository, number: created.number ?? null, node_id: created.node_id ?? null, url: created.url ?? null, provisional_id: `${this.expectedRepository}:${state.work_id}` };
    await this.store.update((current) => ({ ...current, issue_identity: issueIdentity, artifacts: [...(current.artifacts ?? []), { kind: 'issue', path: artifact, version: current.revision + 1 }] }));
    return this.setStage('production_issue_waiting_review', 'waiting_for_human');
  }
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
    const artifact = [...(state.artifacts ?? [])].reverse().find((item) => item.kind === 'plan' || item.kind === 'production_plan');
    let executionPlan = null; let manifestDigest = null;
    if (artifact) { try { executionPlan = JSON.parse(await fs.readFile(path.resolve(this.productPath, artifact.path), 'utf8')); const unsigned = { ...executionPlan }; delete unsigned.approval_digest; manifestDigest = crypto.createHash('sha256').update(JSON.stringify(unsigned)).digest('hex'); executionPlan = { ...executionPlan, approval_digest: manifestDigest }; } catch { /* legacy markdown plans remain supported in fixtures */ } }
    await this.approve('production_plan', manifestDigest ? { manifest_digest: manifestDigest } : {});
    if (executionPlan) await this.store.update((current) => ({ ...current, execution_plan: executionPlan, execution_plan_digest: manifestDigest }));
    return this.setStage('production_implementation', 'running');
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
  async implementationComplete() { const state = await this.assertActiveGeneration(); const planArtifact = [...(state.artifacts ?? [])].reverse().find((artifact) => artifact.kind === 'plan' || artifact.kind === 'production_plan'); let plan = state.execution_plan ?? null; if (!plan && planArtifact) { try { plan = JSON.parse(await fs.readFile(path.resolve(this.productPath, planArtifact.path), 'utf8')); } catch { plan = null; } } if (plan && this.executionEngine) { const approval = await this.loadApproval('production_plan'); const execution = await this.executionEngine.run(plan, { baseRevision: state.current_revision ?? state.base_revision ?? 'HEAD', approvedDigest: approval.manifest_digest ?? state.execution_plan_digest }); await this.store.update((current) => ({ ...current, execution_result: execution, current_revision: execution.current_revision ?? current.current_revision })); } else if (plan && !this.syntheticEvidence) throw new Error('approved execution plan requires a configured execution engine'); return this.setStage('production_pr_draft', 'running'); }
  async prReviewed() {
    const review = await this.chatgptStep('pr_review', 'production_pr_review');
    const blocking = (review.findings ?? []).filter((finding) => ['CRITICAL', 'HIGH', 'IMPORTANT'].includes(String(finding.severity ?? '').toUpperCase()));
    await this.store.update((current) => ({ ...current, unresolved_blocking_findings: blocking.length, pr_review_findings: review.findings ?? [] }));
    return blocking.length ? this.setStage('production_fix', 'running') : this.setStage('production_pr_review', 'waiting_for_human');
  }
  async productionFixCompleted() {
    const state = await this.state();
    const findings = (state.pr_review_findings ?? []).filter((finding) => ['CRITICAL', 'HIGH', 'IMPORTANT'].includes(String(finding.severity ?? '').toUpperCase()));
    const fixPlan = state.execution_plan ? { ...state.execution_plan, plan_id: `${state.execution_plan.plan_id}-fix-${(state.review_iteration ?? 0) + 1}`, units: findings.map((finding, index) => ({ unit_id: `fix-${finding.id ?? index + 1}`, purpose: `Resolve PR finding ${finding.id ?? index + 1}`, dependency_ids: [], change_scope: finding.change_scope ?? ['.'], acceptance_criteria: ['finding is resolved'], unit_tests: finding.unit_tests ?? ['targeted regression test'], integration_criteria: ['integrated and retested'] })) } : null;
    let fixExecution = null; if (this.executionEngine && fixPlan) fixExecution = await this.executionEngine.run(fixPlan, { baseRevision: state.current_revision ?? state.base_revision ?? 'HEAD', approvedDigest: state.execution_plan_digest, prompt: 'Apply only the blocking PR review findings' });
    else if (findings.length && !this.syntheticEvidence) throw new Error('blocking PR findings require a configured fix execution engine');
    await this.store.update((current) => ({ ...current, unresolved_blocking_findings: 0, review_iteration: (current.review_iteration ?? 0) + 1, current_revision: fixExecution?.current_revision ?? current.current_revision ?? current.base_revision, presentation_receipts: (current.presentation_receipts ?? []).map((receipt) => ({ ...receipt, approval_status: 'stale' })) }));
    return this.setStage('production_pr_draft', 'running');
  }
  async publishApproved() { const evidence = await this.evidenceProvider(await this.state()); await this.approve('pr_publish', evidence); return this.setStage('production_publish_waiting_approval', 'ready'); }
  async loadApproval(kind) { return JSON.parse(await fs.readFile(path.join(this.productPath, '.ai-workflow', 'approvals', `${kind}.json`), 'utf8')); }
  async requireApproval(kind, expected = {}) {
    let approval; try { approval = await this.loadApproval(kind); } catch { throw Object.assign(new Error(`${kind} approval is required`), { code: 4 }); }
    const required = ['valid', 'work_id', 'pr_number', 'target_revision', 'test_run_id', 'test_artifact', 'review_artifact', 'review_iteration', 'unresolved_blocking_findings'];
    if (!approval.valid || required.some((key) => approval[key] === undefined || approval[key] === null) || approval.unresolved_blocking_findings !== 0 || Object.entries(expected).some(([key, value]) => approval[key] !== value)) throw Object.assign(new Error(`${kind} approval binding is stale or incomplete`), { code: 4 });
    const state = await this.state();
    const kinds = { pr_publish: ['pr_review', 'pr'], pr_merge: ['pr'] }[kind];
    if (kinds && !(await this.hasCurrentPresentation(state, kinds))) throw Object.assign(new Error(`${kind} approval presentation is stale`), { code: 4 });
    if (kinds) { const current = [...(state.presentation_receipts ?? [])].reverse().find((receipt) => receipt.presentation_id === approval.presentation_id && receipt.approval_status === 'pending' && kinds.includes(receipt.artifact_kind)); if (!current || current.digest !== approval.artifact_digest || current.canonical_revision !== approval.canonical_revision) throw Object.assign(new Error(`${kind} approval is not bound to the current presentation`), { code: 4 }); }
    return approval;
  }
  async publish() { if (!this.github) throw Object.assign(new Error('live GitHub adapter is required'), { code: 4 }); const state = await this.state(); const evidence = await this.evidenceProvider(state); await this.requireApproval('pr_publish', { work_id: state.work_id, ...evidence }); if (!(await this.hasCurrentPresentation(state, ['pr_review', 'pr']))) throw Object.assign(new Error('PR review artifact must be presented before publishing'), { code: 4 }); const created = await this.github.createPullRequest({ head: evidence.target_revision, issue_url: 'https://example.invalid/issues/1' }); const artifact = await writeArtifact(this.productPath, { projectId: state.project_id, stage: 'production_published', workId: state.work_id, artifactType: 'pr', version: state.revision + 1 }, `# Pull Request\n\n- number: ${created.number ?? evidence.pr_number ?? 'unknown'}\n- head: ${created.head ?? evidence.target_revision}\n`); await this.store.update((current) => ({ ...current, artifacts: [...(current.artifacts ?? []), { kind: 'pr', path: artifact, version: current.revision + 1 }] })); return this.setStage('production_published', 'waiting_for_human'); }
  async mergeApproved() { const evidence = await this.evidenceProvider(await this.state()); await this.approve('pr_merge', evidence); return this.setStage('production_merge_waiting_approval', 'ready'); }
  async merge() { if (!this.github) throw Object.assign(new Error('live GitHub adapter is required'), { code: 4 }); const state = await this.state(); const evidence = await this.evidenceProvider(state); await this.requireApproval('pr_merge', { work_id: state.work_id, ...evidence }); if (!(await this.hasCurrentPresentation(state, ['pr_review', 'pr']))) throw Object.assign(new Error('PR review artifact must be presented before merging'), { code: 4 }); await this.github.mergePullRequest({ number: evidence.pr_number, head: evidence.target_revision }); return this.setStage('completed', 'completed', null); }
}

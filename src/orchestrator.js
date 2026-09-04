import fs from 'node:fs/promises';
import path from 'node:path';
import { StateStore } from './state-store.js';
import { createApproval } from './approvals.js';
import { createFakeGitHubAdapter } from './adapters/github.js';
import { writeArtifact } from './artifacts.js';
import { createRequest, sanitizeRequest, parseResponse, createFakeC2CAdapter } from './adapters/chatgpt-c2c.js';
import { desiredProject, verifyProject } from './adapters/chatgpt-project.js';
import { nextStage } from './workflow.js';

const actions = {
  prototype_intake: 'chatgpt_prototype_design', prototype_design: 'human_approve_prototype_implementation',
  prototype_implementation: 'chatgpt_prototype_evaluation', prototype_evaluation: 'human_decide_prototype_evaluation',
  promotion_waiting_approval: 'human_approve_promotion', production_grilling: 'human_approve_production_spec',
  production_spec_waiting_approval: 'create_production_issue', production_issue_ready: 'chatgpt_production_plan',
  production_planning: 'chatgpt_independent_plan_review', production_plan_review: 'human_approve_plan',
  production_plan_waiting_approval: 'codex_implement', production_implementation: 'create_local_pr_draft',
  production_pr_draft: 'chatgpt_pr_review', production_pr_review: 'human_approve_publish',
  production_publish_waiting_approval: 'publish_github_pr', production_published: 'human_approve_merge',
  production_merge_waiting_approval: 'merge_github_pr', completed: null
};

export class WorkflowOrchestrator {
  constructor(productPath, github = null, evidenceProvider = null, c2c = null, projectProvider = null) { this.productPath = productPath; this.store = new StateStore(productPath); this.syntheticEvidence = path.resolve(productPath).includes(`${path.sep}fixtures${path.sep}`) || github?.synthetic === true; this.github = github ?? (this.syntheticEvidence ? createFakeGitHubAdapter() : null); this.c2c = c2c ?? (this.syntheticEvidence ? createFakeC2CAdapter() : null); this.projectProvider = projectProvider ?? (async (kind) => { if (!this.syntheticEvidence) throw Object.assign(new Error('live ChatGPT Project provider is required'), { code: 4 }); return desiredProject(kind); }); this.evidenceProvider = evidenceProvider ?? (async (state) => { if (!this.syntheticEvidence) throw new Error('live evidence provider is required outside fixtures'); return { pr_number: state.pr_number ?? 1, target_revision: state.current_revision ?? state.base_revision ?? 'workspace-head', test_run_id: state.test_run_id ?? 'phase1-local-001', test_artifact: state.test_artifact ?? 'work/runs/phase1-test-run.md', review_artifact: state.review_artifact ?? 'work/local-pr-draft.md', review_iteration: state.review_iteration ?? 0, unresolved_blocking_findings: state.unresolved_blocking_findings ?? 0 }; }); }
  async state() { return (await this.store.read()).state; }
  async setStage(stage, status = 'ready', nextAction = actions[stage]) {
    const action = nextAction ?? 'none'; const current = await this.state();
    const artifact = await writeArtifact(this.productPath, { projectId: current.project_id, stage, workId: current.work_id, artifactType: 'stage-log', version: current.revision + 1 }, `# Stage transition\n\n- from: ${current.stage}\n- to: ${stage}\n- status: ${status}\n- next_action: ${action}`);
    return this.store.update((state) => ({ ...state, stage, status, next_action: action, artifacts: [...(state.artifacts ?? []), { kind: 'stage-log', path: artifact, version: state.revision + 1 }], agent_state: { ...state.agent_state, stage, status, next_action: action, waiting_reason: status.includes('waiting') ? action : null, error: null } }));
  }
  async chatgptStep(operation, stage) {
    if (!this.c2c) throw Object.assign(new Error('live ChatGPT C2C adapter is required'), { code: 4 });
    const state = await this.state(); const kind = operation.includes('prototype') ? 'prototype' : 'production';
    const actual = await this.projectProvider(kind); if (!verifyProject(actual, kind)) throw Object.assign(new Error('ChatGPT Project verification failed'), { code: 4 });
    const request = sanitizeRequest(createRequest({ taskId: `workflow-${operation}`, iteration: state.revision, operation, workspace: state.project_id, workId: state.work_id, stage, inputs: state.artifacts.map((a) => a.path), readScope: ['state', 'artifacts'], expected: 'structured response' }));
    const response = parseResponse(await this.c2c.request(request)); const artifact = await writeArtifact(this.productPath, { projectId: state.project_id, stage, workId: state.work_id, artifactType: operation, version: state.revision + 1 }, response.artifact ?? JSON.stringify(response, null, 2));
    await this.store.update((current) => ({ ...current, artifacts: [...(current.artifacts ?? []), { kind: operation, path: artifact, version: current.revision + 1 }] })); return response;
  }
  async next() {
    const current = await this.state(); const target = nextStage(current.stage); if (!target) return { stage: current.stage, next_stage: null, mutation: false, stopped: true };
    const gateKinds = { prototype_design: 'prototype_implementation', promotion_waiting_approval: 'promotion', production_spec_waiting_approval: 'production_spec', production_plan_waiting_approval: 'production_plan', production_pr_review: 'pr_publish', production_publish_waiting_approval: 'pr_publish', production_published: 'pr_merge', production_merge_waiting_approval: 'pr_merge' };
    const gateKind = gateKinds[current.stage];
    if (gateKind) {
      const before = current.stage;
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
    else if (current.stage === 'production_planning') await this.planReviewed();
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
  async issueCreated() { await this.chatgptStep('production_plan', 'production_planning'); return this.setStage('production_planning', 'waiting_for_chatgpt'); }
  async planReviewed() { await this.chatgptStep('independent_plan_review', 'production_plan_review'); return this.setStage('production_plan_waiting_approval', 'waiting_for_human'); }
  async planApproved() { await this.approve('production_plan'); return this.setStage('production_implementation', 'running'); }
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

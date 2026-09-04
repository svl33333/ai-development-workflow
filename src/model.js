export const STAGES = [
  'prototype_intake', 'prototype_design', 'prototype_implementation', 'prototype_evaluation',
  'promotion_waiting_approval', 'production_grilling', 'production_spec_waiting_approval',
  'production_issue_ready', 'production_planning', 'production_plan_review',
  'production_plan_waiting_approval', 'production_implementation', 'production_pr_draft',
  'production_pr_review', 'production_fix', 'production_publish_waiting_approval',
  'production_published', 'production_merge_waiting_approval', 'completed', 'stopped', 'blocked'
];

export const APPROVAL_KINDS = [
  'prototype_implementation', 'promotion', 'production_spec', 'production_plan',
  'pr_publish', 'pr_merge', 'destructive_operation', 'spec_change', 'update'
];

export function initialState(projectId, workflowVersion = 1) {
  const now = new Date().toISOString();
  return {
    workflow_version: workflowVersion, schema_version: 1, adapter_version: 1,
    project_id: projectId, work_id: 'unassigned', stage: 'prototype_intake', status: 'ready',
    agent: 'codex', chatgpt_project: 'prototype', artifacts: [], base_revision: null,
    current_revision: null, next_action: 'create_concept_brief', stop_reason: null, revision: 1,
    updated_at: now,
    agent_state: { agent: 'codex', stage: 'prototype_intake', status: 'ready', started_at: now,
      updated_at: now, waiting_reason: null, next_action: 'create_concept_brief', error: null }
  };
}

export function validateState(state) {
  const required = ['workflow_version', 'project_id', 'work_id', 'stage', 'status', 'next_action', 'revision', 'updated_at'];
  const errors = required.filter((key) => state[key] === undefined || state[key] === null).map((key) => `${key} is required`);
  if (!STAGES.includes(state.stage)) errors.push(`unknown stage: ${state.stage}`);
  if (!state.agent_state || typeof state.agent_state !== 'object') errors.push('agent_state is required');
  else for (const key of ['agent', 'stage', 'status', 'started_at', 'updated_at', 'waiting_reason', 'next_action', 'error']) {
    if (!(key in state.agent_state)) errors.push(`agent_state.${key} is required`);
  }
  if (state.agent_state && (state.agent_state.stage !== state.stage || state.agent_state.next_action !== state.next_action)) {
    errors.push('agent_state disagrees with top-level stage or next_action');
  }
  return errors;
}

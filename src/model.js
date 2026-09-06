export const STAGES = [
  'prototype_intake', 'prototype_design', 'prototype_implementation', 'prototype_evaluation',
  'promotion_waiting_approval', 'production_grilling', 'production_spec_waiting_approval',
  'production_issue_creating', 'production_issue_waiting_review', 'production_issue_ready', 'production_planning', 'production_plan_review', 'production_plan_improvement',
  'production_plan_waiting_approval', 'production_implementation', 'production_pr_draft',
  'production_pr_review', 'production_fix', 'production_publish_waiting_approval',
  'production_published', 'production_merge_waiting_approval', 'completed', 'stopped', 'blocked'
];

export const APPROVAL_KINDS = [
  'prototype_implementation', 'promotion', 'production_spec', 'production_issue_review', 'production_plan',
  'pr_publish', 'pr_merge', 'destructive_operation', 'spec_change', 'update',
  'review_conversation_replacement'
];

export function deriveQualifyingPlanReviewIteration(reviewHistory, activeConversationId) {
  if (!activeConversationId || !Array.isArray(reviewHistory)) return 0;
  const qualifying = reviewHistory.filter((review) => review.stage === 'production_plan_review'
    && review.role === 'plan_review'
    && review.conversation_id === activeConversationId
    && review.improved === true
    && review.dispositions_complete === true);
  let expectedRound = 1;
  for (const review of qualifying) {
    if (review.round !== expectedRound) return expectedRound - 1;
    expectedRound += 1;
  }
  return qualifying.length;
}

export function initialState(projectId, workflowVersion = 1) {
  const now = new Date().toISOString();
  return {
    workflow_version: workflowVersion, schema_version: 1, adapter_version: 1,
    orchestrator_id: null, orchestrator_generation: 1, orchestrator_status: 'ACTIVE',
    project_id: projectId, work_id: 'unassigned', stage: 'prototype_intake', status: 'ready',
    agent: 'codex', chatgpt_project: 'prototype', artifacts: [], base_revision: null,
    current_revision: null, next_action: 'create_concept_brief', stop_reason: null, revision: 1,
    plan_review_iteration: 0, qualifying_plan_review_iteration: 0, review_history: [],
    prototype_review_iteration: 0, qualifying_prototype_review_iteration: 0, prototype_model_confirmed: false, prototype_review_conversation_id: null, prototype_required_model: null, prototype_actual_model: null, prototype_model_user_confirmed: false,
    issue_identity: null, connection_binding: null, conversation_registry: {}, presentation_receipts: [], active_external_operation: null,
    review_context: {
      planning_conversation_id: null, active_plan_review_conversation_id: null,
      active_plan_review_project_id: null, active_plan_review_history_revision: 0,
      active_plan_review_non_resumable_reason: null, replacement_history: []
    },
    updated_at: now,
    conversation: { task_id: null, iteration: 0, project_id: null, project_url: null, conversation_id: null, conversation_url: null, workspace: null, role: null, stage: null, state: 'INIT', last_message_id: null, next_operation: null, failure_reason: null, sent_messages: [] },
    agent_state: { agent: 'codex', stage: 'prototype_intake', status: 'ready', started_at: now,
      updated_at: now, waiting_reason: null, next_action: 'create_concept_brief', error: null }
  };
}

export function validateState(state) {
  const required = ['workflow_version', 'project_id', 'work_id', 'stage', 'status', 'next_action', 'revision', 'plan_review_iteration', 'qualifying_plan_review_iteration', 'review_history', 'review_context', 'updated_at'];
  const errors = required.filter((key) => state[key] === undefined || state[key] === null).map((key) => `${key} is required`);
  if (!STAGES.includes(state.stage)) errors.push(`unknown stage: ${state.stage}`);
  if (!Number.isInteger(state.plan_review_iteration) || state.plan_review_iteration < 0) errors.push('plan_review_iteration is invalid');
  if (!Number.isInteger(state.qualifying_plan_review_iteration) || state.qualifying_plan_review_iteration < 0) errors.push('qualifying_plan_review_iteration is invalid');
  if (state.prototype_review_iteration !== undefined && (!Number.isInteger(state.prototype_review_iteration) || state.prototype_review_iteration < 0)) errors.push('prototype_review_iteration is invalid');
  if (state.qualifying_prototype_review_iteration !== undefined && (!Number.isInteger(state.qualifying_prototype_review_iteration) || state.qualifying_prototype_review_iteration < 0)) errors.push('qualifying_prototype_review_iteration is invalid');
  if (state.prototype_model_confirmed !== undefined && typeof state.prototype_model_confirmed !== 'boolean') errors.push('prototype_model_confirmed is invalid');
  for (const key of ['prototype_review_conversation_id', 'prototype_required_model', 'prototype_actual_model']) if (state[key] !== undefined && state[key] !== null && typeof state[key] !== 'string') errors.push(`${key} is invalid`);
  if (state.prototype_model_user_confirmed !== undefined && typeof state.prototype_model_user_confirmed !== 'boolean') errors.push('prototype_model_user_confirmed is invalid');
  if (!Array.isArray(state.review_history)) errors.push('review_history is invalid');
  if (!state.review_context || typeof state.review_context !== 'object' || !Array.isArray(state.review_context.replacement_history)) errors.push('review_context is invalid');
  if (!state.agent_state || typeof state.agent_state !== 'object') errors.push('agent_state is required');
  else for (const key of ['agent', 'stage', 'status', 'started_at', 'updated_at', 'waiting_reason', 'next_action', 'error']) {
    if (!(key in state.agent_state)) errors.push(`agent_state.${key} is required`);
  }
  if (state.agent_state && (state.agent_state.stage !== state.stage || state.agent_state.next_action !== state.next_action)) {
    errors.push('agent_state disagrees with top-level stage or next_action');
  }
  if (state.conversation !== undefined && (!state.conversation || typeof state.conversation !== 'object' || !Array.isArray(state.conversation.sent_messages))) errors.push('conversation state is invalid');
  if (state.conversation && !['INIT', 'PREPARED', 'SENDING', 'AMBIGUOUS', 'EXECUTING', 'EXECUTED', 'REVIEW', 'DONE', 'BLOCKED'].includes(state.conversation.state)) errors.push('conversation state is unknown');
  if (state.conversation && state.conversation.state !== 'INIT') {
    for (const key of ['task_id', 'project_id', 'workspace', 'role', 'stage', 'conversation_id', 'last_message_id', 'next_operation']) if (!state.conversation[key]) errors.push(`conversation.${key} is required outside INIT`);
    for (const entry of state.conversation.sent_messages) {
      if (!entry.task_id || !Number.isInteger(entry.iteration) || !entry.message_id || !entry.conversation_id || !['prepared', 'sending', 'confirmed', 'ambiguous'].includes(entry.delivery_state)) errors.push('conversation.sent_messages entry is invalid');
    }
  }
  if (state.presentation_receipts !== undefined && !Array.isArray(state.presentation_receipts)) errors.push('presentation_receipts is invalid');
  if (!Number.isInteger(state.orchestrator_generation) || state.orchestrator_generation < 1) errors.push('orchestrator_generation is invalid');
  if (!['ACTIVE', 'SUPERSEDED', 'STOPPED'].includes(state.orchestrator_status)) errors.push('orchestrator_status is invalid');
  if (state.conversation_registry !== undefined && (!state.conversation_registry || typeof state.conversation_registry !== 'object' || Array.isArray(state.conversation_registry))) errors.push('conversation_registry is invalid');
  return errors;
}

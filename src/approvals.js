import { APPROVAL_KINDS } from './model.js';

export function createApproval(input) {
  if (!APPROVAL_KINDS.includes(input.kind)) throw new Error(`unknown approval kind: ${input.kind}`);
  if (!input.approved_by || !input.work_id) throw new Error('approved_by and work_id are required');
  if (input.kind === 'destructive_operation' && !input.operation_id) throw new Error('operation_id is required');
  if (['prototype_implementation', 'production_spec'].includes(input.kind) && !input.artifact_version) throw new Error('artifact_version is required');
  if (input.kind === 'production_issue_review' && (!input.presentation_id || !input.artifact_digest || !input.canonical_revision || !input.issue_identity)) throw new Error('production_issue_review requires presentation binding');
  if (input.kind === 'update' && (!input.candidate_version || !input.project_id || !input.managed_workflow_digest)) throw new Error('update requires candidate_version, project_id, and managed_workflow_digest');
  if (input.kind === 'review_conversation_replacement' && (!input.review_stage || !input.review_role || !input.old_conversation_id || !input.replacement_reason || !Number.isInteger(input.review_history_revision))) throw new Error('review_conversation_replacement requires a complete review binding');
  if (['pr_publish', 'pr_merge'].includes(input.kind) && (!input.pr_number || !input.target_revision || !input.test_run_id || !input.test_artifact || !input.review_artifact || input.review_iteration === undefined || input.unresolved_blocking_findings !== 0)) throw new Error(`${input.kind} requires complete test/review binding`);
  return { ...input, valid: true, approved_at: input.approved_at ?? new Date().toISOString() };
}

export function approvalMatches(approval, expected) {
  return Boolean(approval?.valid && Object.entries(expected).every(([key, value]) => approval[key] === value));
}

export function createHandoff({ status, next_action, artifacts = [], findings = [], questions = [], stop_reason = null }) {
  if (!status || !next_action) throw new Error('status and next_action are required');
  return { status, next_action, artifacts, findings, questions, stop_reason, handoff_summary: `${status}: ${next_action}` };
}

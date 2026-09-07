const { operationKey } = require('./review-preflight.cjs');
function githubOperationKey({ operationType, repositoryIdentity, issueOrPrIdentity, taskId, generation, targetRevision }) { return operationKey([operationType, repositoryIdentity, issueOrPrIdentity, taskId, String(generation), targetRevision]); }
function chatgptOperationKey({ connectorIdentity, workspaceIdentity, projectIdentity, conversationIdentity, taskId, stage, iteration, bundleDigest, targetRevision }) { return operationKey(['chatgpt_request', connectorIdentity, workspaceIdentity, projectIdentity, conversationIdentity, taskId, stage, String(iteration), bundleDigest, targetRevision]); }
function resumeDecision(record, remote) { if (record.status === 'verified') return 'reuse'; if (record.status === 'result_unknown' && remote?.operation_key === record.operation_key) return 'reuse'; if (record.status === 'result_unknown') return 'blocked'; return 'resume'; }
async function executeOperation({ store, record, mutate, verify }) {
  const reservation = store.reserve(record.operation_key, { ...record, status: 'reserved' });
  if (!reservation.acquired) {
    const existing = reservation.record;
    const remote = await verify(existing);
    if (existing.status === 'verified' || (existing.status === 'result_unknown' && remote?.operation_key === existing.operation_key)) return { ...existing, remote_verification: remote };
    if (existing.status === 'result_unknown') throw Object.assign(new Error('RESULT_UNKNOWN'), { workflow_status: 'result_unknown' });
    record = { ...existing, ...record };
  }
  let result;
  store.update(record.operation_key, { status: 'mutating', checkpoint: 'mutating' });
  try { result = await mutate(record); } catch (error) { const workflowStatus = error.code === 'AUTH_REQUIRED' ? 'auth_waiting' : error.code === 'CONNECTION_REQUIRED' ? 'connection_waiting' : 'result_unknown'; store.update(record.operation_key, { status: workflowStatus === 'result_unknown' ? 'result_unknown' : 'failed', checkpoint: workflowStatus, workflow_status: workflowStatus, error: { code: error.code ?? 'UNKNOWN', message: error.message } }); throw Object.assign(error, { workflow_status: workflowStatus }); }
  let remote;
  try { remote = await verify({ ...record, result }); } catch (error) { store.update(record.operation_key, { status: 'result_unknown', checkpoint: 'result_unknown', result }); throw Object.assign(error, { workflow_status: 'result_unknown' }); }
  if (!remote || remote.operation_key !== record.operation_key) { store.update(record.operation_key, { status: 'result_unknown', checkpoint: 'result_unknown', result }); throw Object.assign(new Error('RESULT_UNKNOWN'), { workflow_status: 'result_unknown' }); }
  const verified = store.update(record.operation_key, { status: 'verified', checkpoint: 'verified', result, remote_verification: remote });
  return { ...verified, remote_verification: remote };
}
module.exports = { githubOperationKey, chatgptOperationKey, resumeDecision, executeOperation };

const { operationKey } = require('./review-preflight');
function githubOperationKey({ operationType, repositoryIdentity, issueOrPrIdentity, taskId, generation, targetRevision }) { return operationKey([operationType, repositoryIdentity, issueOrPrIdentity, taskId, String(generation), targetRevision]); }
function chatgptOperationKey({ connectorIdentity, workspaceIdentity, projectIdentity, conversationIdentity, taskId, stage, iteration, bundleDigest, targetRevision }) { return operationKey(['chatgpt_request', connectorIdentity, workspaceIdentity, projectIdentity, conversationIdentity, taskId, stage, String(iteration), bundleDigest, targetRevision]); }
function resumeDecision(record, remote) { if (record.status === 'verified') return 'reuse'; if (record.status === 'result_unknown' && remote?.operation_key === record.operation_key) return 'reuse'; if (record.status === 'result_unknown') return 'blocked'; return 'resume'; }
async function executeOperation({ store, record, mutate, verify }) {
  const reservation = store.reserve(record.operation_key, { ...record, status: 'reserved' });
  if (!reservation.acquired) return resumeDecision(reservation.record, await verify(reservation.record));
  let result;
  try { result = await mutate(record); } catch (error) { if (error.code === 'AUTH_REQUIRED') throw Object.assign(error, { workflow_status: 'auth_waiting' }); if (error.code === 'CONNECTION_REQUIRED') throw Object.assign(error, { workflow_status: 'connection_waiting' }); throw error; }
  const remote = await verify({ ...record, result });
  if (!remote || remote.operation_key !== record.operation_key) throw Object.assign(new Error('RESULT_UNKNOWN'), { workflow_status: 'result_unknown' });
  return { status: 'verified', operation_key: record.operation_key, result, remote_verification: remote };
}
module.exports = { githubOperationKey, chatgptOperationKey, resumeDecision, executeOperation };

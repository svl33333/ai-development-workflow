const { preflight, validateReviewResponseSchema } = require('./review-preflight');
function validateResponse(response, bundle) {
  const errors = validateReviewResponseSchema(response);
  for (const key of ['task_id', 'iteration', 'target_revision', 'findings']) if (response[key] === undefined) errors.push(`RESPONSE_REQUIRED: ${key}`);
  if (response.task_id !== bundle.task_id || response.iteration !== bundle.iteration || response.target_revision !== bundle.target_revision) errors.push('RESPONSE_BINDING_MISMATCH');
  if (response.target_revision !== bundle.implementation_revision) errors.push('REVIEW_REVISION_MISMATCH');
  for (const finding of response.findings || []) for (const key of ['finding_id', 'severity', 'evidence_path', 'disposition']) if (!finding[key]) errors.push(`FINDING_REQUIRED: ${key}`);
  return { ok: errors.length === 0, errors };
}
function prepareReview(bundle, context) { const result = preflight(bundle, context); if (!result.ok) throw new Error(`REVIEW_PREFLIGHT_FAILED: ${result.errors.join(',')}`); return result; }
module.exports = { prepareReview, validateResponse };

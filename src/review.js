const { preflight, validateReviewResponseSchema } = require('./review-preflight');
function validateResponse(response, bundle) {
  const errors = validateReviewResponseSchema(response);
  for (const key of ['task_id', 'iteration', 'target_revision', 'findings']) if (response[key] === undefined) errors.push(`RESPONSE_REQUIRED: ${key}`);
  if (response.task_id !== bundle.task_id || response.iteration !== bundle.iteration || response.target_revision !== bundle.target_revision) errors.push('RESPONSE_BINDING_MISMATCH');
  if (response.target_revision !== bundle.implementation_revision) errors.push('REVIEW_REVISION_MISMATCH');
  if (response.fix_revision && response.fix_revision === bundle.target_revision) errors.push('FIX_REVISION_NOT_ADVANCED');
  if (response.prior_review_digest && response.prior_review_digest === bundle.bundle_digest) errors.push('PRIOR_REVIEW_LINEAGE_MISMATCH');
  if (bundle.iteration > 1) for (const key of ['prior_review_digest', 'fix_revision']) if (!response[key]) errors.push(`REVIEW_LINEAGE_REQUIRED: ${key}`);
  if (bundle.iteration > 1 && response.findings.some((finding) => ['Critical', 'High'].includes(finding.severity)) && response.findings.some((finding) => !finding.prior_finding_id || !finding.fix_range)) errors.push('BLOCKING_FINDING_LINEAGE_REQUIRED');
  for (const finding of response.findings || []) for (const key of ['finding_id', 'severity', 'evidence_path', 'disposition']) if (!finding[key]) errors.push(`FINDING_REQUIRED: ${key}`);
  return { ok: errors.length === 0, errors };
}
function prepareReview(bundle, context) { const result = preflight(bundle, context); if (!result.ok) throw new Error(`REVIEW_PREFLIGHT_FAILED: ${result.errors.join(',')}`); return result; }
module.exports = { prepareReview, validateResponse };

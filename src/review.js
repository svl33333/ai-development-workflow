const fs = require('node:fs');
const path = require('node:path');
const { preflight, validateReviewResponseSchema, changedPaths, resolveRevision } = require('./review-preflight');

function recordDigest(record) {
  if (record.review_digest) return record.review_digest;
  if (record.bundle_digest) return record.bundle_digest;
  if (record.digest) return record.digest;
  return null;
}

function loadPreviousReviewRecord(bundle, context) {
  const supplied = context.previousReviewRecord ?? context.previous_review_record ?? bundle.previous_review_record;
  const suppliedPath = context.previousReviewRecordPath ?? context.previous_review_record_path;
  if (suppliedPath) {
    const recordPath = path.resolve(context.repositoryRoot ?? bundle.project.workspace, suppliedPath);
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    if (record.artifact_digest) {
      const actual = require('./artifact-digest').workingTreeDigest(recordPath);
      if (actual.value !== record.artifact_digest) throw new Error('PRIOR_REVIEW_RECORD_ARTIFACT_MISMATCH');
    }
    return record;
  }
  if (typeof supplied === 'string') return JSON.parse(fs.readFileSync(path.resolve(context.repositoryRoot ?? bundle.project.workspace, supplied), 'utf8'));
  return supplied;
}

function findingPath(fixRange) {
  if (typeof fixRange !== 'string' || fixRange.length === 0) return null;
  const match = fixRange.match(/^(.+?)(?::|#)\d+(?:-\d+)?$/);
  return match ? match[1] : fixRange;
}

function verifyReviewLineage(response, bundle, context = {}) {
  if (bundle.iteration <= 1) return [];
  const errors = [];
  let previous;
  try { previous = loadPreviousReviewRecord(bundle, context); } catch { errors.push('PRIOR_REVIEW_RECORD_UNREADABLE'); return errors; }
  if (!previous) return ['PRIOR_REVIEW_RECORD_REQUIRED'];
  const digest = recordDigest(previous);
  if (!digest || response.prior_review_digest !== digest) errors.push('PRIOR_REVIEW_DIGEST_MISMATCH');
  if (previous.round !== undefined && response.prior_round !== undefined && response.prior_round !== previous.round) errors.push('PRIOR_REVIEW_ROUND_MISMATCH');
  const previousFindings = new Map((previous.findings ?? []).map((finding) => [finding.finding_id, finding]));
  for (const prior of previousFindings.values()) {
    if (!['Critical', 'High'].includes(prior.severity)) continue;
    const linked = (response.findings ?? []).filter((finding) => finding.prior_finding_id === prior.finding_id);
    if (linked.length === 0) {
      errors.push(`PRIOR_BLOCKING_FINDING_OMITTED:${prior.finding_id}`);
      continue;
    }
    for (const finding of linked) if (!['fixed', 'carry_forward', 'accepted', 'not_applicable'].includes(finding.disposition)) errors.push(`PRIOR_FINDING_DISPOSITION_REQUIRED:${prior.finding_id}`);
  }
  const repositoryRoot = context.repositoryRoot ?? bundle.project.workspace;
  for (const finding of response.findings ?? []) {
    if (!finding.prior_finding_id) continue;
    const prior = previousFindings.get(finding.prior_finding_id);
    if (!prior) {
      errors.push(`PRIOR_FINDING_NOT_FOUND:${finding.prior_finding_id}`);
      continue;
    }
    if (prior.severity && prior.severity !== finding.severity) errors.push(`PRIOR_FINDING_SEVERITY_MISMATCH:${finding.finding_id}`);
    const findingFixRevision = finding.fix_revision ?? response.fix_revision;
    if (!findingFixRevision || !finding.fix_range) {
      errors.push(`FINDING_FIX_LINEAGE_REQUIRED:${finding.finding_id}`);
      continue;
    }
    try {
      const fixRevision = resolveRevision(repositoryRoot, findingFixRevision);
      const priorFixRevision = prior.fix_revision ? resolveRevision(repositoryRoot, prior.fix_revision) : resolveRevision(repositoryRoot, previous.fix_revision ?? previous.review_revision ?? previous.target_revision);
      if (fixRevision === priorFixRevision) errors.push(`FIX_REVISION_NOT_ADVANCED:${finding.finding_id}`);
      const changed = changedPaths(repositoryRoot, `${priorFixRevision}..${fixRevision}`);
      const changedFile = findingPath(finding.fix_range);
      if (!changedFile || !changed.some((file) => file === changedFile || file.startsWith(`${changedFile}/`))) errors.push(`FIX_RANGE_NOT_VERIFIED:${finding.finding_id}`);
      if (prior.fix_range && finding.fix_range !== prior.fix_range && !changedFile) errors.push(`FIX_RANGE_MISMATCH:${finding.finding_id}`);
    } catch {
      errors.push(`FIX_REVISION_UNREADABLE:${finding.finding_id}`);
    }
  }
  if ((response.findings ?? []).some((finding) => ['Critical', 'High'].includes(finding.severity) && finding.disposition === 'fixed')) {
    for (const finding of response.findings) if (['Critical', 'High'].includes(finding.severity) && finding.disposition === 'fixed' && (!finding.prior_finding_id || !(finding.fix_revision ?? response.fix_revision) || !finding.fix_range)) errors.push('BLOCKING_FINDING_LINEAGE_REQUIRED');
  }
  return [...new Set(errors)];
}

function validateResponse(response, bundle, context = {}) {
  const errors = validateReviewResponseSchema(response);
  for (const key of ['task_id', 'iteration', 'target_revision', 'findings']) if (response[key] === undefined) errors.push(`RESPONSE_REQUIRED: ${key}`);
  if (response.task_id !== bundle.task_id || response.iteration !== bundle.iteration || response.target_revision !== bundle.review_revision) errors.push('RESPONSE_BINDING_MISMATCH');
  if (response.target_revision !== bundle.review_revision) errors.push('REVIEW_REVISION_MISMATCH');
  errors.push(...verifyReviewLineage(response, bundle, context));
  for (const finding of response.findings || []) for (const key of ['finding_id', 'severity', 'evidence_path', 'disposition']) if (!finding[key]) errors.push(`FINDING_REQUIRED: ${key}`);
  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

function prepareReview(bundle, context) {
  const result = preflight(bundle, context);
  if (!result.ok) throw new Error(`REVIEW_PREFLIGHT_FAILED: ${result.errors.join(',')}`);
  return result;
}

module.exports = { prepareReview, validateResponse, verifyReviewLineage, loadPreviousReviewRecord };

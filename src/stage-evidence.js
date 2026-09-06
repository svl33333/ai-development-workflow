const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { workingTreeDigest } = require('./artifact-digest');

function repositoryHead(root) {
  return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

function recordPath(root, candidate) {
  const relative = typeof candidate === 'string' ? candidate : candidate?.record_path ?? candidate?.path;
  if (!relative) throw new Error('STAGE_EVIDENCE_RECORD_PATH_REQUIRED');
  const workspaceRoot = path.resolve(root);
  const resolved = path.resolve(workspaceRoot, relative);
  if (resolved === workspaceRoot || !resolved.startsWith(`${workspaceRoot}${path.sep}`)) throw new Error('STAGE_EVIDENCE_PATH_ESCAPE');
  return resolved;
}

function readEvidenceRecord(root, candidate, code) {
  const resolved = recordPath(root, candidate);
  const digest = workingTreeDigest(resolved);
  const expectedDigest = typeof candidate === 'object' ? candidate.artifact_digest : undefined;
  if (expectedDigest && expectedDigest !== digest.value) throw new Error(`${code}_DIGEST_MISMATCH`);
  const record = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (record.artifact_digest && record.artifact_digest !== digest.value) throw new Error(`${code}_DIGEST_MISMATCH`);
  return { path: resolved, digest, record };
}

function reviewRecordCandidates(record) {
  return record.review_records ?? record.review_record_paths ?? [];
}

function verifyPlanReviewRecords(root, record, expectedRevision) {
  const candidates = reviewRecordCandidates(record);
  if (!Array.isArray(candidates) || candidates.length === 0) throw new Error('PLAN_REVIEW_RECORDS_REQUIRED');
  const reviews = candidates.map((candidate) => {
    const loaded = readEvidenceRecord(root, candidate, 'PLAN_REVIEW_RECORD');
    const review = loaded.record;
    const expectedRound = typeof candidate === 'object' ? candidate.round : undefined;
    const expectedVerdict = typeof candidate === 'object' ? candidate.verdict : undefined;
    const expectedPlanDigest = typeof candidate === 'object' ? candidate.plan_digest : undefined;
    if (expectedRound !== undefined && review.round !== expectedRound) throw new Error('PLAN_REVIEW_ROUND_MISMATCH');
    if (expectedVerdict !== undefined && review.verdict !== expectedVerdict) throw new Error('PLAN_REVIEW_VERDICT_MISMATCH');
    if (expectedPlanDigest !== undefined && review.plan_digest !== expectedPlanDigest) throw new Error('PLAN_REVIEW_PLAN_DIGEST_MISMATCH');
    if (review.artifact_digest && review.artifact_digest !== loaded.digest.value) throw new Error('PLAN_REVIEW_RECORD_DIGEST_MISMATCH');
    return { ...review, artifact_digest: loaded.digest.value };
  }).sort((a, b) => a.round - b.round);
  const planDigest = record.plan_digest;
  const qualifying = reviews.filter((review) => review.verdict === 'APPROVE' && review.plan_digest === planDigest);
  const hasConsecutiveRounds = qualifying.some((review, index) => qualifying.slice(index, index + 3).length === 3 && qualifying[index + 1].round === review.round + 1 && qualifying[index + 2].round === review.round + 2);
  if (!hasConsecutiveRounds) throw new Error('PLAN_REVIEW_QUALIFYING_RECORDS_REQUIRED');
  if (reviews.some((review) => review.verdict === 'NEEDS_WORK') && !qualifying.length) throw new Error('PLAN_REVIEW_NEEDS_WORK');
  for (const review of qualifying) if (review.source_revision && review.source_revision !== expectedRevision) throw new Error('PLAN_REVIEW_REVISION_MISMATCH');
  return { reviews, qualifying };
}

function verifyHumanApproval(root, record, expectedRevision, expectedPlanDigest) {
  const candidate = record.human_approval_receipt_path ?? record.human_approval_receipt;
  if (!candidate) throw new Error('PLAN_REVIEW_APPROVAL_RECEIPT_REQUIRED');
  const loaded = readEvidenceRecord(root, candidate, 'PLAN_REVIEW_APPROVAL_RECEIPT');
  const receipt = loaded.record;
  if (receipt.type !== 'human_approval' || receipt.approved_revision !== expectedRevision || receipt.plan_digest !== expectedPlanDigest) throw new Error('PLAN_REVIEW_APPROVAL_RECEIPT_MISMATCH');
  return { ...receipt, artifact_digest: loaded.digest.value };
}

function validatePlanReviewEvidence(root, record, evidence, expected) {
  const revision = expected.repositoryRoot ? repositoryHead(expected.repositoryRoot) : evidence.source_revision;
  if (record.stage !== 'plan_review' || evidence.source_revision !== revision) throw new Error('PLAN_REVIEW_REVISION_MISMATCH');
  const reviews = verifyPlanReviewRecords(root, record, revision);
  verifyHumanApproval(root, record, revision, record.plan_digest);
  return { ...evidence, verified: true, byte_length: workingTreeDigest(recordPath(root, evidence.record_path)).byte_length };
}

function validateStageEvidence(root, stage, evidence, expected = {}) {
  if (!root || !evidence?.record_path) throw new Error(`STAGE_EVIDENCE_REQUIRED:${stage}`);
  const loaded = readEvidenceRecord(root, evidence, 'STAGE_EVIDENCE');
  const record = loaded.record;
  if (record.stage !== stage || record.conversation_role !== evidence.conversation_role) throw new Error(`STAGE_EVIDENCE_BINDING_MISMATCH:${stage}`);
  if (record.source_revision !== evidence.source_revision) throw new Error(`STAGE_EVIDENCE_REVISION_MISMATCH:${stage}`);
  if (expected.repositoryRoot && repositoryHead(expected.repositoryRoot) !== evidence.source_revision) throw new Error(`STAGE_EVIDENCE_HEAD_MISMATCH:${stage}`);
  if (stage === 'plan_review') return validatePlanReviewEvidence(root, record, evidence, expected);
  return { ...evidence, verified: true, byte_length: loaded.digest.byte_length };
}

module.exports = { validateStageEvidence, validatePlanReviewEvidence, verifyPlanReviewRecords, verifyHumanApproval };

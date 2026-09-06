const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { workingTreeDigest } = require('./artifact-digest');

function repositoryHead(root) {
  return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

function validateStageEvidence(root, stage, evidence, expected = {}) {
  if (!root || !evidence?.record_path) throw new Error(`STAGE_EVIDENCE_REQUIRED:${stage}`);
  const workspaceRoot = path.resolve(root);
  const recordPath = path.resolve(workspaceRoot, evidence.record_path);
  if (recordPath !== workspaceRoot && !recordPath.startsWith(`${workspaceRoot}${path.sep}`)) throw new Error('STAGE_EVIDENCE_PATH_ESCAPE');
  const digest = workingTreeDigest(recordPath);
  if (digest.value !== evidence.artifact_digest) throw new Error(`STAGE_EVIDENCE_DIGEST_MISMATCH:${stage}`);
  const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  if (record.stage !== stage || record.conversation_role !== evidence.conversation_role) throw new Error(`STAGE_EVIDENCE_BINDING_MISMATCH:${stage}`);
  if (record.source_revision !== evidence.source_revision) throw new Error(`STAGE_EVIDENCE_REVISION_MISMATCH:${stage}`);
  if (expected.repositoryRoot && repositoryHead(expected.repositoryRoot) !== evidence.source_revision) throw new Error(`STAGE_EVIDENCE_HEAD_MISMATCH:${stage}`);
  if (stage === 'plan_review' && (record.qualifying_rounds < 3 || record.verdict !== 'APPROVE' || record.human_approval !== true || typeof record.plan_digest !== 'string' || record.plan_digest.length === 0)) throw new Error('PLAN_REVIEW_EVIDENCE_INCOMPLETE');
  return { ...evidence, verified: true, byte_length: digest.byte_length };
}

module.exports = { validateStageEvidence };

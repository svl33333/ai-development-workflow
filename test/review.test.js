const test = require('node:test');
const assert = require('node:assert/strict');
const { createReviewBundle } = require('../src/review-bundle');
const { prepareReview, validateResponse } = require('../src/review');
function bundle() { return createReviewBundle({ task_id: 't1', target_revision: 'abcdef1234567', iteration: 1, conversation: { identity: 'c1', role: 'review' }, inputs: [{ path: 'docs/spec.md', hash_basis: 'working_tree_bytes', digest: 'a'.repeat(64) }], allowed_metadata_revision: 'approval-1' }); }
test('review preflight succeeds and response is bound', () => { const b = bundle(); assert.equal(prepareReview(b, { target_revision: b.target_revision, approvalDigest: 'approval-1' }).ok, true); assert.equal(validateResponse({ task_id: 't1', iteration: 1, target_revision: b.target_revision, findings: [{ finding_id: 'F1', severity: 'High', evidence_path: 'x', disposition: 'open' }] }, b).ok, true); });
test('changed bundle fails before send', () => { const b = bundle(); b.inputs[0].path = 'changed'; assert.throws(() => prepareReview(b, { target_revision: b.target_revision }), /BUNDLE_DIGEST_MISMATCH/); });
test('secret and duplicate input fail closed', () => { const b = bundle(); b.secret_token = 'redacted'; b.inputs.push(b.inputs[0]); const result = require('../src/review-preflight').preflight(b, {}); assert.equal(result.ok, false); assert.ok(result.errors.includes('SECRET_DETECTED')); assert.ok(result.errors.includes('DUPLICATE_INPUT_PATH')); });

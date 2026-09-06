const test = require('node:test');
const assert = require('node:assert/strict');
const { initialState, advance } = require('../src/workflow');
const { assertImplementationAllowed } = require('../src/workflow-gates');
test('workflow follows fail-closed transitions', () => { let s = initialState('w', 'rev'); assert.throws(() => advance(s, 'approved'), /INVALID_TRANSITION/); s = advance(s, 'preflighted', { preflight_passed: true }); s = advance(s, 'reviewing'); s = advance(s, 'approved', { plan_approved: true, approved_revision: 'rev' }); assert.doesNotThrow(() => assertImplementationAllowed(s)); });
test('implementation requires approval and same revision', () => { assert.throws(() => assertImplementationAllowed({ plan_approved: false, target_revision: 'a', approved_revision: 'a' }), /PLAN_APPROVAL_REQUIRED/); assert.throws(() => assertImplementationAllowed({ plan_approved: true, target_revision: 'a', approved_revision: 'b' }), /APPROVED_REVISION_MISMATCH/); });

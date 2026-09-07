const { transition, validateState, approvePlan } = require('./model.cjs');
function initialState(workflow_id, target_revision) { return { schema_version: '1.0.0', workflow_id, target_revision, status: 'draft', stage: 'onboarding', evidence: {}, plan_approved: false, preflight_passed: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; }
function advance(state, next, patch = {}) { return transition(state, next, patch); }
module.exports = { initialState, advance, approvePlan, validateState };

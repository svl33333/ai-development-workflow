function requireGate(condition, code) { if (!condition) throw new Error(code); }
function assertImplementationAllowed(state) { requireGate(state.stage === 'implementation', 'IMPLEMENTATION_STAGE_REQUIRED'); requireGate(state.status === 'approved', 'IMPLEMENTATION_STATUS_REQUIRED'); requireGate(state.plan_approved === true, 'PLAN_APPROVAL_REQUIRED'); requireGate(state.target_revision === state.approved_revision, 'APPROVED_REVISION_MISMATCH'); }
function assertExternalWriteAllowed(state) { requireGate(state.status === 'approved', 'APPROVAL_REQUIRED'); requireGate(state.preflight_passed === true, 'PREFLIGHT_REQUIRED'); }
module.exports = { requireGate, assertImplementationAllowed, assertExternalWriteAllowed };

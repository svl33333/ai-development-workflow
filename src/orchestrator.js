const { StateStore } = require('./state-store');
const { initialState, advance } = require('./workflow');
const { advanceStage } = require('./model');
const { assertImplementationAllowed, assertExternalWriteAllowed } = require('./workflow-gates');
function createOrchestrator(root) { const store = new StateStore(root); return { init(id, revision) { const state = initialState(id, revision); store.write(state); return state; }, read: () => store.read(), advance(next, patch = {}) { const current = store.read(); if (next === 'approved') { if (patch.plan_approved !== true || patch.approved_revision !== current.target_revision) throw new Error('PLAN_APPROVAL_REQUIRED'); } if (next === 'completed') assertExternalWriteAllowed({ ...current, ...patch }); const state = advance(current, next, patch); store.write(state); return state; }, advanceStage(nextStage, evidence) { const current = store.read(); const state = advanceStage(current, nextStage, evidence); store.write(state); return state; }, assertImplementationAllowed: () => assertImplementationAllowed(store.read()), assertExternalWriteAllowed: () => assertExternalWriteAllowed(store.read()) }; }
module.exports = { createOrchestrator };

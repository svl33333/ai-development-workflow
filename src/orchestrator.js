const { StateStore } = require('./state-store');
const { initialState, advance } = require('./workflow');
function createOrchestrator(root) { const store = new StateStore(root); return { init(id, revision) { const state = initialState(id, revision); store.write(state); return state; }, read: () => store.read(), advance(next, patch) { const state = advance(store.read(), next, patch); store.write(state); return state; } }; }
module.exports = { createOrchestrator };

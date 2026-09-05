import crypto from 'node:crypto';

export const LIFECYCLE_PROTOCOL_VERSION = 1;
export const EXIT_CODES = Object.freeze({ OK: 0, INVALID_REQUEST: 2, CONFLICT: 3, FAILED: 4 });

export function idempotencyKey(input) {
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export function createLifecycleRequest({ projectId, workId, operation, generation = 1, requestId = null }) {
  if (!projectId || !workId || !operation) throw Object.assign(new Error('projectId, workId and operation are required'), { code: EXIT_CODES.INVALID_REQUEST });
  return { protocol_version: LIFECYCLE_PROTOCOL_VERSION, request_id: requestId ?? crypto.randomUUID(), idempotency_key: idempotencyKey({ projectId, workId, operation, generation }), project_id: projectId, work_id: workId, operation, generation };
}

export function createLifecycleBridge({ invoke }) {
  if (typeof invoke !== 'function') throw new TypeError('invoke must be a function');
  return async (request) => {
    if (request.protocol_version !== LIFECYCLE_PROTOCOL_VERSION) return { ok: false, exit_code: EXIT_CODES.INVALID_REQUEST, error: 'unsupported protocol version' };
    try { return { ok: true, exit_code: EXIT_CODES.OK, ...(await invoke(request)) }; }
    catch (error) { return { ok: false, exit_code: error.code ?? EXIT_CODES.FAILED, error: error.message }; }
  };
}

export async function ensureOrchestrator(store, { orchestratorId = crypto.randomUUID(), generation = null } = {}) {
  const current = await store.state?.() ?? (await store.read()).state;
  if (current.orchestrator_status === 'ACTIVE' && current.orchestrator_id) return { reused: true, orchestrator_id: current.orchestrator_id, generation: current.orchestrator_generation };
  const nextGeneration = generation ?? (current.orchestrator_generation ?? 0) + 1;
  const next = await store.update((state) => ({ ...state, orchestrator_id: orchestratorId, orchestrator_generation: nextGeneration, orchestrator_status: 'ACTIVE' }));
  return { reused: false, orchestrator_id: next.orchestrator_id, generation: next.orchestrator_generation, state: next };
}

export async function supersedeOrchestrator(store, { successorId = crypto.randomUUID() } = {}) {
  const current = await store.read();
  const next = await store.update((state) => ({ ...state, orchestrator_id: successorId, orchestrator_generation: state.orchestrator_generation + 1, orchestrator_status: 'ACTIVE' }));
  return { previous_generation: current.state.orchestrator_generation, generation: next.orchestrator_generation, orchestrator_id: successorId };
}

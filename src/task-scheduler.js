import crypto from 'node:crypto';

const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'BLOCKED', 'CANCELLED']);

export class TaskScheduler {
  constructor({ maxParallel = 3, generation = 1 } = {}) { this.maxParallel = maxParallel; this.generation = generation; this.units = new Map(); }
  load(plan) {
    if (!Number.isInteger(plan.max_parallel_codex_tasks) || plan.max_parallel_codex_tasks < 1) throw new Error('invalid max_parallel_codex_tasks');
    this.maxParallel = plan.max_parallel_codex_tasks;
    const ids = new Set();
    for (const unit of plan.units ?? []) {
      if (ids.has(unit.unit_id)) throw new Error(`duplicate unit: ${unit.unit_id}`);
      ids.add(unit.unit_id); this.units.set(unit.unit_id, { ...unit, status: 'PENDING', run_id: null, generation: this.generation });
    }
    for (const unit of this.units.values()) for (const dep of unit.dependency_ids) if (!ids.has(dep)) throw new Error(`unknown dependency: ${dep}`);
    this.assertAcyclic(); return this.snapshot();
  }
  assertAcyclic() { const visiting = new Set(); const visited = new Set(); const visit = (id) => { if (visiting.has(id)) throw new Error(`dependency cycle: ${id}`); if (visited.has(id)) return; visiting.add(id); for (const dep of this.units.get(id).dependency_ids) visit(dep); visiting.delete(id); visited.add(id); }; for (const id of this.units.keys()) visit(id); }
  activeCount() { return [...this.units.values()].filter((u) => ['STARTING', 'RUNNING', 'INTEGRATING'].includes(u.status)).length; }
  ready() { return [...this.units.values()].filter((u) => u.status === 'PENDING' && u.dependency_ids.every((id) => this.units.get(id).status === 'SUCCEEDED')).slice(0, Math.max(0, this.maxParallel - this.activeCount())); }
  start(unitId, generation = this.generation) { this.assertGeneration(generation); const unit = this.units.get(unitId); if (!unit || unit.status !== 'PENDING' || !this.ready().some((u) => u.unit_id === unitId)) throw new Error(`unit is not ready: ${unitId}`); unit.status = 'STARTING'; unit.run_id = crypto.randomUUID(); unit.generation = generation; unit.status = 'RUNNING'; return { ...unit }; }
  complete(unitId, result, generation = this.generation) { this.assertGeneration(generation); const unit = this.units.get(unitId); if (!unit || unit.status !== 'RUNNING') throw new Error(`unit is not running: ${unitId}`); if (result.status === 'SUCCEEDED' && (!result.local_review || result.local_review.blocking_count !== 0 || result.local_review.disposition !== 'approved')) throw new Error('successful unit requires an approved local review'); unit.status = result.status; unit.result = result; return { ...unit }; }
  cancel(unitId, generation = this.generation) { this.assertGeneration(generation); const unit = this.units.get(unitId); if (!unit || TERMINAL.has(unit.status)) return false; unit.status = 'CANCELLED'; return true; }
  assertGeneration(generation) { if (generation !== this.generation) throw Object.assign(new Error('generation is superseded'), { code: 3 }); }
  activateSuccessor(generation) { if (!Number.isInteger(generation) || generation <= this.generation) throw new Error('successor generation must increase'); this.generation = generation; for (const unit of this.units.values()) if (!TERMINAL.has(unit.status)) unit.status = 'BLOCKED'; return this.snapshot(); }
  snapshot() { return { generation: this.generation, max_parallel_codex_tasks: this.maxParallel, units: [...this.units.values()].map((u) => structuredClone(u)) }; }
}

export function canMigrate(state) {
  const blockers = [];
  if ((state.active_children ?? 0) > 0) blockers.push('active_child');
  if (['STARTING', 'RUNNING', 'INTEGRATING'].includes(state.operation_state)) blockers.push('active_operation');
  if (state.review_incomplete) blockers.push('incomplete_review');
  if (state.pending_approval || state.pending_decision) blockers.push('pending_approval_or_decision');
  if (state.c2c_delivery_ambiguous) blockers.push('ambiguous_c2c_delivery');
  if (state.migration_unresolved || state.change_control_unresolved) blockers.push('unresolved_migration_or_change_control');
  return { ok: blockers.length === 0, blockers };
}

import crypto from 'node:crypto';
import path from 'node:path';

export class ChildTaskRunner {
  constructor({ adapter, worktreeManager, root, generation = 1 } = {}) { this.adapter = adapter; this.worktreeManager = worktreeManager; this.root = root; this.generation = generation; }
  async run(unit, { baseRevision, prompt }) {
    if (this.generation !== unit.generation) throw Object.assign(new Error('generation is superseded'), { code: 3 });
    const runId = unit.run_id ?? crypto.randomUUID();
    const worktree = await this.worktreeManager.create({ unitId: unit.unit_id, runId, baseRevision });
    const capabilities = { cwd: worktree.path, writable_paths: [worktree.path], can_publish: false, can_merge: false, can_modify_parent_state: false };
    const execution = await this.adapter.run({ runId, unit, prompt, capabilities });
    return { unit_id: unit.unit_id, run_id: runId, generation: unit.generation, base_revision: baseRevision, status: execution.status, commit: execution.commit ?? null, tests: execution.tests ?? {}, local_review: execution.local_review ?? { reviewer: 'codex', reviewed_revision: execution.commit ?? '', findings: [], blocking_count: 0, disposition: 'approved' }, artifact_digest: execution.artifact_digest ?? '', worktree: path.relative(this.root, worktree.path).replaceAll('\\', '/') };
  }
}

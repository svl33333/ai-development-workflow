import crypto from 'node:crypto';
import path from 'node:path';

export class ChildTaskRunner {
  constructor({ adapter, worktreeManager, root, generation = 1, allowSyntheticWorktree = false } = {}) { this.adapter = adapter; this.worktreeManager = worktreeManager; this.root = root; this.generation = generation; this.allowSyntheticWorktree = allowSyntheticWorktree; }
  async run(unit, { baseRevision, prompt }) {
    if (this.generation !== unit.generation) throw Object.assign(new Error('generation is superseded'), { code: 3 });
    if (!this.allowSyntheticWorktree && !this.worktreeManager?.git) throw new Error('a real Git worktree adapter is required');
    const runId = unit.run_id ?? crypto.randomUUID();
    const worktree = await this.worktreeManager.create({ unitId: unit.unit_id, runId, baseRevision });
    const capabilities = { cwd: worktree.path, writable_paths: [worktree.path], can_publish: false, can_merge: false, can_modify_parent_state: false };
    const execution = await this.adapter.run({ runId, unit, prompt, capabilities });
    const changedPaths = execution.changed_paths ?? [];
    const scope = unit.change_scope ?? [];
    if (changedPaths.some((changedPath) => !scope.some((allowedPath) => changedPath === allowedPath || changedPath.startsWith(`${allowedPath.replace(/\\\\$/, '')}/`)))) {
      throw new Error(`child task changed files outside its declared scope: ${unit.unit_id}`);
    }
    return { unit_id: unit.unit_id, run_id: runId, generation: unit.generation, base_revision: baseRevision, status: execution.status, commit: execution.commit ?? null, tests: execution.tests ?? {}, local_review: execution.local_review ?? null, artifact_digest: execution.artifact_digest ?? '', worktree: path.relative(this.root, worktree.path).replaceAll('\\', '/') };
  }
}

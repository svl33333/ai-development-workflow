const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { normalizeRelativePath } = require('./artifact-digest');

class WorktreeManager {
  constructor(root, options = {}) {
    this.root = path.resolve(root);
    this.worktreeRoot = options.childRoot ? path.resolve(options.childRoot) : path.join(this.root, '.ai-workflow', 'worktrees');
    this.childRoot = this.worktreeRoot;
    this.git = options.git || null;
    this.parentCwd = fs.realpathSync(root);
    this.records = new Map();
  }
  reserve(taskId, baseRevision, generation = 1) {
    const root = path.resolve(this.childRoot, taskId);
    if (root === this.parentCwd || root.startsWith(`${this.parentCwd}${path.sep}`)) throw new Error('PARENT_CWD_SHARING_FORBIDDEN');
    if ([...this.records.values()].some((r) => r.worktree_root === root)) throw new Error('WORKTREE_COLLISION');
    const record = { schema_version: '1.0.0', lifecycle: 'reserved', task_id: taskId, worktree_root: root, parent_cwd: this.parentCwd, base_revision: baseRevision, generation, branch: `codex/${normalizeRelativePath(taskId)}`, owner: { task_id: taskId, process_id: process.pid } };
    this.records.set(taskId, record);
    return record;
  }
  markCreated(taskId, head) { const r = this.records.get(taskId); if (!r || r.lifecycle !== 'reserved') throw new Error('WORKTREE_NOT_RESERVED'); r.lifecycle = 'created'; r.created_head = head; return r; }
  start(taskId, head) { const r = this.records.get(taskId); if (!r || r.lifecycle !== 'created' || r.created_head !== head) throw new Error('WORKTREE_HEAD_MISMATCH'); r.lifecycle = 'running'; r.started_head = head; return r; }
  finish(taskId, lifecycle, head) { const r = this.records.get(taskId); if (!r || r.lifecycle !== 'running') throw new Error('WORKTREE_NOT_RUNNING'); r.lifecycle = lifecycle; r.finished_head = head; return r; }
  async create({ unitId, runId, baseRevision }) {
    if (!unitId || !runId || !baseRevision) throw new Error('unitId, runId and baseRevision are required');
    const safe = `${unitId}-${runId}`.replace(/[^A-Za-z0-9._-]/g, '-');
    const target = path.join(this.worktreeRoot, safe);
    if (!path.resolve(target).startsWith(`${this.worktreeRoot}${path.sep}`)) throw new Error('worktree escapes configured root');
    await fsp.mkdir(this.worktreeRoot, { recursive: true });
    if (this.git) await this.git.createWorktree({ path: target, revision: baseRevision, branch: `codex/${safe}` });
    else await fsp.mkdir(target, { recursive: true });
    return { path: target, baseRevision, unitId, runId, branch: `codex/${safe}` };
  }
  async remove(worktreePath) {
    const resolved = path.resolve(worktreePath);
    if (!resolved.startsWith(`${this.worktreeRoot}${path.sep}`)) throw new Error('cannot remove worktree outside configured root');
    await fsp.rm(resolved, { recursive: true, force: true });
  }
}
module.exports = { WorktreeManager };

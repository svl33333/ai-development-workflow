import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertLatestMainBase } from './base-sync-guard.cjs';

export class WorktreeManager {
  constructor(root, { git = null, requireLatestMain = true, baseSyncGuard = assertLatestMainBase } = {}) {
    this.root = path.resolve(root);
    this.worktreeRoot = path.join(this.root, '.ai-workflow', 'worktrees');
    this.git = git;
    this.requireLatestMain = requireLatestMain;
    this.baseSyncGuard = baseSyncGuard;
  }
  async create({ unitId, runId, baseRevision }) {
    if (!unitId || !runId || !baseRevision) throw new Error('unitId, runId and baseRevision are required');
    if (this.requireLatestMain && this.git) this.baseSyncGuard(this.root, baseRevision);
    const safe = `${unitId}-${runId}`.replace(/[^A-Za-z0-9._-]/g, '-');
    const target = path.join(this.worktreeRoot, safe);
    if (!path.resolve(target).startsWith(`${this.worktreeRoot}${path.sep}`)) throw new Error('worktree escapes configured root');
    await fs.mkdir(this.worktreeRoot, { recursive: true });
    if (this.git) await this.git.createWorktree({ path: target, revision: baseRevision, branch: `codex/${safe}` });
    else await fs.mkdir(target, { recursive: true });
    return { path: target, baseRevision, unitId, runId, branch: `codex/${safe}` };
  }
  async remove(worktreePath) { const resolved = path.resolve(worktreePath); if (!resolved.startsWith(`${this.worktreeRoot}${path.sep}`)) throw new Error('cannot remove worktree outside configured root'); await fs.rm(resolved, { recursive: true, force: true }); }
}

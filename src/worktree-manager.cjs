const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { normalizeRelativePath } = require('./artifact-digest.cjs');
const { assertLatestMainBase } = require('./base-sync-guard.cjs');

function git(root, args, options = {}) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', ...options }).trim();
}

function processIsAlive(processId) {
  if (!Number.isInteger(processId) || processId <= 0) return false;
  try { process.kill(processId, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

function safeTaskId(taskId) {
  const normalized = normalizeRelativePath(taskId);
  if (!normalized || normalized.startsWith('../') || normalized === '..' || path.isAbsolute(taskId)) throw new Error('TASK_ID_INVALID');
  return normalized;
}

function atomicWrite(filePath, value) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, filePath);
}

class WorktreeManager {
  constructor(parentCwd, childRoot, options = {}) {
    if (childRoot && typeof childRoot === 'object') { options = childRoot; childRoot = path.join(parentCwd, '.ai-workflow', 'worktrees'); }
    this.parentCwd = fs.realpathSync(parentCwd);
    this.childRoot = path.resolve(childRoot);
    this.stateRoot = path.resolve(options.stateRoot ?? path.join(this.childRoot, '.workflow-state'));
    this.recordsRoot = path.join(this.stateRoot, 'worktrees');
    this.locksRoot = path.join(this.stateRoot, 'locks');
    this.parallelFallback = options.parallelFallback ?? 'blocked';
    this.requireLatestMain = options.requireLatestMain ?? true;
    this.baseSyncGuard = options.baseSyncGuard ?? assertLatestMainBase;
    this.records = new Map();
    this.loadRecords();
  }

  branchFor(taskId) { return `codex/${safeTaskId(taskId)}`; }
  recordPath(taskId) { return path.join(this.recordsRoot, `${safeTaskId(taskId).replace(/[\\/]/g, '__')}.json`); }
  lockPath(taskId) { return path.join(this.locksRoot, `${safeTaskId(taskId).replace(/[\\/]/g, '__')}.lock`); }

  loadRecords() {
    if (!fs.existsSync(this.recordsRoot)) return;
    for (const file of fs.readdirSync(this.recordsRoot).filter((name) => name.endsWith('.json'))) {
      const record = JSON.parse(fs.readFileSync(path.join(this.recordsRoot, file), 'utf8'));
      if (record.task_id) this.records.set(record.task_id, record);
    }
  }

  persist(record) {
    fs.mkdirSync(this.recordsRoot, { recursive: true });
    atomicWrite(this.recordPath(record.task_id), record);
    this.records.set(record.task_id, record);
    return record;
  }

  assertChildRootIsSeparate() {
    const child = path.resolve(this.childRoot);
    if (child === this.parentCwd || child.startsWith(`${this.parentCwd}${path.sep}`)) throw new Error('PARENT_CWD_SHARING_FORBIDDEN');
  }

  acquireLock(taskId, owner) {
    fs.mkdirSync(this.locksRoot, { recursive: true });
    const lockPath = this.lockPath(taskId);
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, JSON.stringify(owner));
      fs.closeSync(fd);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let existing;
      try { existing = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch { throw new Error('WORKTREE_LOCKED'); }
      if (existing.process_id !== process.pid || existing.task_id !== taskId) throw new Error('WORKTREE_LOCKED');
    }
    return lockPath;
  }

  releaseLock(record) {
    if (!record.lock_path || !fs.existsSync(record.lock_path)) return;
    let owner;
    try { owner = JSON.parse(fs.readFileSync(record.lock_path, 'utf8')); } catch { throw new Error('WORKTREE_LOCK_CORRUPT'); }
    if (owner.process_id !== process.pid || owner.task_id !== record.task_id) throw new Error('WORKTREE_LOCK_OWNER_MISMATCH');
    fs.unlinkSync(record.lock_path);
  }

  reserve(taskId, baseRevision, generation = 1, options = {}) {
    this.assertChildRootIsSeparate();
    if (this.requireLatestMain) this.baseSyncGuard(this.parentCwd, baseRevision);
    const branch = this.branchFor(taskId);
    const root = path.resolve(this.childRoot, safeTaskId(taskId));
    if (root === this.parentCwd || root.startsWith(`${this.parentCwd}${path.sep}`)) throw new Error('PARENT_CWD_SHARING_FORBIDDEN');
    const existing = this.records.get(taskId);
    if (existing && existing.lifecycle !== 'cleaned') throw new Error('WORKTREE_COLLISION');
    if ([...this.records.values()].some((record) => record.lifecycle !== 'cleaned' && (record.worktree_root === root || record.branch === branch))) throw new Error('WORKTREE_COLLISION');
    try { git(this.parentCwd, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]); throw new Error('BRANCH_COLLISION'); } catch (error) { if (error.message === 'BRANCH_COLLISION') throw error; }
    const conflictKey = options.conflictKey ?? options.parallelConflictKey;
    const conflictingRecords = conflictKey ? [...this.records.values()].filter((record) => record.lifecycle !== 'cleaned' && record.conflict_key === conflictKey) : [];
    const fallback = options.parallelFallback ?? this.parallelFallback;
    if (conflictingRecords.length > 0 && fallback !== 'serial') throw new Error('PARALLEL_CONFLICT');
    const executionMode = conflictingRecords.length > 0 || options.executionMode === 'serial' ? 'serial' : 'parallel';
    const record = { schema_version: '1.0.0', lifecycle: 'reserved', execution_mode: executionMode, parallel_conflict: conflictingRecords.length > 0, serial_after: conflictingRecords.map((item) => item.task_id), conflict_key: conflictKey ?? null, task_id: taskId, worktree_root: root, parent_cwd: this.parentCwd, base_revision: baseRevision, generation, branch, lock_path: this.lockPath(taskId), owner: { task_id: taskId, process_id: process.pid, run_id: options.runId ?? `${process.pid}-${Date.now()}` }, created_at: new Date().toISOString() };
    this.acquireLock(taskId, record.owner);
    return this.persist(record);
  }

  inspect(taskId) {
    const record = this.records.get(taskId);
    if (!record) throw new Error('WORKTREE_NOT_RESERVED');
    const lines = git(this.parentCwd, ['worktree', 'list', '--porcelain']).split(/\r?\n/);
    const index = lines.findIndex((line) => line.startsWith('worktree ') && path.resolve(line.slice('worktree '.length)) === path.resolve(record.worktree_root));
    if (index < 0) throw new Error('WORKTREE_NOT_FOUND');
    return { root: record.worktree_root, head: lines[index + 1]?.replace(/^HEAD /, ''), branch: lines.slice(index, index + 8).find((line) => line.startsWith('branch '))?.replace(/^branch refs\/heads\//, '') ?? null };
  }

  create(taskId) {
    const record = this.records.get(taskId);
    if (!record || record.lifecycle !== 'reserved') throw new Error('WORKTREE_NOT_RESERVED');
    fs.mkdirSync(path.dirname(record.worktree_root), { recursive: true });
    execFileSync('git', ['-C', this.parentCwd, 'worktree', 'add', '-b', record.branch, record.worktree_root, record.base_revision], { stdio: 'pipe' });
    const actual = this.inspect(taskId);
    if (actual.head !== record.base_revision || actual.branch !== record.branch) throw new Error('WORKTREE_BASE_MISMATCH');
    record.lifecycle = 'created';
    record.created_head = actual.head;
    return this.persist(record);
  }

  markCreated(taskId, head, branch = this.records.get(taskId)?.branch) {
    const record = this.records.get(taskId);
    if (!record || record.lifecycle !== 'reserved') throw new Error('WORKTREE_NOT_RESERVED');
    if (branch !== record.branch) throw new Error('WORKTREE_BRANCH_MISMATCH');
    record.lifecycle = 'created';
    record.created_head = head;
    return this.persist(record);
  }

  start(taskId, expected = {}, expectedGeneration) {
    const record = this.records.get(taskId);
    const expectedHead = typeof expected === 'string' ? expected : expected.head;
    const generation = typeof expected === 'string' ? (expectedGeneration ?? record?.generation) : (expected.generation ?? expectedGeneration ?? record?.generation);
    if (!record || record.lifecycle !== 'created' || record.created_head !== expectedHead || record.generation !== generation) throw new Error('WORKTREE_HEAD_OR_GENERATION_MISMATCH');
    const actual = this.inspect(taskId);
    if (actual.head !== expectedHead) throw new Error('WORKTREE_HEAD_MISMATCH');
    if (actual.branch !== record.branch) throw new Error('WORKTREE_BRANCH_MISMATCH');
    record.lifecycle = 'running';
    record.started_head = actual.head;
    return this.persist(record);
  }

  finish(taskId, lifecycle, head) {
    const record = this.records.get(taskId);
    if (!record || record.lifecycle !== 'running') throw new Error('WORKTREE_NOT_RUNNING');
    const actual = this.inspect(taskId);
    if (actual.head !== head) throw new Error('WORKTREE_FINISH_HEAD_MISMATCH');
    if (!['completed', 'failed', 'abandoned'].includes(lifecycle)) throw new Error('WORKTREE_LIFECYCLE_INVALID');
    record.lifecycle = lifecycle;
    record.finished_head = actual.head;
    record.finished_at = new Date().toISOString();
    return this.persist(record);
  }

  recover(taskId) {
    const record = this.records.get(taskId);
    if (!record) throw new Error('WORKTREE_NOT_RESERVED');
    if (record.owner.process_id !== process.pid && processIsAlive(record.owner.process_id)) throw new Error('WORKTREE_OWNER_ALIVE');
    if (record.lifecycle === 'cleaned') return record;
    if (record.lock_path && fs.existsSync(record.lock_path)) fs.unlinkSync(record.lock_path);
    record.lifecycle = 'abandoned';
    let actual;
    try { actual = this.inspect(taskId); } catch { return this.persist(record); }
    const dirty = git(actual.root, ['status', '--porcelain']);
    if (!dirty && actual.branch === record.branch && actual.head === (record.started_head ?? record.created_head)) {
      record.generation += 1;
      record.owner = { task_id: taskId, process_id: process.pid, run_id: `${process.pid}-${Date.now()}` };
      record.lock_path = this.acquireLock(taskId, record.owner);
      record.lifecycle = 'created';
      record.created_head = actual.head;
    }
    return this.persist(record);
  }

  cleanup(taskId) {
    const record = this.records.get(taskId);
    if (!record) throw new Error('WORKTREE_NOT_RESERVED');
    if (record.lifecycle === 'running') throw new Error('WORKTREE_CLEANUP_WHILE_RUNNING');
    try { execFileSync('git', ['-C', this.parentCwd, 'worktree', 'remove', '--force', record.worktree_root], { stdio: 'pipe' }); } catch (error) { if (fs.existsSync(record.worktree_root)) { record.cleanup_error = error.message; return this.persist(record); } }
    try { execFileSync('git', ['-C', this.parentCwd, 'branch', '-D', record.branch], { stdio: 'pipe' }); } catch { /* branch may already be removed during recovery */ }
    this.releaseLock(record);
    record.lifecycle = 'cleaned';
    record.cleaned_at = new Date().toISOString();
    return this.persist(record);
  }
}

module.exports = { WorktreeManager, processIsAlive };

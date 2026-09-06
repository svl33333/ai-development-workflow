class TaskScheduler {
  constructor(options = {}) {
    this.parallelFallback = options.parallelFallback ?? 'blocked';
    this.active = new Map();
  }

  start(taskId, worktree, options = {}) {
    if (!worktree || worktree.parent_cwd === worktree.worktree_root) throw new Error('PARENT_CWD_SHARING_FORBIDDEN');
    if (this.active.has(taskId)) throw new Error('TASK_ALREADY_RUNNING');
    const executionMode = worktree.execution_mode ?? 'parallel';
    const fallback = options.parallelFallback ?? this.parallelFallback;
    if (executionMode === 'serial' && fallback !== 'serial') throw new Error('SERIAL_FALLBACK_NOT_ENABLED');
    if (executionMode === 'serial' && this.active.size > 0) throw new Error('SERIAL_FALLBACK_WAITING');
    if (executionMode !== 'serial' && worktree.parallel_conflict && fallback !== 'serial') throw new Error('PARALLEL_EXECUTION_BLOCKED');
    if (worktree.lifecycle && worktree.lifecycle !== 'running') throw new Error('WORKTREE_NOT_RUNNING');
    const result = { task_id: taskId, worktree_root: worktree.worktree_root, status: 'RUNNING', execution_mode: executionMode };
    this.active.set(taskId, result);
    return result;
  }

  complete(taskId) {
    if (!this.active.has(taskId)) throw new Error('TASK_NOT_RUNNING');
    this.active.delete(taskId);
    return { task_id: taskId, status: 'COMPLETED' };
  }
}

module.exports = { TaskScheduler };

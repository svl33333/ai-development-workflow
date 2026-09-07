class ChildTaskRunner { constructor(launcher = () => { throw new Error('CHILD_LAUNCH_NOT_CONFIGURED'); }) { this.launcher = launcher; this.calls = 0; } run(task, worktree) { if (!worktree || worktree.lifecycle !== 'running') throw new Error('WORKTREE_REQUIRED'); this.calls += 1; return this.launcher(task, worktree); } }
module.exports = { ChildTaskRunner };

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { WorktreeManager } = require('../src/worktree-manager');
const { TaskScheduler } = require('../src/task-scheduler');

function git(root, args) { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim(); }
function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-repo-'));
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  execFileSync('git', ['init', '-q', root]);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['add', 'seed.txt']);
  git(root, ['commit', '-qm', 'seed']);
  return { root, revision: git(root, ['rev-parse', 'HEAD']), childRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-children-')) };
}

test('worktree lifecycle uses a named branch, durable lock, and matching head/generation', () => {
  const fixture = repository();
  const manager = new WorktreeManager(fixture.root, fixture.childRoot);
  const reserved = manager.reserve('child-1', fixture.revision, 4);
  assert.equal(reserved.branch, 'codex/child-1');
  assert.ok(fs.existsSync(reserved.lock_path));
  assert.equal(manager.create('child-1').lifecycle, 'created');
  assert.throws(() => manager.start('child-1', { head: fixture.revision, generation: 3 }), /WORKTREE_HEAD_OR_GENERATION_MISMATCH/);
  const running = manager.start('child-1', { head: fixture.revision, generation: 4 });
  assert.equal(running.lifecycle, 'running');
  assert.equal(manager.finish('child-1', 'completed', fixture.revision).lifecycle, 'completed');
  assert.equal(manager.cleanup('child-1').lifecycle, 'cleaned');
  assert.equal(fs.existsSync(reserved.lock_path), false);
  assert.throws(() => execFileSync('git', ['-C', fixture.root, 'show-ref', '--verify', 'refs/heads/codex/child-1'], { stdio: 'ignore' }), /Command failed/);
});

test('restart recovery reclaims a dead owner only when the worktree is clean and unchanged', () => {
  const fixture = repository();
  const manager = new WorktreeManager(fixture.root, fixture.childRoot);
  const reserved = manager.reserve('recoverable', fixture.revision);
  manager.create('recoverable');
  manager.start('recoverable', fixture.revision);
  const persisted = JSON.parse(fs.readFileSync(manager.recordPath('recoverable'), 'utf8'));
  persisted.owner.process_id = 999999;
  fs.writeFileSync(manager.recordPath('recoverable'), JSON.stringify(persisted));
  const restarted = new WorktreeManager(fixture.root, fixture.childRoot);
  const recovered = restarted.recover('recoverable');
  assert.equal(recovered.lifecycle, 'created');
  assert.equal(recovered.generation, 2);
  assert.equal(restarted.cleanup('recoverable').lifecycle, 'cleaned');
  assert.equal(fs.existsSync(reserved.lock_path), false);
});

test('parent cwd sharing and duplicate durable reservations are rejected', () => {
  assert.throws(() => new WorktreeManager(process.cwd(), process.cwd()).reserve('x', 'base'), /PARENT_CWD_SHARING_FORBIDDEN/);
  const fixture = repository();
  const first = new WorktreeManager(fixture.root, fixture.childRoot);
  first.reserve('same', fixture.revision);
  const second = new WorktreeManager(fixture.root, fixture.childRoot);
  assert.throws(() => second.reserve('same', fixture.revision), /WORKTREE_COLLISION/);
});

test('serial fallback is explicit and never overlaps active tasks', () => {
  const scheduler = new TaskScheduler({ parallelFallback: 'serial' });
  const serial = { parent_cwd: 'parent', worktree_root: 'child', lifecycle: 'running', execution_mode: 'serial' };
  assert.equal(scheduler.start('one', serial).execution_mode, 'serial');
  assert.throws(() => scheduler.start('two', serial), /SERIAL_FALLBACK_WAITING/);
  scheduler.complete('one');
  assert.equal(scheduler.start('two', serial).status, 'RUNNING');
});

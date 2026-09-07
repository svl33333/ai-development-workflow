const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function git(root, args, options = {}) {
  return spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', ...options });
}

function materializeTrackedCheckout(sourceRoot, checkoutRoot) {
  const archive = git(sourceRoot, ['archive', '--format=tar', 'HEAD'], { maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' });
  assert.equal(archive.status, 0, `git archive failed: ${archive.stderr}`);
  const extraction = spawnSync('tar', ['-xf', '-', '-C', checkoutRoot], { input: archive.stdout, encoding: 'utf8' });
  assert.equal(extraction.status, 0, `tar extraction failed: ${extraction.stderr}`);
}

function runNpm(args, options = {}) {
  if (process.platform === 'win32') return spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm.cmd ${args.join(' ')}`], options);
  return spawnSync('npm', args, options);
}

function versionParts(command, args = ['--version']) {
  const result = command === 'npm' ? runNpm(args, { encoding: 'utf8' }) : spawnSync(command, args, { encoding: 'utf8' });
  assert.equal(result.status, 0, `${command} version failed: ${result.stderr}`);
  return (result.stdout || result.stderr).match(/(\d+)\.(\d+)(?:\.(\d+))?/).slice(1).map(Number);
}

test('bootstrap runtime meets Issue #10 minimums', () => {
  assert.ok(Number(process.versions.node.split('.')[0]) >= 24);
  assert.ok(versionParts('npm')[0] >= 11);
  const [gitMajor, gitMinor] = versionParts('git');
  assert.ok(gitMajor > 2 || (gitMajor === 2 && gitMinor >= 40));
});

test('isolated clean checkout runs npm ci, all tests, and fixture validation', { skip: process.env.WORKFLOW_CLEAN_CHECKOUT_CHILD === '1' }, () => {
  const sourceRoot = path.resolve(__dirname, '..');
  const checkoutRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-10-clean-checkout-'));
  materializeTrackedCheckout(sourceRoot, checkoutRoot);
  const environment = { ...process.env, WORKFLOW_CLEAN_CHECKOUT_CHILD: '1' };
  for (const args of [['ci'], ['test'], ['run', 'validate:fixtures']]) {
    const result = runNpm(args, { cwd: checkoutRoot, env: environment, encoding: 'utf8', timeout: 120000 });
    assert.equal(result.status, 0, `npm ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  }
});

test('tracked-only clean checkout excludes untracked and ignored files', () => {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracked-only-source-'));
  const checkoutRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tracked-only-checkout-'));
  fs.writeFileSync(path.join(sourceRoot, 'tracked.txt'), 'tracked');
  fs.writeFileSync(path.join(sourceRoot, '.gitignore'), 'ignored.txt\n');
  assert.equal(git(sourceRoot, ['init', '-q']).status, 0);
  assert.equal(git(sourceRoot, ['config', 'user.email', 'test@example.com']).status, 0);
  assert.equal(git(sourceRoot, ['config', 'user.name', 'Test']).status, 0);
  assert.equal(git(sourceRoot, ['add', 'tracked.txt', '.gitignore']).status, 0);
  assert.equal(git(sourceRoot, ['commit', '-qm', 'tracked']).status, 0);
  fs.writeFileSync(path.join(sourceRoot, 'untracked.txt'), 'untracked');
  fs.writeFileSync(path.join(sourceRoot, 'ignored.txt'), 'ignored');
  materializeTrackedCheckout(sourceRoot, checkoutRoot);
  assert.equal(fs.existsSync(path.join(checkoutRoot, 'tracked.txt')), true);
  assert.equal(fs.existsSync(path.join(checkoutRoot, 'untracked.txt')), false);
  assert.equal(fs.existsSync(path.join(checkoutRoot, 'ignored.txt')), false);
});

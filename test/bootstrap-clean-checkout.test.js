const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

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
  fs.cpSync(sourceRoot, checkoutRoot, { recursive: true, filter: (source) => !source.includes(`${path.sep}.git`) && !source.includes(`${path.sep}node_modules`) && !source.includes(`${path.sep}.workflow-state`) });
  const environment = { ...process.env, WORKFLOW_CLEAN_CHECKOUT_CHILD: '1' };
  for (const args of [['ci'], ['test'], ['run', 'validate:fixtures']]) {
    const result = runNpm(args, { cwd: checkoutRoot, env: environment, encoding: 'utf8', timeout: 120000 });
    assert.equal(result.status, 0, `npm ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  }
});

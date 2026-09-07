const { execFileSync } = require('node:child_process');

function git(root, args) { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }

function assertLatestMainBase(repositoryRoot, baseRevision, runGit = git) {
  if (!repositoryRoot || !baseRevision) throw new Error('BASE_SYNC_IDENTITY_REQUIRED');
  try {
    runGit(repositoryRoot, ['fetch', 'origin']);
    const latestMain = runGit(repositoryRoot, ['rev-parse', 'origin/main']);
    runGit(repositoryRoot, ['merge-base', '--is-ancestor', latestMain, baseRevision]);
    return { latestMain, baseRevision, synchronized: true };
  } catch (error) {
    throw new Error(`BASE_SYNC_REQUIRED: fetch origin, create a new worktree/branch from latest main, or rebase the existing branch before implementation (${error.message})`);
  }
}

module.exports = { assertLatestMainBase };

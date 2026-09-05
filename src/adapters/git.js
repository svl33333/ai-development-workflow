export function createGitAdapter({ exec = async () => ({ exitCode: 0, output: '' }) } = {}) {
  return {
    async currentRevision() { const result = await exec(['rev-parse', 'HEAD']); if (result.exitCode !== 0) throw new Error('unable to read HEAD'); return result.output.trim(); },
    async createWorktree({ path, revision, branch = null }) { const args = branch ? ['worktree', 'add', '-b', branch, path, revision] : ['worktree', 'add', '--detach', path, revision]; const result = await exec(args); if (result.exitCode !== 0) throw new Error(result.output || 'unable to create worktree'); return path; },
    async diff({ baseRevision, cwd = null }) { const prefix = cwd ? ['-C', cwd] : []; const result = await exec([...prefix, 'diff', '--no-ext-diff', `${baseRevision}...HEAD`]); if (result.exitCode !== 0) throw new Error(result.output || 'unable to read diff'); return result.output; },
    async changedPaths({ baseRevision, cwd = null }) { const prefix = cwd ? ['-C', cwd] : []; const result = await exec([...prefix, 'diff', '--name-only', `${baseRevision}...HEAD`]); if (result.exitCode !== 0) throw new Error(result.output || 'unable to read changed paths'); return result.output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean); }
  };
}

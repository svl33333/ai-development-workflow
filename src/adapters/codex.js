export function createCodexAdapter({ exec = async () => ({ exitCode: 0, output: '' }) } = {}) {
  return { run: exec, canWrite: true, canPublish: true };
}

export function createIssueGateway({ prepare, publish } = {}) {
  if (typeof prepare !== 'function' || typeof publish !== 'function') throw new Error('Issue gateway requires Python guard prepare/publish operations');
  return { async createIssue(input) { const prepared = await prepare(input); if (!prepared?.ready_to_publish || !prepared.payload_hash) throw new Error('Issue #4 guard did not authorize publication'); const result = await publish({ ...input, payload_hash: prepared.payload_hash }); if (!result?.number) throw new Error('Issue gateway returned no Issue identity'); return result; } };
}

function validateMetadata(metadata) {
  if (!metadata?.repository || !metadata.expires_at || !Array.isArray(metadata.permissions)) throw new Error('credential metadata is incomplete');
  if (Number.isNaN(Date.parse(metadata.expires_at))) throw new Error('credential expiry is invalid');
}

export function createCredentialStore(vault) {
  if (!vault?.writeSecret || !vault?.readSecret || !vault?.removeSecret) throw new Error('an OS-backed credential vault is required');
  return {
    async registerCredential({ key, secret, metadata }) { if (!key || !secret) throw new Error('credential key and secret are required'); validateMetadata(metadata); await vault.writeSecret(key, secret, metadata); return { key, metadata }; },
    async loadCredential(key) { const credential = await vault.readSecret(key); if (!credential) throw new Error('credential is unavailable'); validateMetadata(credential.metadata); return credential; },
    async removeCredential(key) { await vault.removeSecret(key); }
  };
}

export function createMemoryCredentialVault() {
  const secrets = new Map();
  return { async writeSecret(key, secret, metadata) { secrets.set(key, { secret, metadata }); }, async readSecret(key) { return secrets.get(key) ?? null; }, async removeSecret(key) { secrets.delete(key); } };
}

class GithubAdapter {
  constructor(client = {}) { this.client = client; this.calls = []; }
  async mutate(operation, payload) { this.calls.push({ operation, payload }); if (!this.client[operation]) throw Object.assign(new Error('AUTH_REQUIRED'), { code: 'AUTH_REQUIRED' }); return this.client[operation](payload); }
}
module.exports = { GithubAdapter };

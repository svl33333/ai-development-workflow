class ChatGPTC2CAdapter {
  constructor(client = {}) { this.client = client; this.sent = []; }
  async send(request) { this.sent.push(request); if (!this.client.send) throw Object.assign(new Error('CONNECTION_REQUIRED'), { code: 'CONNECTION_REQUIRED' }); return this.client.send(request); }
}
module.exports = { ChatGPTC2CAdapter };

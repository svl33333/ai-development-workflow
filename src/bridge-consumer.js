import fs from 'node:fs/promises';
import path from 'node:path';

export async function consumeBridgeEvents(root, handlers = {}) {
  const eventPath = path.join(root, '.ai-workflow', 'bridge-events.jsonl');
  let lines; try { lines = (await fs.readFile(eventPath, 'utf8')).split('\n').filter(Boolean); } catch (error) { if (error.code === 'ENOENT') return { consumed: 0 }; throw error; }
  const ackPath = `${eventPath}.ack`; const acknowledged = new Set(); try { for (const line of (await fs.readFile(ackPath, 'utf8')).split('\n').filter(Boolean)) acknowledged.add(JSON.parse(line).idempotency_key); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let consumed = 0; for (const line of lines) { const event = JSON.parse(line); if (acknowledged.has(event.idempotency_key)) continue; const handler = handlers[event.operation]; if (typeof handler !== 'function') throw new Error(`no bridge handler for ${event.operation}`); await handler(event); await fs.appendFile(ackPath, `${JSON.stringify({ idempotency_key: event.idempotency_key, completed_at: new Date().toISOString() })}\n`); consumed += 1; }
  return { consumed, ack_path: ackPath };
}

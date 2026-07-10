#!/usr/bin/env node
// Ack Stop events for the hello-veylin example plugin.
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const raw = Buffer.concat(chunks).toString('utf8');
try {
  JSON.parse(raw || '{}');
} catch {
  /* ignore */
}
process.stdout.write(
  JSON.stringify({
    additionalContext: 'hello-veylin: Stop hook acknowledged.',
  }),
);

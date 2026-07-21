#!/usr/bin/env node
/**
 * stdio ↔ streamable-HTTP MCP bridge.
 *
 * Veylin's plugin MCP runtime is stdio-only, while Compass exposes its tool
 * catalog over streamable HTTP (with OBO bearer auth). This bridge lets the
 * plugin declare a local stdio server that transparently forwards every
 * JSON-RPC message to the remote endpoint.
 *
 *   env COMPASS_MCP_URL    remote MCP endpoint (default: public Compass ingress)
 *   env COMPASS_MCP_TOKEN  bearer token — a Compass PROJECT token; the token IS
 *                          the project/tenant binding, so switching projects
 *                          means swapping this value, never an agent-side call.
 *
 * Zero dependencies (Node >= 18: built-in fetch). Forward-compatible: when
 * Veylin supports remote MCP entries natively, delete this file and switch
 * .mcp.json to a url entry.
 */
'use strict';

const ENDPOINT = process.env.COMPASS_MCP_URL || 'https://mcp.compass-work.com/mcp/';
const TOKEN = (process.env.COMPASS_MCP_TOKEN || '').trim();

/** Session id from the remote (captured on first response, replayed after).
 * Compass itself is stateless_http, but replaying keeps the bridge correct
 * against stateful streamable-HTTP servers too. */
let sessionId = null;

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function rpcError(id, code, message) {
  emit({ jsonrpc: '2.0', id, error: { code, message } });
}

/** Parse a text/event-stream body: JSON.parse every `data:` line, in order. */
function parseSse(text) {
  const out = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.startsWith('data:')) continue;
    const payload = rawLine.slice(5).trim();
    if (!payload) continue;
    try {
      out.push(JSON.parse(payload));
    } catch {
      // non-JSON data event (e.g. keep-alive) — ignore
    }
  }
  return out;
}

async function forward(msg) {
  const isNotification = msg.id === undefined || msg.id === null;
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;
  if (sessionId) headers['mcp-session-id'] = sessionId;

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(msg),
    });
  } catch (err) {
    if (!isNotification) {
      rpcError(msg.id, -32001, `compass bridge: cannot reach ${ENDPOINT}: ${err.message}`);
    }
    return;
  }

  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;

  if (!res.ok) {
    // Drain the body either way so the connection can be reused.
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    if (!isNotification) {
      const hint =
        res.status === 401
          ? ' — check COMPASS_MCP_TOKEN (expired/revoked project token?)'
          : '';
      rpcError(msg.id, -32001, `compass bridge: HTTP ${res.status}${hint} ${detail}`.trim());
    }
    return;
  }

  const contentType = res.headers.get('content-type') || '';
  const body = await res.text();
  if (isNotification) return; // 202-style ack; nothing to write back

  if (contentType.includes('text/event-stream')) {
    for (const event of parseSse(body)) emit(event);
    return;
  }
  if (body.trim()) {
    try {
      emit(JSON.parse(body));
    } catch {
      rpcError(msg.id, -32001, 'compass bridge: remote returned non-JSON body');
    }
  }
}

// --- stdin: newline-delimited JSON-RPC (MCP stdio transport) ---
// The FIRST message (initialize) completes before any later message is sent,
// so the remote's mcp-session-id is captured before it must be replayed.
// After that, messages forward concurrently (parallel tool calls stay parallel).
let firstForward = null;
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue; // not JSON — ignore, per stdio transport tolerance
    }
    if (firstForward === null) {
      firstForward = forward(msg).catch(() => {});
    } else {
      void firstForward.then(() => forward(msg));
    }
  }
});
process.stdin.on('end', () => process.exit(0));

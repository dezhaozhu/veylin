'use strict';
/** Bridge unit tests: spawn bridge.cjs against a mock streamable-HTTP server.
 * Run: node --test examples/marketplace/compass-scheduler/mcp/bridge.test.cjs */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');

const BRIDGE = path.join(__dirname, 'bridge.cjs');

function startMock(handler) {
  return new Promise((resolve) => {
    const requests = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const record = { headers: req.headers, body: body ? JSON.parse(body) : null };
        requests.push(record);
        handler(record, res);
      });
    });
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, requests, url: `http://127.0.0.1:${server.address().port}/mcp/` }),
    );
  });
}

function runBridge(url, token, lines, { expectOutputs = 1, timeoutMs = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BRIDGE], {
      env: { ...process.env, COMPASS_MCP_URL: url, COMPASS_MCP_TOKEN: token },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    const outputs = [];
    let out = '';
    const timer = setTimeout(() => {
      child.kill();
      // resolve with what we have — tests assert on counts explicitly
      resolve(outputs);
    }, timeoutMs);
    child.stdout.on('data', (c) => {
      out += c;
      let idx;
      while ((idx = out.indexOf('\n')) !== -1) {
        const line = out.slice(0, idx).trim();
        out = out.slice(idx + 1);
        if (line) outputs.push(JSON.parse(line));
      }
      if (outputs.length >= expectOutputs) {
        clearTimeout(timer);
        child.kill();
        resolve(outputs);
      }
    });
    child.on('error', reject);
    for (const l of lines) child.stdin.write(JSON.stringify(l) + '\n');
  });
}

test('forwards request with Bearer and returns plain-JSON response', async () => {
  const { server, requests, url } = await startMock((record, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ jsonrpc: '2.0', id: record.body.id, result: { ok: true } }));
  });
  try {
    const outputs = await runBridge(url, 'tok-123', [
      { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    ]);
    assert.equal(outputs.length, 1);
    assert.deepEqual(outputs[0].result, { ok: true });
    assert.equal(requests[0].headers.authorization, 'Bearer tok-123');
    assert.match(requests[0].headers.accept, /text\/event-stream/);
  } finally {
    server.close();
  }
});

test('parses SSE response bodies', async () => {
  const { server, url } = await startMock((record, res) => {
    res.setHeader('content-type', 'text/event-stream');
    res.end(
      `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: record.body.id, result: { via: 'sse' } })}\n\n`,
    );
  });
  try {
    const outputs = await runBridge(url, 't', [
      { jsonrpc: '2.0', id: 7, method: 'initialize', params: {} },
    ]);
    assert.equal(outputs.length, 1);
    assert.deepEqual(outputs[0].result, { via: 'sse' });
    assert.equal(outputs[0].id, 7);
  } finally {
    server.close();
  }
});

test('captures mcp-session-id and replays it on later requests', async () => {
  const { server, requests, url } = await startMock((record, res) => {
    res.setHeader('mcp-session-id', 'sess-42');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ jsonrpc: '2.0', id: record.body.id, result: {} }));
  });
  try {
    await runBridge(
      url,
      't',
      [
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      ],
      { expectOutputs: 2 },
    );
    assert.equal(requests.length, 2);
    assert.equal(requests[0].headers['mcp-session-id'], undefined);
    assert.equal(requests[1].headers['mcp-session-id'], 'sess-42');
  } finally {
    server.close();
  }
});

test('notifications (no id) are forwarded but produce no stdout', async () => {
  const { server, requests, url } = await startMock((record, res) => {
    if (record.body.id === undefined) {
      res.statusCode = 202;
      res.end();
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ jsonrpc: '2.0', id: record.body.id, result: {} }));
  });
  try {
    const outputs = await runBridge(
      url,
      't',
      [
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} },
      ],
      { expectOutputs: 1 },
    );
    // only the request got a reply; the notification produced none
    assert.equal(outputs.length, 1);
    assert.equal(outputs[0].id, 3);
    assert.equal(requests.length, 2);
  } finally {
    server.close();
  }
});

test('HTTP 401 maps to a JSON-RPC error mentioning the token', async () => {
  const { server, url } = await startMock((_record, res) => {
    res.statusCode = 401;
    res.end('unauthorized');
  });
  try {
    const outputs = await runBridge(url, 'stale', [
      { jsonrpc: '2.0', id: 9, method: 'tools/list', params: {} },
    ]);
    assert.equal(outputs.length, 1);
    assert.equal(outputs[0].id, 9);
    assert.match(outputs[0].error.message, /401/);
    assert.match(outputs[0].error.message, /COMPASS_MCP_TOKEN/);
  } finally {
    server.close();
  }
});

test('unreachable endpoint maps to a JSON-RPC error, no crash', async () => {
  const outputs = await runBridge('http://127.0.0.1:1/mcp/', 't', [
    { jsonrpc: '2.0', id: 11, method: 'tools/list', params: {} },
  ]);
  assert.equal(outputs.length, 1);
  assert.equal(outputs[0].id, 11);
  assert.match(outputs[0].error.message, /cannot reach/);
});

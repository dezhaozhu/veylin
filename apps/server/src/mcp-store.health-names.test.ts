/**
 * 健康快照该拿谁当"应该连上的服务"。
 *
 * Compass 身份条目只经 compass-pool 按需连接,通用客户端(buildMcpServerConfigs)
 * 故意跳过它。以前健康快照用 listActiveMcpServerNames 当期望集合,Compass 于是
 * 永远"未连接":设置页挂着连接失败横幅,自愈循环每 30s–5min 重建一次,每次都
 * invalidateCompassPool,把正在用的 Compass 连接断掉。
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { closeDb, connectDb } from '@veylin/db';
import { COMPASS_IDENTITY_GROUP } from './compass-identity.js';
import { buildMcpHealthSnapshot } from './mcp-health.js';
import {
  createRemoteMcpServer,
  listActiveMcpServerNames,
  listGenericClientMcpServerNames,
} from './mcp-store.js';
import { DEV_TENANT_ID, ensureDevTenant } from './tenant.js';

const TENANT = DEV_TENANT_ID;

describe('mcp-store generic-client server names', () => {
  before(async () => {
    await connectDb();
    await ensureDevTenant();
  });

  after(async () => {
    await closeDb();
  });

  it('excludes compass-identity entries but keeps them active for chat', async () => {
    const stamp = Date.now();
    const compass = await createRemoteMcpServer(TENANT, {
      name: `compass-${stamp}`,
      transport: 'http',
      url: 'http://127.0.0.1:8001/mcp/',
      headers: {},
      enabled: true,
      managed: true,
      group: COMPASS_IDENTITY_GROUP,
    });
    const plain = await createRemoteMcpServer(TENANT, {
      name: `plain-${stamp}`,
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: {},
      enabled: true,
    });

    const active = await listActiveMcpServerNames(TENANT);
    assert.ok(active.includes(compass.name), 'compass must stay active (chat/pinning use it)');

    const generic = await listGenericClientMcpServerNames(TENANT);
    assert.ok(generic.includes(plain.name));
    assert.ok(!generic.includes(compass.name));

    // 通用客户端连不到 Compass 是设计如此,不该算断开。
    const health = buildMcpHealthSnapshot(generic, { [plain.name]: {} });
    assert.ok(!health.servers.some((s) => s.name === compass.name));
  });
});

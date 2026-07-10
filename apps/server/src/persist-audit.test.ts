/**
 * Boot sweeps + touchAutomationLastRun for non-cron automations.
 * Uses the process SurrealDB (same pattern as table-persist.test).
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  closeDb,
  connectDb,
  getAutomationRow,
  getDocument,
  insertAutomationRun,
  insertDocument,
  updateAutomationRunRow,
  updateDocumentStatus,
} from '@veylin/db';
import {
  createAutomation,
  getAutomation,
  listAutomationRuns,
  sweepInterruptedAutomationRuns,
  touchAutomationLastRun,
} from './automation-store.js';
import { sweepInterruptedRagIngests } from './rag-store.js';
import { ensureDevTenant, DEV_TENANT_ID } from './tenant.js';

const TENANT = DEV_TENANT_ID;
const USER = 'dev-user';

describe('persist audit sweeps', () => {
  before(async () => {
    await connectDb();
    await ensureDevTenant();
  });

  after(async () => {
    await closeDb();
  });

  it('marks indexing documents as failed', async () => {
    const doc = await insertDocument(TENANT, { filename: `sweep-${Date.now()}.txt` });
    await updateDocumentStatus(doc.id, 'indexing');

    const n = await sweepInterruptedRagIngests();
    assert.ok(n >= 1);

    const after = await getDocument(doc.id);
    assert.equal(after?.status, 'failed');
    assert.match(after?.error ?? '', /interrupted/i);
  });

  it('marks incomplete automation runs as failed', async () => {
    const auto = await createAutomation(TENANT, USER, {
      name: `sweep-auto-${Date.now()}`,
      kind: 'event',
      agentId: 'default',
      prompt: 'noop',
      enabled: true,
      timezone: 'UTC',
      sourceType: 'github',
      eventOn: ['issues.opened'],
    });
    const run = await insertAutomationRun(auto.id, TENANT, `thread-${Date.now()}`);
    await updateAutomationRunRow(run.id, { status: 'running' });

    const n = await sweepInterruptedAutomationRuns();
    assert.ok(n >= 1);

    const runs = await listAutomationRuns(TENANT, auto.id);
    const hit = runs.find((r) => r.id === run.id);
    assert.equal(hit?.status, 'failed');
    assert.match(hit?.result ?? '', /interrupted/i);
  });

  it('updates lastRunAt for non-cron automations', async () => {
    const auto = await createAutomation(TENANT, USER, {
      name: `touch-auto-${Date.now()}`,
      kind: 'event',
      agentId: 'default',
      prompt: 'noop',
      enabled: true,
      timezone: 'UTC',
      sourceType: 'github',
      eventOn: ['push'],
    });
    assert.equal(auto.lastRunAt, null);

    await touchAutomationLastRun(TENANT, auto.id);

    const after = await getAutomation(TENANT, auto.id);
    assert.ok(after?.lastRunAt);
    const row = await getAutomationRow(TENANT, auto.id);
    assert.ok(row?.lastRunAt);
  });
});

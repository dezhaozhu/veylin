import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPersonalOrgDirectoryPort } from './personal-tenant.js';

describe('OrgDirectory RBAC tool filter', () => {
  it('returns null (allow all) when VEYLIN_RBAC_FILTER_TOOLS is unset', () => {
    const prev = process.env.VEYLIN_RBAC_FILTER_TOOLS;
    delete process.env.VEYLIN_RBAC_FILTER_TOOLS;
    const org = createPersonalOrgDirectoryPort();
    const ids = ['mcp__biz__get_order', 'mcp__biz__create_order'];
    assert.equal(org.allowedToolsForRole?.('member', ids) ?? null, null);
    assert.equal(org.allowedToolsForRole?.('owner', ids) ?? null, null);
    if (prev !== undefined) process.env.VEYLIN_RBAC_FILTER_TOOLS = prev;
  });

  it('filters member tools to read-like names when enabled', () => {
    const prev = process.env.VEYLIN_RBAC_FILTER_TOOLS;
    process.env.VEYLIN_RBAC_FILTER_TOOLS = '1';
    const org = createPersonalOrgDirectoryPort();
    const ids = ['mcp__biz__get_order', 'mcp__biz__create_order', 'mcp__biz__list_customers'];
    const allowed = org.allowedToolsForRole?.('member', ids) ?? null;
    assert.ok(allowed);
    assert.deepEqual(allowed!.sort(), ['mcp__biz__get_order', 'mcp__biz__list_customers'].sort());
    assert.equal(org.allowedToolsForRole?.('admin', ids) ?? null, null);
    if (prev !== undefined) process.env.VEYLIN_RBAC_FILTER_TOOLS = prev;
    else delete process.env.VEYLIN_RBAC_FILTER_TOOLS;
  });
});

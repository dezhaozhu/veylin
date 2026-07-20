import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import {
  buildObservability,
  getRuntimeLangfuseOverrides,
  resolveLangfuseConfig,
  setRuntimeLangfuseOverrides,
} from './storage.js';

describe('resolveLangfuseConfig', () => {
  afterEach(() => {
    setRuntimeLangfuseOverrides(null);
  });

  it('returns null when LANGFUSE_ENABLED is false', () => {
    const cfg = resolveLangfuseConfig({
      LANGFUSE_ENABLED: 'false',
      LANGFUSE_PUBLIC_KEY: 'pk',
      LANGFUSE_SECRET_KEY: 'sk',
    });
    assert.equal(cfg, null);
  });

  it('returns null when enabled but keys are missing (does not throw)', () => {
    const warns: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args.map(String).join(' '));
    };
    try {
      const cfg = resolveLangfuseConfig({ LANGFUSE_ENABLED: 'true' });
      assert.equal(cfg, null);
      assert.ok(warns.some((w) => w.includes('LANGFUSE')));
    } finally {
      console.warn = original;
    }
  });

  it('resolves keys and prefers LANGFUSE_BASE_URL over LANGFUSE_HOST', () => {
    const cfg = resolveLangfuseConfig({
      LANGFUSE_ENABLED: '1',
      LANGFUSE_PUBLIC_KEY: 'pk-test',
      LANGFUSE_SECRET_KEY: 'sk-test',
      LANGFUSE_BASE_URL: 'https://lf.example',
      LANGFUSE_HOST: 'https://ignored.example',
      LANGFUSE_ENVIRONMENT: 'test',
      LANGFUSE_RELEASE: '0.0.0',
    });
    assert.deepEqual(cfg, {
      publicKey: 'pk-test',
      secretKey: 'sk-test',
      baseUrl: 'https://lf.example',
      environment: 'test',
      release: '0.0.0',
    });
  });

  it('falls back to LANGFUSE_HOST when BASE_URL is unset', () => {
    const cfg = resolveLangfuseConfig({
      LANGFUSE_ENABLED: 'true',
      LANGFUSE_PUBLIC_KEY: 'pk',
      LANGFUSE_SECRET_KEY: 'sk',
      LANGFUSE_HOST: 'https://host.example',
    });
    assert.equal(cfg?.baseUrl, 'https://host.example');
  });

  it('prefers runtime override over env', () => {
    setRuntimeLangfuseOverrides({
      enabled: true,
      publicKey: 'pk-override',
      secretKey: 'sk-override',
      baseUrl: 'https://override.example',
    });
    const cfg = resolveLangfuseConfig({
      LANGFUSE_ENABLED: 'true',
      LANGFUSE_PUBLIC_KEY: 'pk-env',
      LANGFUSE_SECRET_KEY: 'sk-env',
      LANGFUSE_BASE_URL: 'https://env.example',
    });
    assert.deepEqual(cfg, {
      publicKey: 'pk-override',
      secretKey: 'sk-override',
      baseUrl: 'https://override.example',
      environment: undefined,
      release: undefined,
    });
  });

  it('returns null when override enabled is false even if env is enabled', () => {
    setRuntimeLangfuseOverrides({
      enabled: false,
      publicKey: 'pk',
      secretKey: 'sk',
      baseUrl: 'https://cloud.langfuse.com',
    });
    const cfg = resolveLangfuseConfig({
      LANGFUSE_ENABLED: 'true',
      LANGFUSE_PUBLIC_KEY: 'pk-env',
      LANGFUSE_SECRET_KEY: 'sk-env',
    });
    assert.equal(cfg, null);
  });

  it('falls back to env when override is cleared', () => {
    setRuntimeLangfuseOverrides({
      enabled: true,
      publicKey: 'pk-override',
      secretKey: 'sk-override',
      baseUrl: 'https://override.example',
    });
    setRuntimeLangfuseOverrides(null);
    assert.equal(getRuntimeLangfuseOverrides(), null);
    const cfg = resolveLangfuseConfig({
      LANGFUSE_ENABLED: 'true',
      LANGFUSE_PUBLIC_KEY: 'pk-env',
      LANGFUSE_SECRET_KEY: 'sk-env',
      LANGFUSE_BASE_URL: 'https://env.example',
    });
    assert.equal(cfg?.publicKey, 'pk-env');
    assert.equal(cfg?.baseUrl, 'https://env.example');
  });
});

describe('buildObservability', () => {
  beforeEach(() => {
    setRuntimeLangfuseOverrides(null);
  });
  afterEach(() => {
    setRuntimeLangfuseOverrides(null);
  });

  it('does not throw when Langfuse is disabled', () => {
    const obs = buildObservability({ LANGFUSE_ENABLED: 'false' });
    assert.ok(obs);
    assert.ok(obs.getDefaultInstance());
  });

  it('degrades when enabled without keys', () => {
    const warns: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args.map(String).join(' '));
    };
    try {
      const obs = buildObservability({ LANGFUSE_ENABLED: 'true' });
      assert.ok(obs.getDefaultInstance());
      assert.ok(warns.some((w) => w.includes('skipping Langfuse')));
    } finally {
      console.warn = original;
    }
  });
});

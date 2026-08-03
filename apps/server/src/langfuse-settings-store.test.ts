import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  mergeLangfuseSettings,
  normalizeLangfuseSettings,
  toLangfuseSettingsView,
} from './langfuse-settings-store.js';

describe('langfuse-settings-store view/merge', () => {
  it('view never includes secretKey; reports hasSecretKey', () => {
    const stored = normalizeLangfuseSettings({
      enabled: true,
      publicKey: 'pk',
      secretKey: 'sk-secret',
      baseUrl: 'https://lf.example',
    });
    const view = toLangfuseSettingsView(stored);
    assert.deepEqual(view, {
      enabled: true,
      publicKey: 'pk',
      baseUrl: 'https://lf.example',
      hasSecretKey: true,
    });
    assert.equal('secretKey' in view, false);
  });

  it('view hasSecretKey false when secret empty', () => {
    const view = toLangfuseSettingsView(
      normalizeLangfuseSettings({
        enabled: false,
        publicKey: '',
        secretKey: '',
      }),
    );
    assert.equal(view.hasSecretKey, false);
  });

  it('merge keeps existing secret when patch omits secretKey', () => {
    const existing = normalizeLangfuseSettings({
      enabled: true,
      publicKey: 'pk-old',
      secretKey: 'sk-old',
      baseUrl: 'https://old.example',
    });
    const next = mergeLangfuseSettings(existing, {
      enabled: true,
      publicKey: 'pk-new',
      baseUrl: 'https://new.example',
    });
    assert.equal(next.secretKey, 'sk-old');
    assert.equal(next.publicKey, 'pk-new');
    assert.equal(next.baseUrl, 'https://new.example');
  });

  it('merge keeps existing secret when patch secretKey is blank', () => {
    const existing = normalizeLangfuseSettings({
      enabled: true,
      publicKey: 'pk',
      secretKey: 'sk-keep',
      baseUrl: 'https://cloud.langfuse.com',
    });
    const next = mergeLangfuseSettings(existing, { secretKey: '   ' });
    assert.equal(next.secretKey, 'sk-keep');
  });

  it('merge replaces secret when patch provides a non-empty secretKey', () => {
    const existing = normalizeLangfuseSettings({
      enabled: true,
      publicKey: 'pk',
      secretKey: 'sk-old',
      baseUrl: 'https://cloud.langfuse.com',
    });
    const next = mergeLangfuseSettings(existing, { secretKey: 'sk-new' });
    assert.equal(next.secretKey, 'sk-new');
  });
});

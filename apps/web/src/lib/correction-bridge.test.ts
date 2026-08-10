import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CORRECTION_CURRENT_MAX,
  CORRECTION_FIELD_MAX,
  correctionDraftSpec,
  parseCorrectionMessage,
  parseOpenGridMessage,
  type CorrectionPayload,
} from './correction-bridge';

const valid = () => ({
  type: 'veylin:action',
  action: 'open-correction',
  payload: {
    scene: 'guolu',
    section: 'capacity',
    label: '产能口径',
    current: '上锅 136 吨/月 · K=3',
  },
});

describe('parseCorrectionMessage — shape whitelist', () => {
  it('accepts exactly the spec shape and returns sanitized payload', () => {
    assert.deepEqual(parseCorrectionMessage(valid()), {
      scene: 'guolu',
      section: 'capacity',
      label: '产能口径',
      current: '上锅 136 吨/月 · K=3',
    });
  });

  it('drops non-object data silently', () => {
    for (const data of [null, undefined, 42, 'veylin:action', [], true]) {
      assert.equal(parseCorrectionMessage(data), null);
    }
  });

  it('drops a foreign/unknown action (only open-correction is whitelisted)', () => {
    assert.equal(parseCorrectionMessage({ ...valid(), action: 'open-thread' }), null);
    assert.equal(parseCorrectionMessage({ ...valid(), action: 'delete-project' }), null);
    assert.equal(parseCorrectionMessage({ ...valid(), action: '' }), null);
  });

  it('drops a wrong message type', () => {
    assert.equal(parseCorrectionMessage({ ...valid(), type: 'veylin:other' }), null);
    // MCP-Apps bridge JSON-RPC traffic shares the same window channel — must
    // never parse as a correction.
    assert.equal(parseCorrectionMessage({ jsonrpc: '2.0', method: 'ui/initialize' }), null);
  });

  it('drops a missing or non-object payload', () => {
    assert.equal(parseCorrectionMessage({ type: 'veylin:action', action: 'open-correction' }), null);
    assert.equal(
      parseCorrectionMessage({ type: 'veylin:action', action: 'open-correction', payload: 'x' }),
      null,
    );
    assert.equal(
      parseCorrectionMessage({ type: 'veylin:action', action: 'open-correction', payload: null }),
      null,
    );
  });

  it('drops non-string payload fields (no coercion of hostile values)', () => {
    for (const bad of [42, {}, ['x'], true]) {
      const msg = valid();
      (msg.payload as Record<string, unknown>).current = bad;
      assert.equal(parseCorrectionMessage(msg), null);
    }
  });

  it('missing optional fields sanitize to empty strings', () => {
    const parsed = parseCorrectionMessage({
      type: 'veylin:action',
      action: 'open-correction',
      payload: { label: '产能口径' },
    });
    assert.deepEqual(parsed, { scene: '', section: '', label: '产能口径', current: '' });
  });

  it('drops a payload that names no section at all (no label, no section)', () => {
    assert.equal(
      parseCorrectionMessage({
        type: 'veylin:action',
        action: 'open-correction',
        payload: { scene: 'guolu', current: 'x' },
      }),
      null,
    );
  });
});

describe('parseCorrectionMessage — size caps', () => {
  it('accepts fields exactly at the cap', () => {
    const msg = valid();
    msg.payload.label = '产'.repeat(CORRECTION_FIELD_MAX);
    msg.payload.current = 'x'.repeat(CORRECTION_CURRENT_MAX);
    const parsed = parseCorrectionMessage(msg);
    assert.ok(parsed);
    assert.equal(parsed.label.length, CORRECTION_FIELD_MAX);
    assert.equal(parsed.current.length, CORRECTION_CURRENT_MAX);
  });

  it('drops the whole message when any field exceeds its cap', () => {
    for (const field of ['scene', 'section', 'label'] as const) {
      const msg = valid();
      msg.payload[field] = 'x'.repeat(CORRECTION_FIELD_MAX + 1);
      assert.equal(parseCorrectionMessage(msg), null, `oversized ${field}`);
    }
    const msg = valid();
    msg.payload.current = 'x'.repeat(CORRECTION_CURRENT_MAX + 1);
    assert.equal(parseCorrectionMessage(msg), null, 'oversized current');
  });

  it('drops grossly oversized fields before any regex work', () => {
    const msg = valid();
    msg.payload.current = '\u0000'.repeat(1_000_000);
    assert.equal(parseCorrectionMessage(msg), null);
  });
});

describe('parseCorrectionMessage — control-char stripping', () => {
  it('strips C0/C1/DEL control characters', () => {
    const msg = valid();
    msg.payload.current = 'a\u0000b\u0001c\u001Bd\u007Fe\u009Cf';
    assert.equal(parseCorrectionMessage(msg)?.current, 'abcdef');
  });

  it('normalizes newlines/tabs to single spaces (drafts are one-liners)', () => {
    const msg = valid();
    msg.payload.current = 'line1\n\nline2\t\tline3\r\nline4';
    assert.equal(parseCorrectionMessage(msg)?.current, 'line1 line2 line3 line4');
  });

  it('strips zero-width and bidi-override characters (spoofing defense)', () => {
    const msg = valid();
    msg.payload.label = '\u202E产\u200B能\u2066口\uFEFF径\u2069';
    assert.equal(parseCorrectionMessage(msg)?.label, '产能口径');
  });

  it('trims surrounding whitespace', () => {
    const msg = valid();
    msg.payload.scene = '  guolu  ';
    assert.equal(parseCorrectionMessage(msg)?.scene, 'guolu');
  });

  it('cap applies to the CLEANED value (control padding cannot smuggle length)', () => {
    const msg = valid();
    // 600 raw chars but 100 after stripping → passes the current cap.
    msg.payload.current = ('x' + '\u0000'.repeat(5)).repeat(100);
    assert.equal(parseCorrectionMessage(msg)?.current, 'x'.repeat(100));
  });
});

describe('correctionDraftSpec — draft composition', () => {
  const p = (over: Partial<CorrectionPayload> = {}): CorrectionPayload => ({
    scene: 'guolu',
    section: 'capacity',
    label: '产能口径',
    current: '上锅 136 吨/月',
    ...over,
  });

  it('full payload + host scene label → the full template', () => {
    assert.deepEqual(correctionDraftSpec('锅炉厂', p()), {
      key: 'correctionBridge.draft',
      vars: { scene: '锅炉厂', label: '产能口径', current: '上锅 136 吨/月' },
    });
  });

  it('the human label wins over the stable section key, and falls back to it', () => {
    assert.equal(correctionDraftSpec('锅炉厂', p()).vars.label, '产能口径');
    assert.equal(correctionDraftSpec('锅炉厂', p({ label: '' })).vars.label, 'capacity');
  });

  it('no scene label (in-chat, widget sent none) → NoScene template', () => {
    assert.equal(correctionDraftSpec('', p()).key, 'correctionBridge.draftNoScene');
    assert.equal(correctionDraftSpec('  ', p()).key, 'correctionBridge.draftNoScene');
  });

  it('no current snapshot → NoCurrent template (no dangling colon)', () => {
    assert.equal(correctionDraftSpec('锅炉厂', p({ current: '' })).key, 'correctionBridge.draftNoCurrent');
  });

  it('neither scene nor current → Bare template', () => {
    assert.equal(correctionDraftSpec('', p({ current: '' })).key, 'correctionBridge.draftBare');
  });

  it('interpolated against the real zh template, the draft QUOTES the card', () => {
    // Mirror of zh-CN.json correctionBridge.draft — kept literal here so a
    // template change that breaks the sentence shape fails a test.
    // Security review (surface 2): widget-supplied text must read as QUOTED
    // card content, never as the user's own first-person assertion, so a
    // hostile widget can't put authoritative-sounding claims in the user's
    // mouth on the way to the agent.
    const template = '卡片「{{scene}} · {{label}}」当前显示:「{{current}}」\n以上内容有误:';
    const { vars } = correctionDraftSpec('锅炉厂', p());
    const draft = template
      .replace('{{scene}}', vars.scene)
      .replace('{{label}}', vars.label)
      .replace('{{current}}', vars.current);
    assert.equal(draft, '卡片「锅炉厂 · 产能口径」当前显示:「上锅 136 吨/月」\n以上内容有误:');
    // the payload text is inside quotes, and the user's own words start after
    assert.ok(draft.includes('「上锅 136 吨/月」'));
    assert.ok(draft.trimEnd().endsWith('以上内容有误:'));
  });
});

describe('parseOpenGridMessage — 展开排产表 drill', () => {
  const grid = (payload: unknown) => ({ type: 'veylin:action', action: 'open-schedule-grid', payload });

  it('accepts the action with an empty payload → {}', () => {
    assert.deepEqual(parseOpenGridMessage(grid({})), {});
    assert.deepEqual(parseOpenGridMessage({ type: 'veylin:action', action: 'open-schedule-grid' }), {});
  });

  it('returns sanitized status/workshop/order_id filters when present', () => {
    assert.deepEqual(parseOpenGridMessage(grid({ status: 'late' })), { status: 'late' });
    assert.deepEqual(
      parseOpenGridMessage(grid({ workshop: '金工分厂', order_id: 'SO123' })),
      { workshop: '金工分厂', order_id: 'SO123' },
    );
  });

  it('drops non-open-schedule-grid / non-veylin:action shapes (null)', () => {
    assert.equal(parseOpenGridMessage({ type: 'veylin:action', action: 'open-correction', payload: {} }), null);
    assert.equal(parseOpenGridMessage({ type: 'other', action: 'open-schedule-grid', payload: {} }), null);
    assert.equal(parseOpenGridMessage('open-schedule-grid'), null);
    assert.equal(parseOpenGridMessage(null), null);
  });

  it('drops the whole message when a filter field is oversized (not truncated)', () => {
    assert.equal(parseOpenGridMessage(grid({ status: 'x'.repeat(CORRECTION_FIELD_MAX + 1) })), null);
  });

  it('strips control/zero-width chars from filter fields', () => {
    assert.deepEqual(parseOpenGridMessage(grid({ status: 'la​te' })), { status: 'late' });
  });

  it('never selects a target — payload carries only filters', () => {
    assert.deepEqual(parseOpenGridMessage(grid({ status: 'late', threadId: 'evil', tenant: 'evil' })), {
      status: 'late',
    });
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  collapsedSidebarTriggerReservePx,
  detectTitlebarPlatform,
  titlebarLeadingInset,
  titlebarOverlayWidth,
  titlebarTrailingInset,
  usesCustomCaptionButtons,
} from './titlebar-layout';

describe('titlebar-layout', () => {
  it('detects platforms from UA / platform strings', () => {
    assert.equal(detectTitlebarPlatform('Mozilla/5.0 (Macintosh)', 'MacIntel'), 'web');
    // Without Tauri, always web — platform helpers still accept explicit platform args.
  });

  it('uses mac leading inset only on mac', () => {
    assert.equal(titlebarLeadingInset(true, 'mac'), 86);
    assert.equal(titlebarLeadingInset(false, 'mac'), 86);
    assert.equal(titlebarLeadingInset(true, 'windows'), 8);
    assert.equal(titlebarLeadingInset(false, 'windows'), 8);
    assert.equal(titlebarLeadingInset(true, 'web'), 8);
  });

  it('reserves trailing caption space on Win/Linux only', () => {
    assert.equal(usesCustomCaptionButtons('windows'), true);
    assert.equal(usesCustomCaptionButtons('linux'), true);
    assert.equal(usesCustomCaptionButtons('mac'), false);
    assert.equal(titlebarTrailingInset('windows'), 138);
    assert.equal(titlebarTrailingInset('mac'), 8);
    assert.equal(titlebarTrailingInset('web'), 8);
  });

  it('expanded overlay matches sidebar width; collapsed icon rail needs no floating chrome', () => {
    assert.equal(titlebarOverlayWidth(false, 256, 'windows'), 0);
    assert.equal(titlebarOverlayWidth(true, 256, 'windows'), 256);
    assert.equal(collapsedSidebarTriggerReservePx('windows'), 0);
    assert.equal(collapsedSidebarTriggerReservePx('mac'), 0);
  });
});

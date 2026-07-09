import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CHAT_PANEL_RATIO_DEFAULT,
  chatRatioToRightWidth,
  resolveRightPanelOpenWidth,
} from './chat-panel-ratio';

describe('chat-panel-ratio', () => {
  it('uses default split when no ratio is stored', () => {
    const width = resolveRightPanelOpenWidth(1200, 280);
    const expected = chatRatioToRightWidth(
      CHAT_PANEL_RATIO_DEFAULT,
      1200,
      280,
      1200,
    );
    assert.equal(width, expected);
  });

  it('maps chat ratio to right width within bounds', () => {
    const right = chatRatioToRightWidth(
      CHAT_PANEL_RATIO_DEFAULT,
      1000,
      280,
      720,
    );
    assert.equal(right, 350);
  });
});

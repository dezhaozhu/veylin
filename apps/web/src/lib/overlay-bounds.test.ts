import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  readElementBounds,
  resolveChatColumnElement,
  type OverlayBounds,
} from './overlay-bounds.ts';

describe('overlay-bounds', () => {
  it('readElementBounds returns null for missing or zero-size elements', () => {
    assert.equal(readElementBounds(null), null);

    const el = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 100 }),
    } as unknown as Element;
    assert.equal(readElementBounds(el), null);
  });

  it('readElementBounds rounds viewport rects', () => {
    const el = {
      getBoundingClientRect: () => ({
        left: 10.4,
        top: 20.6,
        width: 300.2,
        height: 400.8,
      }),
    } as unknown as Element;
    const bounds = readElementBounds(el) as OverlayBounds;
    assert.deepEqual(bounds, { left: 10, top: 21, width: 300, height: 401 });
  });

  it('resolveChatColumnElement prefers sidebar-inset over chat-workspace', () => {
    const previous = globalThis.document;
    const inset = { id: 'inset' };
    const workspace = { id: 'workspace' };
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        querySelector(selector: string) {
          if (selector === '[data-slot="sidebar-inset"]') return inset;
          if (selector === '[data-slot="chat-workspace"]') return workspace;
          return null;
        },
      },
    });
    try {
      assert.equal(resolveChatColumnElement(), inset);
    } finally {
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: previous,
      });
    }
  });
});

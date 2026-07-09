import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import {
  hideWebView,
  isWebViewHideSuppressed,
  resizeWebView,
  resetWebViewResizeStateForTests,
  suppressWebViewHide,
  waitForWebViewBounds,
} from './tauri-web-view';

describe('tauri-web-view hide suppression', () => {
  afterEach(() => {
    suppressWebViewHide(0);
    resetWebViewResizeStateForTests();
  });

  it('suppresses hideWebView until cleared, unless force is set', async () => {
    const invoke = mock.fn(async () => undefined);
    const previous = (globalThis as { window?: unknown }).window;
    (globalThis as { window: unknown }).window = {
      __TAURI_INTERNALS__: { invoke },
    };

    try {
      suppressWebViewHide(60_000);
      assert.equal(isWebViewHideSuppressed(), true);

      await hideWebView();
      assert.equal(invoke.mock.callCount(), 0);

      await hideWebView(undefined, { force: true });
      assert.equal(invoke.mock.callCount(), 1);
      assert.deepEqual(invoke.mock.calls[0]?.arguments, [
        'hide_web_view',
        { tabId: null },
      ]);

      suppressWebViewHide(0);
      assert.equal(isWebViewHideSuppressed(), false);

      invoke.mock.resetCalls();
      await hideWebView('tab-1');
      assert.equal(invoke.mock.callCount(), 1);
      assert.deepEqual(invoke.mock.calls[0]?.arguments, [
        'hide_web_view',
        { tabId: 'tab-1' },
      ]);
    } finally {
      if (previous === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window: unknown }).window = previous;
      }
    }
  });

  it('waitForWebViewBounds retries until measure returns a size', async () => {
    const bounds = { x: 10, y: 20, width: 300, height: 400 };
    let calls = 0;
    const measure = () => {
      calls += 1;
      return calls >= 3 ? bounds : null;
    };

    const previousRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    }) as typeof requestAnimationFrame;

    try {
      const result = await waitForWebViewBounds(measure, 5);
      assert.deepEqual(result, bounds);
      assert.equal(calls, 3);
    } finally {
      globalThis.requestAnimationFrame = previousRaf;
    }
  });
});

describe('tauri-web-view resize coalesce', () => {
  afterEach(() => {
    resetWebViewResizeStateForTests();
  });

  it('applies only the latest bounds when updates arrive during an in-flight resize', async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let invokeCount = 0;
    const invoke = mock.fn(async (cmd: string) => {
      if (cmd !== 'resize_web_view') return;
      invokeCount += 1;
      if (invokeCount === 1) await firstGate;
    });
    const previous = (globalThis as { window?: unknown }).window;
    (globalThis as { window: unknown }).window = {
      __TAURI_INTERNALS__: { invoke },
    };

    try {
      const first = resizeWebView('tab-a', { x: 0, y: 0, width: 100, height: 200 });
      // Let the first flush start and park on the gate.
      await Promise.resolve();
      await Promise.resolve();

      const mid = resizeWebView('tab-a', { x: 0, y: 0, width: 150, height: 200 });
      const last = resizeWebView('tab-a', { x: 10, y: 0, width: 220, height: 200 });

      releaseFirst();
      await Promise.all([first, mid, last]);

      const resizeCalls = invoke.mock.calls.filter(
        (call) => call.arguments[0] === 'resize_web_view',
      );
      assert.equal(resizeCalls.length, 2);
      assert.deepEqual(resizeCalls[0]?.arguments[1], {
        tabId: 'tab-a',
        bounds: { x: 0, y: 0, width: 100, height: 200 },
      });
      assert.deepEqual(resizeCalls[1]?.arguments[1], {
        tabId: 'tab-a',
        bounds: { x: 10, y: 0, width: 220, height: 200 },
      });
    } finally {
      if (previous === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window: unknown }).window = previous;
      }
    }
  });

  it('skips a no-op resize when bounds match the last sent size', async () => {
    const invoke = mock.fn(async () => undefined);
    const previous = (globalThis as { window?: unknown }).window;
    (globalThis as { window: unknown }).window = {
      __TAURI_INTERNALS__: { invoke },
    };

    try {
      const bounds = { x: 1, y: 2, width: 300, height: 400 };
      await resizeWebView('tab-b', bounds);
      await resizeWebView('tab-b', bounds);
      const resizeCalls = invoke.mock.calls.filter(
        (call) => call.arguments[0] === 'resize_web_view',
      );
      assert.equal(resizeCalls.length, 1);
    } finally {
      if (previous === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window: unknown }).window = previous;
      }
    }
  });
});

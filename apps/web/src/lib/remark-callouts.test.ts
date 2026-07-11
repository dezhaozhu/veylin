import assert from 'node:assert/strict';
import test from 'node:test';
import type { Root } from 'mdast';
import { remarkCallouts } from './remark-callouts.ts';

test('remarkCallouts maps tip/warning containers to callout divs', () => {
  const tree = {
    type: 'root',
    children: [
      {
        type: 'containerDirective',
        name: 'tip',
        label: 'Pro Tip',
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'text', value: 'Use Shiki for code.' }],
          },
        ],
      },
      {
        type: 'containerDirective',
        name: 'warning',
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'text', value: 'Be careful.' }],
          },
        ],
      },
    ],
  } as unknown as Root;

  const transform = remarkCallouts() as (tree: Root) => void;
  transform(tree);

  const tip = tree.children[0] as {
    data?: { hName?: string; hProperties?: Record<string, unknown> };
  };
  assert.equal(tip.data?.hName, 'div');
  assert.equal(tip.data?.hProperties?.['data-callout'], 'tip');
  assert.equal(tip.data?.hProperties?.['data-title'], 'Pro Tip');
  assert.match(String(tip.data?.hProperties?.className), /aui-md-callout-tip/);

  const warning = tree.children[1] as {
    data?: { hProperties?: Record<string, unknown> };
  };
  assert.equal(warning.data?.hProperties?.['data-callout'], 'warning');
});

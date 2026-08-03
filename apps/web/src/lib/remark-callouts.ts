import type { Root } from 'mdast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';

const CALLOUT_NAMES = new Set(['tip', 'note', 'info', 'warning', 'danger']);

/** Map `:::tip` / `:::warning` container directives to styled callout divs. */
export const remarkCallouts: Plugin<[], Root> = () => (tree) => {
  visit(tree, (node) => {
    if (node.type !== 'containerDirective') return;
    const name = String((node as { name?: string }).name ?? '').toLowerCase();
    if (!CALLOUT_NAMES.has(name)) return;

    const data = ((node as { data?: Record<string, unknown> }).data ??= {});
    const label = (node as { label?: string }).label;
    data.hName = 'div';
    data.hProperties = {
      className: `aui-md-callout aui-md-callout-${name}`,
      'data-callout': name,
      ...(label ? { 'data-title': label } : {}),
    };
  });
};

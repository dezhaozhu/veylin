import type { Root } from 'mdast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';

const CITATION_RE = /\[(\d{1,2})\]/g;

/** Turn inline `[1]` markers into internal citation links for the knowledge panel. */
export const remarkInlineCitations: Plugin<[], Root> = () => (tree) => {
  visit(tree, 'text', (node, index, parent) => {
    if (!parent || index == null || typeof node.value !== 'string') return;
    const value = node.value;
    if (!/\[\d{1,2}\]/.test(value)) return;

    const nextChildren: Array<Record<string, unknown>> = [];
    let last = 0;
    for (const match of value.matchAll(CITATION_RE)) {
      const start = match.index ?? 0;
      if (start > last) {
        nextChildren.push({ type: 'text', value: value.slice(last, start) });
      }
      const refIndex = match[1]!;
      nextChildren.push({
        type: 'link',
        url: `rag-citation://${refIndex}`,
        children: [{ type: 'text', value: match[0] }],
      });
      last = start + match[0].length;
    }
    if (last < value.length) {
      nextChildren.push({ type: 'text', value: value.slice(last) });
    }
    if (nextChildren.length === 0) return;
    parent.children.splice(index, 1, ...(nextChildren as never[]));
  });
};

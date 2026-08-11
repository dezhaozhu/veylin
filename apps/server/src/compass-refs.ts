/**
 * 由 COMPASS_GROUNDING_TEXT 渲染插件路径的 references/data-honesty.md。
 *
 * 跑法:
 *   npm run gen:compass-refs            写入
 *   npm run gen:compass-refs -- --check  只校验(CI 可用)
 *
 * 为什么要生成:插件路径(marketplace compass-scheduler)与主聊天路径讲的是同一套
 * 诚实规矩,只是给不同部署形态。两份手写文本必然漂移 —— compass_eval 的 lanes.py
 * 已吃过同型的亏(复制生产函数会漂,所以那边直接 import 生产的私有函数)。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { COMPASS_GROUNDING_TEXT } from './compass-grounding.js';

const here = dirname(fileURLToPath(import.meta.url));

export const DATA_HONESTY_DOC_PATH = resolve(
  here,
  '../../../examples/marketplace/compass-scheduler/references/data-honesty.md',
);

const HEADER = [
  '<!-- 由 apps/server/src/compass-grounding.ts 的 COMPASS_GROUNDING_TEXT 生成。',
  '     请勿手改此文件 —— 改规范文本后跑 `npm run gen:compass-refs`。',
  '     两处手写同一套诚实规矩必然漂移,故只留一个来源。 -->',
  '',
].join('\n');

export function renderDataHonestyDoc(text: string): string {
  return `${HEADER}${text}\n`;
}

function main(): void {
  const rendered = renderDataHonestyDoc(COMPASS_GROUNDING_TEXT);
  if (process.argv.includes('--check')) {
    if (readFileSync(DATA_HONESTY_DOC_PATH, 'utf8') !== rendered) {
      console.error('data-honesty.md 与 COMPASS_GROUNDING_TEXT 不一致,跑 npm run gen:compass-refs');
      process.exit(1);
    }
    console.log('data-honesty.md 一致');
    return;
  }
  writeFileSync(DATA_HONESTY_DOC_PATH, rendered);
  console.log(`written ${DATA_HONESTY_DOC_PATH}`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();

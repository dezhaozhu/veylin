/**
 * 当过依据的东西自动留档 —— spec 2026-08-14 §5.1 第三档。
 *
 * 前两档靠人(明确要的落文件、副产品可另存);这一档**不靠人记得**:一个中间产物
 * 一旦被后续动作依赖(你看着那份预览按了提交),它就不再是中间产物,而是**这个决定
 * 的依据**,将来要能翻账。于是"该不该留"由事实决定,不由用户记不记得点保存。
 *
 * 写成 Markdown 而不是表:依据要**人读**,而且要在文件夹里一眼看懂。只读 —— 事后
 * 改它就是改历史。
 */
import { chmod, mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { folderExists, safeName } from './project-originals.js';

const DIR = '证据';
const two = (n: number) => String(n).padStart(2, '0');

export function decisionFileName(title: string, at: Date): string {
  const stamp =
    `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ` +
    `${two(at.getHours())}-${two(at.getMinutes())}`;
  return `${safeName(title)} ${stamp}.md`;
}

export async function writeDecisionRecord(input: {
  folder: string | undefined;
  title: string;
  summary: string;
  /** 关键数字:提交了几条、run id、结果如何 —— 翻账时先看这些 */
  facts: Record<string, unknown>;
  /** 凭什么做这个决定(影子对比、诊断摘要…) */
  evidence?: string;
  at?: Date;
}): Promise<{ written: boolean; path?: string; reason?: string }> {
  const { folder, title, summary, facts, evidence } = input;
  const at = input.at ?? new Date();

  if (!folder) {
    return { written: false, reason: '当前项目没有绑定文件夹,这次决定的依据没有留档' };
  }
  if (!(await folderExists(folder))) {
    return { written: false, reason: `项目文件夹不存在:${folder} —— 依据没有留档` };
  }

  const lines = [
    `# ${title}`,
    '',
    // 本地格式给人读,ISO 给翻账用 —— `2026/8/15` 跨时区跨语言都可能被读歪
    `- 时间:${at.toLocaleString('zh-CN')}(${at.toISOString()})`,
    `- 概要:${summary}`,
    ...Object.entries(facts).map(([k, v]) => `- ${k}:${String(v)}`),
  ];
  if (evidence) lines.push('', '## 依据', '', evidence);
  lines.push(
    '',
    '---',
    '',
    '这份记录是**自动留下的**:它是上面那个动作的依据,不是随手的中间产物。文件只读 —— 事后改它就是改历史。',
    '',
  );

  const dir = join(folder, DIR);
  await mkdir(dir, { recursive: true });

  // 同一分钟再来一次不覆盖:依据被改写就不是依据了。
  const base = decisionFileName(title, at);
  let target = join(dir, base);
  let n = 2;
  while (await exists(target)) target = join(dir, base.replace(/\.md$/, ` (${n++}).md`));

  await writeFile(target, lines.join('\n'), 'utf8');
  await chmod(target, 0o444);
  return { written: true, path: target };
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

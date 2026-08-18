import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { detectSlashCommand } from './use-composer-slash';

describe('detectSlashCommand', () => {
  it('开头的 / 打开命令菜单', () => {
    assert.deepEqual(detectSlashCommand('/pl', 3), { query: 'pl', start: 0, end: 3 });
  });

  it('只有一个 / 也算(菜单列全部命令)', () => {
    assert.deepEqual(detectSlashCommand('/', 1), { query: '', start: 0, end: 1 });
  });

  /**
   * 用户报的:句中写文件路径时,`/Users/...` 弹出"没有匹配的技能或命令"。
   * 命令只在消息开头存在 —— 句中的 / 永远是内容,不是命令。
   */
  it('句中的路径不触发', () => {
    const text = '文件都在 /Users/me/caliper/example_files/';
    assert.equal(detectSlashCommand(text, text.length), null);
  });

  it('前面有任何字符都不触发,哪怕紧跟空格', () => {
    assert.equal(detectSlashCommand('看 /plan', 7), null);
  });

  it('换行后的 / 也不触发(消息已经开始了)', () => {
    assert.equal(detectSlashCommand('第一行\n/plan', 8), null);
  });
});

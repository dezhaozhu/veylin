/**
 * 绑项目文件夹的前端半边(spec 2026-08-14 §2)。
 *
 * 选目录只有桌面端做得到 —— 浏览器拿不到绝对路径。所以这里的关键不是"怎么选",
 * 是**选不了的时候说什么**:不能让人点了没反应,也不能假装绑上了。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { folderPickAvailability, describeFolderState } from './project-folder.js';

describe('folderPickAvailability', () => {
  it('桌面端:能选', () => {
    assert.deepEqual(folderPickAvailability({ isDesktop: true }), { canPick: true });
  });

  it('浏览器:打不开系统面板,但要指出**替代做法**而不是把人挡在门外', () => {
    // 粘路径在浏览器里同样成立 —— 写文件的是本机服务端,绝对路径对它有效。
    // 原来的文案让人"去桌面端",那是把一条本来走得通的路说死了。
    const out = folderPickAvailability({ isDesktop: false });
    assert.equal(out.canPick, false);
    assert.match(out.reason ?? '', /粘/);
  });
});

describe('describeFolderState —— 界面上那一行字', () => {
  it('绑了:显示路径', () => {
    assert.match(describeFolderState('/Users/me/上重'), /\/Users\/me\/上重/);
  });

  it('没绑:说清楚后果(原件不会留档),不是干巴巴一句"未设置"', () => {
    const s = describeFolderState(undefined);
    assert.match(s, /没有/);
    assert.match(s, /原件/, '要讲清楚不绑会怎样 —— 导入的原件不会留档');
  });
});

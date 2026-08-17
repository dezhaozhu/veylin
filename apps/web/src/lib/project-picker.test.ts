import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { projectPickerRows, shortPath } from './project-picker';

const projects = [
  { id: 'a', name: '111' },
  { id: 'b', name: '锅炉厂', folder: '/Users/me/Documents/guolu' },
  { id: 'c', name: '上重', folder: '/Users/me/Documents/shangzhong' },
];

describe('projectPickerRows', () => {
  it('**当前这个排最前** —— 人找的往往就是它,或者正要离开它', () => {
    assert.deepEqual(projectPickerRows(projects, '', 'c').map((r) => r.id), ['c', 'a', 'b']);
  });

  it('**没绑文件夹的要能看出来**,而不是留一片空白让人猜', () => {
    assert.equal(projectPickerRows(projects, '', null)[0]!.folder, null);
  });

  it('搜索既认名字也认路径 —— 记不住项目名的时候,路径反而是人记得的那个', () => {
    assert.deepEqual(projectPickerRows(projects, 'guolu', null).map((r) => r.id), ['b']);
    assert.deepEqual(projectPickerRows(projects, '上重', null).map((r) => r.id), ['c']);
  });

  it('搜不到就是空的,不做模糊兜底', () => {
    assert.deepEqual(projectPickerRows(projects, 'zzz', null), []);
  });

  it('长路径从左边截 —— 尾巴那几段才是人认得出的', () => {
    const out = shortPath('/Users/me/Documents/compassX/veylin/apps/web', 20);
    assert.ok(out.startsWith('…'), out);
    assert.ok(out.endsWith('apps/web'), out);
    assert.equal(out.length, 20);
  });

  it('短路径原样给出', () => {
    assert.equal(shortPath('/a/b'), '/a/b');
  });
});

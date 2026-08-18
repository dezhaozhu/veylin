import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decideTablePanelSheet } from './open-table-panel';

/**
 * 用户实测:进项目、点一下右侧「表格」,就多出一张空 Sheet;点几次就 Sheet 1…Sheet 6。
 *
 * 因为**开面板和「+ 新建表」走的是同一条路**,而那条路无条件建新表。可"打开面板"
 * 是要**看已经有的东西**,不是要加一张空表 —— 何况表是按项目存的,每开一次新对话
 * 点一下面板,项目里就多一张空表,谁也不知道那是谁建的。
 */
describe('decideTablePanelSheet', () => {
  it('已经有表:打开第一张,不新建', () => {
    assert.deepEqual(
      decideTablePanelSheet([
        { id: 's1', name: '工序', builtin: false },
        { id: 's2', name: '分厂延误汇总', builtin: false },
      ]),
      { kind: 'open', sheetId: 's1' },
    );
  });

  it('一张都没有:才新建 —— 空面板没有可看的东西', () => {
    assert.deepEqual(decideTablePanelSheet([]), { kind: 'create' });
  });
});

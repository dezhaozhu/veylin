import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DHX_CSS_SPECIFIER,
  DHX_SPECIFIER,
  checkDistInvariants,
  scanDistChunks,
} from './dist-invariants';

/** 产物里"包被打进来了"的样子:有 dhtmlx 库 chunk,没有裸说明符。 */
const BUNDLED = [
  { name: 'index-abc.js', code: 'const x=()=>import("./dhtmlxgantt.react.es-XYZ.js");' },
  { name: 'dhtmlxgantt.react.es-XYZ.js', code: 'var gantt_task_line=1;' },
];

/** 产物里"包不在场"的样子:裸说明符留在原地(external),没有库 chunk。 */
const EXTERNAL_BACKTICK = [
  { name: 'index-abc.js', code: 'let t=()=>x(()=>import(`@dhx/react-gantt`),[]);' },
];

describe('scanDistChunks', () => {
  it('认得反引号形式的裸说明符 —— rolldown 输出的就是这种(我用引号找了两轮才发现)', () => {
    const out = scanDistChunks(EXTERNAL_BACKTICK);
    assert.equal(out.bareSpecifierIn, 'index-abc.js');
    assert.equal(out.libraryChunkIn, null);
  });

  it('也认单双引号形式', () => {
    for (const q of ['"', "'"]) {
      const out = scanDistChunks([{ name: 'a.js', code: `import(${q}${DHX_SPECIFIER}${q})` }]);
      assert.equal(out.bareSpecifierIn, 'a.js');
    }
  });

  it('识别库 chunk(按文件名或内容特征)', () => {
    assert.equal(scanDistChunks(BUNDLED).libraryChunkIn, 'dhtmlxgantt.react.es-XYZ.js');
    assert.equal(
      scanDistChunks([{ name: 'chunk-Q.js', code: 'var gantt_task_line=1;' }]).libraryChunkIn,
      'chunk-Q.js',
    );
  });

  it('**不把 loader 自己的日志串当成库** —— "dhtmlx-gantt-loader" 里含 dhtmlx', () => {
    const out = scanDistChunks([
      { name: 'index-a.js', code: 'console.debug(`[dhtmlx-gantt-loader] 未安装`)' },
    ]);
    assert.equal(out.libraryChunkIn, null);
  });

  it('干净产物两样都没有', () => {
    const out = scanDistChunks([{ name: 'a.js', code: 'export const a=1;' }]);
    assert.equal(out.bareSpecifierIn, null);
    assert.equal(out.libraryChunkIn, null);
  });
});

describe('样式表:和 JS 同一条缝', () => {
  it('CSS 的裸说明符也要认 —— 漏了它甘特会渲染成无样式(标签重叠到读不了)', () => {
    const out = scanDistChunks([
      { name: 'index-a.js', code: `import(\`${DHX_CSS_SPECIFIER}\`)` },
    ]);
    assert.equal(out.bareCssSpecifierIn, 'index-a.js');
  });

  it('包在场但 CSS 没打进去 → 失败', () => {
    const r = checkDistInvariants({
      hasDhx: true,
      chunks: [...BUNDLED, { name: 'i.js', code: `import("${DHX_CSS_SPECIFIER}")` }],
    });
    assert.equal(r.ok, false);
    assert.match(r.reason, /样式|css/i);
  });

  it('包缺席时 CSS 留裸说明符是正常的', () => {
    const r = checkDistInvariants({
      hasDhx: false,
      chunks: [{ name: 'i.js', code: `import(\`${DHX_CSS_SPECIFIER}\`)` }],
    });
    assert.equal(r.ok, true);
  });
});

describe('checkDistInvariants — 包在场', () => {
  it('打进来了 = 通过', () => {
    assert.deepEqual(checkDistInvariants({ hasDhx: true, chunks: BUNDLED }), { ok: true });
  });

  it('**这次真踩的那个**:包装好了却留下裸说明符 → 失败,并指向分析屏蔽', () => {
    const r = checkDistInvariants({ hasDhx: true, chunks: EXTERNAL_BACKTICK });
    assert.equal(r.ok, false);
    assert.match(r.reason, /装好了/);
    assert.match(r.reason, /vite-ignore/);
  });

  it('包在场但产物里两样都没有 → 也失败(甘特会静默消失)', () => {
    const r = checkDistInvariants({ hasDhx: true, chunks: [{ name: 'a.js', code: 'const a=1' }] });
    assert.equal(r.ok, false);
    assert.match(r.reason, /没有被打进产物/);
  });
});

describe('checkDistInvariants — 包缺席', () => {
  it('裸说明符(external)= 通过,这是正常的降级路径', () => {
    assert.deepEqual(checkDistInvariants({ hasDhx: false, chunks: EXTERNAL_BACKTICK }), {
      ok: true,
    });
  });

  it('包缺席却出现了库 chunk → 失败(不该发生,许可上也不该再分发)', () => {
    const r = checkDistInvariants({ hasDhx: false, chunks: BUNDLED });
    assert.equal(r.ok, false);
    assert.match(r.reason, /没装/);
  });

  it('包缺席、裸说明符也没有 → 通过:整条甘特代码被摇掉了也是自洽的', () => {
    assert.deepEqual(
      checkDistInvariants({ hasDhx: false, chunks: [{ name: 'a.js', code: 'const a=1' }] }),
      { ok: true },
    );
  });
});

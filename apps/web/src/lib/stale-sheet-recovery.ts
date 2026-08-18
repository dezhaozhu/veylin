/**
 * 面板记着的那张表在当前作用域里不存在时怎么办。
 *
 * 面板会记住"上次在看哪张表"。可那个 id 属于**上一个作用域**(项目 111 的
 * 「开发组件」),换到别的项目后服务端认不出来,直接 404 `sheet not found` ——
 * 界面上就是一条红条,而人什么也没做错(用户实测:重启 dev 仍在报)。
 *
 * 正确的反应不是报错,是**退回这个作用域的默认表**:你要看的那张不在这儿,
 * 但这儿有它自己的表。红条留给真正的故障(网络断了、服务挂了)。
 */
export function isStaleSheetError(message: string): boolean {
  return /sheet not found/i.test(message);
}

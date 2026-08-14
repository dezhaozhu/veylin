/**
 * 表格变更事件的作用域过滤(spec 2026-08-13 §7)。
 *
 * 归属这条线的规矩是"不在作用域里就当它不存在" —— 推送也守同一条。客户端本来
 * 就按作用域化的 sheet id 取数,拿不到别的作用域的数据;但事件本身会漏出"别的
 * 作用域有一张叫某某的表变了"这点元信息,没有理由让它漏。
 *
 * 两个例外,都是"不知道就别拦":
 *  - `sheetsChange` 不带 sheet(它只是让客户端重取,而重取本身按作用域)
 *  - 认不出归属的老 id(迁移前的裸 id)照推,不猜
 */
import { sameScope, scopeOfSheetId, type SheetScope } from './table-scope.js';

type MaybeScopedEvent = { type: string; sheet?: string };

export function eventVisibleInScope(event: MaybeScopedEvent, scope: SheetScope): boolean {
  const sheet = event.sheet;
  if (!sheet) return true;
  const owner = scopeOfSheetId(sheet);
  if (!owner) return true;
  return sameScope(owner, scope);
}

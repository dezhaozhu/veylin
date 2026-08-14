/**
 * 表的归属(scope)—— spec: docs/specs/2026-08-13-table-scope-context.md
 *
 * 一条规则:**你在哪个作用域,就看到那个作用域的 context**。表不是"工作区里的
 * 一块数据",它是某个作用域的 context:个人的、项目的、或这一轮对话的。
 *
 * 为什么是结构体不是一个 `projectId` 字段:Veylin 今天没有共享层(sheet 表里
 * 连 tenant/user 维度都没有,全在本机)。将来真有服务端多人,是给 scope **加**
 * owner/可见性,不是重构。
 */

export type SheetScope =
  | { kind: 'personal' }
  | { kind: 'project'; id: string }
  | { kind: 'thread'; id: string };

export const PERSONAL_SCOPE: SheetScope = { kind: 'personal' };
export const projectScope = (id: string): SheetScope => ({ kind: 'project', id });
export const threadScope = (id: string): SheetScope => ({ kind: 'thread', id });

/**
 * 内部 id 的分隔符。**不用冒号** —— SurrealDB 的记录 id 就写作 `table:id`,
 * 在里面再塞冒号要靠 ⟨⟩ 转义,是自找的麻烦。`~` 在 URL 里是非保留字符。
 */
const SEP = '~';

/** id 前缀里只留这些字符;其余(含 `/ : 空格`)一律换成 `-`。 */
const sanitize = (v: string): string => v.trim().replace(/[^A-Za-z0-9_-]+/g, '-');

/** 作用域 → 稳定短前缀:`me` / `p_<项目>` / `t_<对话>`。 */
export function scopeKey(scope: SheetScope): string {
  if (scope.kind === 'personal') return 'me';
  return `${scope.kind === 'project' ? 'p' : 't'}_${sanitize(scope.id)}`;
}

export function sameScope(a: SheetScope, b: SheetScope): boolean {
  return scopeKey(a) === scopeKey(b);
}

/** 短名(`schedule`)+ 作用域 → 内部 id(`p_guolu~schedule`)。 */
export function sheetIdFor(scope: SheetScope, shortName: string): string {
  return `${scopeKey(scope)}${SEP}${shortName}`;
}

/** 内部 id → 短名。没有前缀的老 id 原样返回。 */
export function shortNameOf(sheetId: string): string {
  const i = sheetId.indexOf(SEP);
  if (i < 0) return sheetId;
  const prefix = sheetId.slice(0, i);
  return isScopePrefix(prefix) ? sheetId.slice(i + SEP.length) : sheetId;
}

/** 内部 id → 作用域。没有前缀(迁移前的老表)返回 null —— 不猜。 */
export function scopeOfSheetId(sheetId: string): SheetScope | null {
  const i = sheetId.indexOf(SEP);
  if (i < 0) return null;
  const prefix = sheetId.slice(0, i);
  if (prefix === 'me') return PERSONAL_SCOPE;
  if (prefix.startsWith('p_')) return projectScope(prefix.slice(2));
  if (prefix.startsWith('t_')) return threadScope(prefix.slice(2));
  return null;
}

function isScopePrefix(prefix: string): boolean {
  return prefix === 'me' || prefix.startsWith('p_') || prefix.startsWith('t_');
}

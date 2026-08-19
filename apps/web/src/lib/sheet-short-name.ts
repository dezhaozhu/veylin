/**
 * 表 id 的短名 —— 与服务端 `table-scope.ts` 的 `shortNameOf` 同一条规则。
 *
 * 表变成"某个作用域的 context"之后(commit 1b47938),内部 id 带上了归属前缀:
 * `p_<项目>~schedule`、`t_<对话>~schedule`、`me~schedule`。面板拿到的就是这个 id。
 *
 * **于是所有 `activeSheetId === 'schedule'` 的判断在项目里恒为假** —— 二三级展开、
 * 受治理编辑、草稿条,一进项目就静悄悄没了(用户实测:"以前二级三级在一起能展开,
 * 现在没了")。功能没被删,是身份被限定后比较没跟着改。判断一律走短名。
 */
const SEP = '~';

const isScopePrefix = (p: string): boolean => p === 'me' || p.startsWith('p_') || p.startsWith('t_');

/** `p_x~schedule` → `schedule`;没有前缀的老 id 原样返回。 */
export function shortSheetName(sheetId: string | undefined): string {
  const id = sheetId ?? '';
  const i = id.indexOf(SEP);
  if (i < 0) return id;
  return isScopePrefix(id.slice(0, i)) ? id.slice(i + SEP.length) : id;
}

/** 这张表是不是那张短名表(唯一入口:比较只有这一处口径)。 */
export function isSheet(sheetId: string | undefined, shortName: string): boolean {
  return shortSheetName(sheetId) === shortName;
}

/**
 * 当前作用域里短名为 X 的那张表的**真 id**。
 *
 * 切表要用真 id —— `setActiveSheetId('schedule')` 在项目里切到的是一张不存在的表。
 */
export function findSheetIdByShortName(
  sheets: readonly { id: string }[],
  shortName: string,
): string | undefined {
  return sheets.find((s) => shortSheetName(s.id) === shortName)?.id;
}

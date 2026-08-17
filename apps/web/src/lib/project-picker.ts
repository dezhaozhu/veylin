/**
 * 输入框上那个「项目」从**只读指示**改成**能点的选择器**(形状参考 Claude 的
 * Project or folder)。
 *
 * 从前它是个 div,注释里写着 "indicator, not a picker" —— 换项目只能去侧栏。
 * 可它长得就像个可点的东西,摆在最显眼的位置,用户第一反应就是点它(实测:
 * "这里是项目,但又不能点")。
 *
 * 每一行**把文件夹路径一起写出来**:大多数活其实落在本地,路径就是这个项目
 * "到底对着哪堆文件"的唯一答案;没绑的也要说一声,而不是一片空白让人猜。
 */
export type PickerRow = {
  id: string;
  name: string;
  /** 绑了文件夹就给路径,没绑给 null —— 界面据此说"未设文件夹"。 */
  folder: string | null;
  current: boolean;
};

type ProjectLike = { id: string; name: string; folder?: string };

export function projectPickerRows(
  projects: ProjectLike[],
  query: string,
  currentProject: string | null,
): PickerRow[] {
  const kw = query.trim().toLowerCase();
  const hit = (p: ProjectLike) =>
    !kw ||
    p.name.toLowerCase().includes(kw) ||
    (p.folder ?? '').toLowerCase().includes(kw);

  return projects
    .filter(hit)
    .map((p) => ({
      id: p.id,
      name: p.name,
      folder: p.folder ?? null,
      current: p.id === currentProject,
    }))
    // 当前这个排最前:它是这一屏正在生效的那个,人找的往往就是它(或者要离开它)。
    .sort((a, b) => Number(b.current) - Number(a.current));
}

/** 路径太长时从**左边**截:尾巴那几段才是人认得出的。 */
export function shortPath(path: string, max = 38): string {
  return path.length <= max ? path : `…${path.slice(path.length - max + 1)}`;
}

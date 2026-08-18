/**
 * 从一条工具消息片段里取出工具名。
 *
 * **两种形状都得认。** AI SDK v5 的 UI part 把名字编进 `type`(`tool-get_gantt`),
 * 老的 `tool-call` 形状才有独立的 `toolName` 字段。只认后者的代码会在新形状下
 * 静默拿到 undefined —— MCP App 的 widget 就是这么全体消失的:工具名取不到,
 * 查不到 `ui://` 资源,于是一个 iframe 都不渲染,而界面上**没有任何报错**
 * (实测:agent 照样答话,还声称"图已渲染")。
 */
export function toolPartName(part: unknown): string | null {
  if (part == null || typeof part !== 'object') return null;
  const p = part as Record<string, unknown>;
  if (typeof p.toolName === 'string' && p.toolName) return p.toolName;
  const type = p.type;
  if (typeof type === 'string' && type.startsWith('tool-')) {
    const name = type.slice('tool-'.length);
    // `tool-call` / `tool-result` 是形状标签,不是工具名。
    if (name && name !== 'call' && name !== 'result') return name;
  }
  return null;
}

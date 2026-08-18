/**
 * "这条消息是从哪个项目页发出去的"。
 *
 * 项目页的输入框是 focus 时才异步「建线程 + 钉项目」的,而发送不等它 —— 打字快
 * 一点,第一条消息就跑在钉定前面,那一轮服务端看到的是**没有项目**:agent 于是
 * 回"当前会话没有绑定项目",够不到项目文件夹(用户实测)。
 *
 * 客户端拦不干净(发送在共享的 Composer 里),所以把这个意图随请求带上,由服务端
 * 在处理前确认并补钉。**只是提示,不是授权**:服务端仍要校验这个项目属于当前
 * 租户且是启用的。
 */
let hint: string | null = null;

export function setPendingProjectHint(projectId: string | null): void {
  hint = projectId;
}

export function readPendingProjectHint(): string | undefined {
  return hint ?? undefined;
}

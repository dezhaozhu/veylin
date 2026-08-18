import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  McpAppRenderer,
  McpAppsRemoteHost,
  useAui,
  useAuiState,
  type ToolCallMessagePartComponent,
} from '@assistant-ui/react';
import { useResource } from '@assistant-ui/tap';
import { useTranslation } from 'react-i18next';
import { McpAppActionBridge } from '@/components/assistant-ui/mcp-app-action-bridge';
import { ToolFallback } from '@/components/assistant-ui/tool-fallback';
import { placeComposerCaret } from '@/lib/composer-caret';
import { toolPartName } from '@/lib/tool-part-name';
import { appToolsCacheKey } from '@/lib/app-tools-key';
import { useThreadProjects } from '@/lib/thread-projects-sync';
import { DocumentEditResult } from '@/components/assistant-ui/document-edit-result';
import { usePanelTabs } from '@/components/assistant-ui/right-panel/panel-tabs-context';
import { correctionDraftSpec, type CorrectionPayload, type OpenGridFilter } from '@/lib/correction-bridge';

// Data plane for MCP Apps: the sandboxed widget's loadResource/callTool/
// readResource requests are POSTed to the Veylin host route, which proxies to
// the tenant's MCP servers (e.g. Compass). `McpAppsRemoteHostOptions` only
// exposes `url`/`fetch`/`headers` (the POST body is a fixed `{ method,
// params }` shape) — so the current thread's id, needed by routes/mcp-apps.ts
// to enforce the thread's project pin, travels as a `?threadId=` query param
// on the url instead. Built per-thread (not module-scope) so it tracks thread
// switches.
function mcpHostUrl(threadId: string | undefined): string {
  return threadId ? `/api/mcp-apps/host?threadId=${encodeURIComponent(threadId)}` : '/api/mcp-apps/host';
}

// toolName → ui:// resource map, fetched from the server (derived from each
// tool's _meta.ui.resourceUri). mastra doesn't forward that metadata onto the
// AI SDK tool-call part, so we look it up by tool name and inject it — generic
// across any tool/server that declares an MCP App UI, no hardcoding. Cached
// per threadId — different threads can have different project-pin-scoped
// tool sets, see routes/mcp-apps.ts's resolveScopedServerNames.
const appToolsPromiseByThread = new Map<string, Promise<Record<string, string>>>();
function loadAppTools(
  threadId: string | undefined,
  projectId: string | undefined,
): Promise<Record<string, string>> {
  // 键里带上钉定:映射取决于线程钉在哪个项目,而项目页是"先建线程、后钉项目",
  // 中间那一刻问到的必然是空表(实测:widget 全体不渲染,而且再也不会自己好)。
  const key = appToolsCacheKey(threadId, projectId);
  let promise = appToolsPromiseByThread.get(key);
  if (!promise) {
    const url = threadId ? `/api/mcp-apps/tools?threadId=${encodeURIComponent(threadId)}` : '/api/mcp-apps/tools';
    promise = fetch(url)
      .then((r) => (r.ok ? r.json() : { tools: {} }))
      .then((d: { tools?: Record<string, string> }) => d.tools ?? {})
      .catch(() => ({}));
    // **空表不留缓存。** 第一帧还没有 threadId 时问到的是个人区,答案必然是空;
    // 把它永久缓存住,这条线程后面再也不会去问第二次。
    void promise.then((m) => {
      if (Object.keys(m).length === 0) appToolsPromiseByThread.delete(key);
    });
    appToolsPromiseByThread.set(key, promise);
  }
  return promise;
}

function useAppTools(
  threadId: string | undefined,
  projectId: string | undefined,
): Record<string, string> {
  const [map, setMap] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    loadAppTools(threadId, projectId).then((m) => {
      if (alive) setMap(m);
    });
    return () => {
      alive = false;
    };
  }, [threadId, projectId]);
  return map;
}

/**
 * Tool-call renderer with MCP Apps support. When a tool declares a `ui://`
 * resource (via `_meta.ui.resourceUri`), its UI renders inline in the
 * conversation (sandboxed iframe). Otherwise we fall back to the default
 * collapsible tool display. This is the host-side half of MCP Apps; the UI
 * itself is shipped by the MCP server (Compass = reference implementation).
 */
export const McpAppToolFallback: ToolCallMessagePartComponent = (props) => {
  // Same remoteId-first fallback used elsewhere for the server-side thread id
  // (composer-activated-skills.tsx, right-panel panels): the local composer id
  // until the thread's first message assigns a server remoteId/externalId.
  const localId = useAuiState((s) => s.threadListItem.id);
  const remoteId = useAuiState((s) => s.threadListItem.remoteId ?? s.threadListItem.externalId);
  const threadId = remoteId ?? localId ?? undefined;
  // 撤销要知道改的是哪个项目的文件 —— 用这条线程钉着的那个项目(和工具当时用的
  // 是同一个:工具走的也是会话钉定)。钉定同时也是 widget 映射的作用域,所以它
  // 必须在 useAppTools 之前算出来。
  const threadProjects = useThreadProjects();
  const pinnedProjectId = threadId ? threadProjects[threadId] : undefined;
  const appTools = useAppTools(threadId, pinnedProjectId);
  const mcpHost = useMemo(() => McpAppsRemoteHost({ url: mcpHostUrl(threadId) }), [threadId]);
  const p = props as unknown as Record<string, unknown>;


  // **工具名要两种形状都认。** AI SDK v5 的 part 把名字编进 `type`
  // (`tool-get_gantt`),只读 `p.toolName` 会拿到 undefined —— 于是查不到 ui://
  // 资源,widget 全体静默消失:界面不报错,agent 照样答话、还声称"图已渲染"
  // (实测,用户报「甘特图现在不行了」)。仓里 tool-group 一直是两种都认的。
  const uri = appTools[toolPartName(p) ?? ''];
  // getMcpAppFromToolPart (inside McpAppRenderer) reads the part's `.mcp.app`.
  // Inject it for tools that declare a ui:// resource so the app renders inline.
  const part = uri
    ? ({ ...p, mcp: { app: { resourceUri: uri } } } as unknown as typeof props)
    : props;
  const { render: Render } = useResource(
    McpAppRenderer({ host: mcpHost, fallback: <ToolFallback {...props} /> }),
  );

  // 修正桥, in-chat context: the widget's "这里不对?" prefills the CURRENT
  // thread's composer (host context = this thread; no new thread, no re-pin).
  // The scene label here is the sanitized display-text claim from the widget —
  // this context has no host-side scene knowledge. Draft only; never sent.
  const { t } = useTranslation();
  const aui = useAui();
  const handleCorrection = useCallback(
    (p: CorrectionPayload) => {
      const spec = correctionDraftSpec(p.scene, p);
      const draft = t(spec.key, spec.vars);
      aui.composer().setText(draft);
      placeComposerCaret(draft.length);
    },
    [aui, t],
  );

  // 约束驾驶舱 → 排产表 (排产即导航): the cockpit widget's "展开排产表" drill opens
  // the schedule grid AND positions it — the "open the map, positioned" step.
  // Same host-context rule as the correction bridge: the grid is THIS thread's
  // schedule (from panel context), never selected by the message. focusScheduleFilter
  // opens the panel and stashes the OpenGridFilter for the grid to apply client-side.
  const { focusScheduleFilter } = usePanelTabs();
  const handleOpenGrid = useCallback(
    (filter: OpenGridFilter) => {
      void focusScheduleFilter(filter);
    },
    [focusScheduleFilter],
  );

  // 文档修改自己有一块界面:红绿对照 + 一键撤销。**改已经发生了**,这里不是问
  // "要不要改",是让人看见改了什么、并且退得回去(版本+回退当安全网)。
  //
  // **这个分支必须放在所有 hook 之后。** 一开始写成了提前 return,结果整个界面
  // 崩在 "Rendered fewer hooks than expected" —— 类型和单测都看不见,一跑就白屏。
  if (p.toolName === 'document_edit' && p.result && typeof p.result === 'object') {
    const args = (p.args ?? {}) as { name?: string };
    return (
      <DocumentEditResult
        result={p.result as Parameters<typeof DocumentEditResult>[0]['result']}
        {...(pinnedProjectId ? { projectId: pinnedProjectId } : {})}
        {...(args.name ? { name: args.name } : {})}
      />
    );
  }

  return (
    <McpAppActionBridge onCorrection={handleCorrection} onOpenGrid={handleOpenGrid}>
      <Render {...part} />
    </McpAppActionBridge>
  );
};

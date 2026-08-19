/**
 * 把对话里那个 MCP App widget 摊到右侧面板上。
 *
 * **为什么要有这一格**:排产甘特这类图在对话流里天生挤 —— 消息栏就那么宽,一张
 * 跨三个月、几十条泳道的图,内联只能看见一角(用户原话:"显示不全,特别是排产
 * 这种图")。文件预览早就有"在右侧打开",widget 没道理没有。
 *
 * **同一个 widget,不是另做一版**:资源 uri、host、渲染器都和内联那条路共用,
 * 面板只提供尺寸。做两版意味着两处会各自漂移,而人分不清哪个是真的。
 */
import { useMemo, type FC, type ReactElement } from 'react';
import { McpAppRenderer, McpAppsRemoteHost } from '@assistant-ui/react';
import { useResource } from '@assistant-ui/tap';

import type { PanelContentProps } from '../panel-types';

export type WidgetPanelState = {
  /** 这条 widget 挂在哪个会话上 —— host 请求要按它取作用域。 */
  threadId?: string | undefined;
  /** `ui://widget/gantt.html` 这种。 */
  resourceUri?: string | undefined;
  /** 当时那次工具调用的原样片段(含 output),渲染器据此画图。 */
  part?: unknown;
};

export const WidgetPanel: FC<PanelContentProps> = ({ tab }) => {
  const s = (tab.state ?? {}) as WidgetPanelState;
  const host = useMemo(
    () =>
      McpAppsRemoteHost({
        url: s.threadId
          ? `/api/mcp-apps/host?threadId=${encodeURIComponent(s.threadId)}`
          : '/api/mcp-apps/host',
      }),
    [s.threadId],
  );
  const { render: Render } = useResource(
    McpAppRenderer({
      host,
      fallback: (
        <p className="text-muted-foreground p-6 text-sm">这张图打不开了 —— 回到对话里重新生成一次。</p>
      ),
    }),
  );

  if (!s.resourceUri || !s.part) {
    // 空状态说清**怎么才会有内容**,而不是干等 —— 面板可以先于内容存在。
    return (
      <p className="text-muted-foreground p-6 text-sm leading-relaxed">
        在对话里生成一张图(甘特、驾驶舱、场景卡),再点图上的「在右侧打开」。
      </p>
    );
  }

  const stored: Record<string, unknown> =
    s.part && typeof s.part === 'object' ? (s.part as Record<string, unknown>) : {};
  // 渲染器的 props 类型是 assistant-ui 的工具片段;我们存进 tab state 的是它的
  // 一份快照,形状一致但类型层面对不上 —— 这里显式过一道,别让类型噪音掩盖真问题。
  const RenderAny = Render as unknown as (p: Record<string, unknown>) => ReactElement;
  const part = { ...stored, mcp: { app: { resourceUri: s.resourceUri } } };
  return (
    // **让 widget 撑满面板。** 渲染器自己那层容器是按内联场景定的固定高(实测
    // 150px),iframe 只填满它 —— 于是"在右侧打开"之后图反而比对话里还小,
    // 完全没解决"显示不全"。面板的全部意义就是给尺寸,所以这里把直接子元素
    // 拉到满高;宽度本来就是 100%。
    <div className="h-full w-full p-2 [&>div]:h-full">
      <RenderAny {...part} />
    </div>
  );
};

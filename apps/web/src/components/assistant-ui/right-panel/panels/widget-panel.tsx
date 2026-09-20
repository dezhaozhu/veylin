/**
 * 把对话里那个 MCP App widget 摊到右侧面板上。
 *
 * **为什么要有这一格**:排产甘特这类图在对话流里天生挤 —— 消息栏就那么宽,一张
 * 跨三个月、几十条泳道的图,内联只能看见一角(用户原话:"显示不全,特别是排产
 * 这种图")。文件预览早就有"在右侧打开",widget 没道理没有。
 *
 * **同一个 widget,不是另做一版**:资源 uri、host、渲染器都和内联那条路共用,
 * 面板只提供尺寸。做两版意味着两处会各自漂移,而人分不清哪个是真的。
 *
 * ## 场景卡例外:走原生,iframe 只兜底
 *
 * 上面那条"同一个 widget"讲的是**不要再做一版 widget**。场景卡不一样 —— 仓里早就
 * 有一版原生的(`SceneCardSummaryPanel`,项目首页在用):结论前置的体检区 + 四格
 * KPI + 信任分/诚实度/规则命中三张图 + 分页详情。而 Compass 那个 widget 是五节等重
 * 的盒中盒,同一份事实在两个界面上专业程度差一截,人会以为是两种东西。
 *
 * 所以这里沿用项目首页已有的判定(`project-overview.tsx`:有合法 `display[]` 就走
 * 原生,否则退回 iframe),不是新发明一套策略。判定本体在 `scene-card-panel-input.ts`
 * —— 纯函数、有单测,顺带把 `display[]` 不投影的红线补回来,不让切换悄悄丢东西。
 */
import { useCallback, useMemo, type FC, type ReactElement } from 'react';
import { McpAppRenderer, McpAppsRemoteHost, useAui } from '@assistant-ui/react';
import { useResource } from '@assistant-ui/tap';
import { useTranslation } from 'react-i18next';

import { SceneCardSummaryPanel } from '@/components/features/project-page/scene-card-summary-panel';
import { sceneCardPanelInput } from '@/components/features/project-page/scene-card-panel-input';
import { placeComposerCaret } from '@/lib/composer-caret';
import { correctionDraftSpec, type CorrectionPayload } from '@/lib/correction-bridge';
import { projectSourceLabel } from '@/lib/project-labels';
import { useThreadProjects } from '@/lib/thread-projects-sync';
import type { PanelContentProps } from '../panel-types';

export type WidgetPanelState = {
  /** 这条 widget 挂在哪个会话上 —— host 请求要按它取作用域。 */
  threadId?: string | undefined;
  /** `ui://widget/gantt.html` 这种。 */
  resourceUri?: string | undefined;
  /** 当时那次工具调用的原样片段(含 output),渲染器据此画图。 */
  part?: unknown;
};

/** Compass 真机是 `ui://widget/scene-card.html`,个别入口写成 `ui://compass/scene-card`。 */
function isSceneCardUri(uri: string | undefined): boolean {
  return !!uri && /(?:^|\/)scene-card(?:\.html)?$/.test(uri);
}

export const WidgetPanel: FC<PanelContentProps> = ({ tab }) => {
  const s = (tab.state ?? {}) as WidgetPanelState;
  const { t } = useTranslation();
  const aui = useAui();
  const threadProjects = useThreadProjects();
  const pinnedProjectId = s.threadId ? threadProjects[s.threadId] : undefined;

  // 「报错」在这条路上的语义:填**当前**会话的输入框 —— 人已经在这条会话里了,
  // 再开一条新的(项目首页那套)等于把他从上下文里赶出去。和对话内联那条完全
  // 一致(`mcp-app-tool.tsx` 的 handleCorrection),只是那边的 scene 来自 widget
  // 消息里的展示文本,这边是宿主自己从 payload 的 tenant 认出来的。草稿只填不发。
  const handleReport = useCallback(
    (p: CorrectionPayload) => {
      const spec = correctionDraftSpec(projectSourceLabel(p.scene), p);
      const draft = t(spec.key, spec.vars);
      aui.composer().setText(draft);
      placeComposerCaret(draft.length);
    },
    [aui, t],
  );

  const sceneCard = useMemo(() => {
    if (!isSceneCardUri(s.resourceUri)) return null;
    const result = (s.part as { result?: unknown } | undefined)?.result;
    return sceneCardPanelInput(result, {
      redLineSection: t('projectPage.redLineSection'),
      redLineLabel: t('projectPage.redLineLabel'),
      redLineNone: t('projectPage.redLineNone'),
      redLineNoEffect: t('projectPage.redLineNoEffect'),
    });
  }, [s.resourceUri, s.part, t]);

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

  // 场景卡:能凑齐原生入参就走原生。面板本来就是"固定高、自己滚动"的长条,正好是
  // `SceneCardSummaryPanel` 设计的容器形状(`h-full min-h-0` + 内层滚动),高度不用改。
  //
  // `projectId` 在这条路上其实用不到 —— 基线关掉了,「报错」也由我们接管,面板里
  // 那个 `useOpenCorrection(projectId)` 建了不用。没有钉项目时给空串,不编一个 id。
  //
  // 已知的不一致:项目首页那条路还没接 `sceneCardPanelInput`,所以它的卡**没有**
  // 红线那一行。同一个组件两个宿主喂的行不一样,是该收的口子,但那边还牵着
  // "source 用页面遍历值 vs payload 的 tenant"的分歧(实测两者会不等),一起改。
  if (sceneCard) {
    return (
      <div className="h-full w-full p-2">
        <SceneCardSummaryPanel
          rows={sceneCard.rows}
          narrative={sceneCard.narrative}
          source={sceneCard.source}
          projectId={pinnedProjectId ?? ''}
          onReport={handleReport}
          trackVisits={false}
        />
      </div>
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

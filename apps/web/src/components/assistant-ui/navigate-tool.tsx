import { makeAssistantToolUI } from '@assistant-ui/react';
import { CompassIcon } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigateAnchor } from '@/components/assistant-ui/use-navigate-anchor';
import { shouldFireNavigate } from '@/lib/navigate-fire';

interface Args {
  kind: 'job' | 'order' | 'view' | 'resource' | 'rule';
  id: string;
  order_id?: string;
  at?: string;
  run_id?: string;
  op?: string;
  stage_code?: string;
  product_class?: string;
  workshop?: string;
  surface?: 'gantt' | 'grid' | 'both';
}

interface Result {
  ok: boolean;
  error?: string;
  anchor?: { kind: string; id: string; order_id?: string; at?: string; run_id?: string; op?: string };
  surface?: 'gantt' | 'grid' | 'both';
  issued_at?: number;
}

/** 本会话已经动作过的工具调用 —— 同一条结果重挂/StrictMode 会渲染多次。 */
const fired = new Set<string>();
const lastFiredAt = { value: 0 };

/**
 * agent 的 `navigate` 工具在对话里的样子:一行「已带你去看 …」。真正的动作
 * (拉开右栏、定位)在 effect 里走 useNavigateAnchor —— 和卡片点条同一个
 * handler。只对**刚发出**的结果动作(shouldFireNavigate),回看旧对话不再拉右栏。
 */
export const NavigateToolUI = makeAssistantToolUI<Args, Result>({
  toolName: 'navigate',
  render: ({ args, result, toolCallId }) => {
    const { t } = useTranslation();
    const navigateTo = useNavigateAnchor();

    useEffect(() => {
      const target = shouldFireNavigate(result, toolCallId, { now: Date.now(), seen: fired, lastFiredAt });
      if (target) navigateTo(target);
    }, [result, toolCallId, navigateTo]);

    if (!result) return null;
    const anchor = result.anchor ?? { kind: args?.kind ?? 'job', id: args?.id ?? '' };
    const key =
      anchor.kind === 'view' ? 'view'
      : anchor.kind === 'order' ? (result.surface === 'both' ? 'orderBoth' : 'order')
      : anchor.kind === 'resource' ? 'resource'
      : anchor.kind === 'rule' ? 'rule'
      : anchor.op ? 'op'
      : 'job';
    const where = result.ok
      ? t(`navigateTool.${key}`, { id: anchor.id, op: anchor.op ?? '' })
      : (result.error ?? t('navigateTool.failed'));
    return (
      <div className="text-muted-foreground my-1 flex items-center gap-1.5 text-xs">
        <CompassIcon className="size-3.5 shrink-0" />
        <span>{where}</span>
      </div>
    );
  },
});

/**
 * 一份文件的预览 —— **聊天里拖进来的和项目文件夹里的,长得一样**。
 *
 * 顺序是"画得出来优先于读得出来"(见 lib/document-preview):首页图 → 带版式的
 * HTML → 纯文字 → 文件卡。最后那一档是这次的重点:打不开的时候给一张卡和一个
 * 下载,而不是一句"没有可预览的内容" —— 那句话听起来像"这个文件是空的"。
 */
import { useEffect, useState, type FC, type ReactNode } from 'react';

import {
  previewMode,
  sandboxSrcDoc,
  type PreviewPayload,
} from '@/lib/document-preview';

/** 跟随主题:iframe 是另一个文档,拿不到我们的 CSS 变量,只能把颜色算好送进去。 */
function useIsDark(): boolean {
  const [dark, setDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  );
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const el = document.documentElement;
    const obs = new MutationObserver(() => setDark(el.classList.contains('dark')));
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

export const DocumentPreview: FC<{
  name: string;
  payload: PreviewPayload;
  /** 打不开时的出路:下载,或者在访达里显示。没有就不显示按钮。 */
  action?: ReactNode;
}> = ({ name, payload, action }) => {
  const dark = useIsDark();
  const mode = previewMode(payload);
  const ext = (name.split('.').pop() ?? '').toUpperCase();

  if (mode === 'none') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 py-10 text-center">
        <div className="bg-muted text-muted-foreground flex size-16 items-center justify-center rounded-xl text-xs font-medium">
          {ext || 'FILE'}
        </div>
        <p className="text-sm font-medium">{name}</p>
        {/* 说的是"我们打不开",不是"它是空的" —— 这两句话对人的意思完全不同。 */}
        <p className="text-muted-foreground max-w-sm text-xs leading-relaxed">
          {payload.note ?? '这个文件没法在这里打开。'}
        </p>
        {action}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {mode === 'image' ? (
        <div className="flex justify-center">
          <img
            src={payload.thumbnail}
            alt={`${name} 首页`}
            className="border-border max-h-[52vh] rounded-lg border object-contain shadow-sm"
          />
        </div>
      ) : null}

      {mode === 'html' ? (
        // 沙箱:这段 HTML 来自用户的文件,不是我们写的模板。不给 allow-scripts、
        // 不给 allow-same-origin,CSP 再断一次外连。
        <iframe
          title={`${name} 预览`}
          sandbox=""
          srcDoc={sandboxSrcDoc(payload.html!, dark)}
          className="min-h-0 w-full flex-1 rounded-lg border-0 bg-transparent"
        />
      ) : null}

      {(payload.text ?? payload.overview ?? '').trim() && mode !== 'html' ? (
        <pre className="text-foreground/90 min-h-0 flex-1 overflow-auto font-mono text-xs leading-relaxed whitespace-pre-wrap">
          {payload.text ?? payload.overview}
        </pre>
      ) : null}

      {payload.note ? (
        // 概览就说是概览 —— 不说,人会把前几行当成全部。
        <p className="text-muted-foreground shrink-0 text-xs">{payload.note}</p>
      ) : null}
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
};

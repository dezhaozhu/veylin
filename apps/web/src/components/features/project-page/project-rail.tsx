/**
 * 项目页右栏:**一张卡,内部细线分段**。
 *
 * 学 Claude 的结构(用户指出我们那版"没有设计感、不简洁"):每段 = 标题 + 右侧
 * 一个动作 + 一句灰色说明;没有内容时给一个浅底空状态,说清**放什么**,
 * 而不是常驻一个输入框占着位置。
 *
 * 两条自定规矩:
 * - **段落永远在,内容可以没有。** 内容为空就整段消失的话,人不知道这里可以放
 *   东西 —— 空状态本身是信息。
 * - **输入框藏在动作后面。** 一个永远摊开的输入框会和标题、按钮抢注意力,而它
 *   一年只用一次。
 */
import { useState, type FC, type ReactNode } from 'react';

export const RailCard: FC<{ children: ReactNode }> = ({ children }) => (
  <div className="border-border divide-border bg-card/40 divide-y rounded-xl border">
    {children}
  </div>
);

export const RailSection: FC<{
  title: string;
  /**
   * 右上角那个动作。**给图标,不给字。**
   *
   * 从前是「改」「加」「换」「全部」四个汉字按钮,挤在标题右边,四段各说各的,
   * 一眼扫过去像四个不相干的链接(用户原话:太丑)。改成同一位置、同一尺寸的
   * 图标钮:形状承担"这是个按钮",文字退到 tooltip 里当解释。
   */
  action?: { icon: ReactNode; label: string; onClick: () => void };
  /** 一句话:没内容时说"放什么",有内容时可以不给。 */
  hint?: string;
  children?: ReactNode;
}> = ({ title, action, hint, children }) => (
  <section className="px-3 py-3">
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-foreground text-sm font-medium">{title}</h3>
      {action ? (
        <button
          type="button"
          title={action.label}
          aria-label={action.label}
          onClick={action.onClick}
          className="text-muted-foreground hover:bg-muted hover:text-foreground -mr-1 flex size-7 shrink-0 items-center justify-center rounded-md transition-colors"
        >
          {action.icon}
        </button>
      ) : null}
    </div>
    {hint ? <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p> : null}
    {children ? <div className="mt-2">{children}</div> : null}
  </section>
);

/** 浅底空状态:一句话说清放什么。空白会被读成"这儿本来就没东西"。 */
export const RailEmpty: FC<{ children: ReactNode }> = ({ children }) => (
  <div className="bg-muted/40 text-muted-foreground rounded-lg px-3 py-6 text-center text-xs leading-relaxed">
    {children}
  </div>
);

/** 点开才出现的输入行 —— 常驻的话会和标题、按钮抢注意力。 */
export const RailInlineInput: FC<{
  placeholder: string;
  submitLabel: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}> = ({ placeholder, submitLabel, onSubmit, onCancel }) => {
  const [v, setV] = useState('');
  return (
    <div className="mt-2 flex items-center gap-1.5">
      <input
        autoFocus
        className="border-input h-7 min-w-0 flex-1 rounded border px-2 text-xs"
        placeholder={placeholder}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && v.trim()) onSubmit(v.trim());
          if (e.key === 'Escape') onCancel();
        }}
      />
      <button
        type="button"
        disabled={!v.trim()}
        onClick={() => onSubmit(v.trim())}
        className="hover:bg-muted shrink-0 rounded border px-2 py-1 text-xs disabled:opacity-40"
      >
        {submitLabel}
      </button>
    </div>
  );
};

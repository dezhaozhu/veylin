"use client";

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type FC,
  type PropsWithChildren,
} from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { ChevronDownIcon } from "lucide-react";
import {
  useScrollLock,
  useAuiState,
  type ReasoningMessagePartComponent,
  type ReasoningGroupComponent,
} from "@assistant-ui/react";
import { useTranslation } from "react-i18next";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import {
  CollapsiblePanelContext,
  useCollapsiblePanel,
} from "@/components/assistant-ui/collapsible-panel-context";
import {
  useStreamingCollapsible,
  useStreamingDuration,
  useGroupStreaming,
} from "@/components/assistant-ui/collapsible-streaming";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const ANIMATION_DURATION = 200;
const STREAMING_MAX_HEIGHT = "max-h-36";

const ReasoningPreviewContext = createContext(false);

const reasoningVariants = cva("aui-reasoning-root w-full", {
  variants: {
    variant: {
      outline: "rounded-lg border px-3 py-2",
      ghost: "",
      muted: "bg-muted/50 rounded-lg px-3 py-2",
    },
  },
  defaultVariants: {
    variant: "ghost",
  },
});

export type ReasoningRootProps = Omit<
  React.ComponentProps<typeof Collapsible>,
  "open" | "onOpenChange"
> &
  VariantProps<typeof reasoningVariants> & {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    defaultOpen?: boolean;
    streaming?: boolean;
  };

function ReasoningRoot({
  className,
  variant,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen = false,
  streaming,
  children,
  ...props
}: ReasoningRootProps) {
  const collapsibleRef = useRef<HTMLDivElement>(null);
  const lockScroll = useScrollLock(collapsibleRef, ANIMATION_DURATION);
  const { isOpen, handleOpenChange } = useStreamingCollapsible(
    streaming,
    controlledOpen,
    controlledOnOpenChange,
    defaultOpen,
  );
  const isPreview = streaming === true && isOpen;

  const prevStreamingRef = useRef(streaming);
  useLayoutEffect(() => {
    if (prevStreamingRef.current === streaming) return;
    prevStreamingRef.current = streaming;
    if (controlledOpen === undefined) lockScroll();
  }, [streaming, controlledOpen, lockScroll]);

  const onOpenChange = useCallback(
    (open: boolean) => {
      lockScroll();
      handleOpenChange(open);
    },
    [lockScroll, handleOpenChange],
  );

  return (
    <CollapsiblePanelContext.Provider
      value={{ isOpen, isStreaming: streaming === true }}
    >
      <Collapsible
        ref={collapsibleRef}
        data-slot="reasoning-root"
        data-variant={variant}
        data-streaming={streaming ? "" : undefined}
        open={isOpen}
        onOpenChange={onOpenChange}
        className={cn(
          "group/reasoning-root",
          reasoningVariants({ variant, className }),
        )}
        style={
          {
            "--animation-duration": `${ANIMATION_DURATION}ms`,
          } as React.CSSProperties
        }
        {...props}
      >
        <ReasoningPreviewContext.Provider value={isPreview}>
          {children}
        </ReasoningPreviewContext.Provider>
      </Collapsible>
    </CollapsiblePanelContext.Provider>
  );
}

function ReasoningFade({
  side = "bottom",
  className,
  ...props
}: React.ComponentProps<"div"> & { side?: "top" | "bottom" }) {
  if (side === "top") {
    return (
      <div
        data-slot="reasoning-fade"
        className={cn(
          "aui-reasoning-fade pointer-events-none absolute inset-x-0 top-0 z-10 h-6",
          "bg-[linear-gradient(to_bottom,var(--color-background),transparent)]",
          className,
        )}
        {...props}
      />
    );
  }

  return (
    <div
      data-slot="reasoning-fade"
      className={cn(
        "aui-reasoning-fade pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6",
        "bg-[linear-gradient(to_top,var(--color-background),transparent)]",
        className,
      )}
      {...props}
    />
  );
}

function ReasoningTrigger({
  active,
  duration,
  className,
  ...props
}: React.ComponentProps<typeof CollapsibleTrigger> & {
  active?: boolean;
  duration?: number;
}) {
  const { t } = useTranslation();
  const { isOpen } = useCollapsiblePanel();
  const label = t("reasoning.thought");
  const ariaLabel =
    duration != null && duration > 0
      ? t("reasoning.thoughtDuration", { seconds: duration })
      : label;

  return (
    <CollapsibleTrigger
      data-slot="reasoning-trigger"
      aria-label={ariaLabel}
      className={cn(
        "aui-reasoning-trigger text-muted-foreground flex w-fit max-w-full cursor-pointer items-center gap-1.5 text-base leading-snug transition-colors",
        "hover:text-foreground",
        !isOpen && "-mx-1 rounded-sm px-1 hover:bg-muted/40",
        className,
      )}
      {...props}
    >
      <span className="aui-reasoning-trigger-label relative inline-block">
        <span>{label}</span>
        {active ? (
          <span
            aria-hidden
            className="aui-reasoning-trigger-shimmer shimmer pointer-events-none absolute inset-0 motion-reduce:animate-none"
          >
            {label}
          </span>
        ) : null}
      </span>
      <ChevronDownIcon
        className={cn(
          "aui-reasoning-trigger-chevron size-4 shrink-0 opacity-50 transition-transform duration-200",
          isOpen ? "rotate-0" : "-rotate-90",
        )}
      />
    </CollapsibleTrigger>
  );
}

function ReasoningContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CollapsibleContent>) {
  return (
    <CollapsibleContent
      data-slot="reasoning-content"
      className={cn(
        "aui-reasoning-content relative mt-2 text-base outline-none",
        "data-[state=closed]:hidden",
        className,
      )}
      style={{ "--animation-duration": `${ANIMATION_DURATION}ms` } as React.CSSProperties}
      {...props}
    >
      {children}
    </CollapsibleContent>
  );
}

function ReasoningText({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const isPreview = useContext(ReasoningPreviewContext);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isPreview) return;
    const scrollEl = scrollRef.current;
    const contentEl = contentRef.current;
    if (!scrollEl || !contentEl) return;
    const pin = () => {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    };
    pin();
    const observer = new ResizeObserver(pin);
    observer.observe(contentEl);
    return () => observer.disconnect();
  }, [isPreview]);

  return (
    <div
      ref={scrollRef}
      data-slot="reasoning-text"
      className={cn(
        "aui-reasoning-text text-muted-foreground relative flex flex-col gap-1.5 overflow-y-auto border-l border-border ps-3",
        isPreview && STREAMING_MAX_HEIGHT,
        className,
      )}
      {...props}
    >
      {isPreview ? <ReasoningFade side="top" /> : null}
      <div ref={contentRef} className="aui-reasoning-text-content space-y-2 leading-relaxed">
        {children}
      </div>
      {isPreview ? <ReasoningFade /> : null}
    </div>
  );
}

const ReasoningImpl: ReasoningMessagePartComponent = () => <MarkdownText />;

const ReasoningGroupImpl: ReasoningGroupComponent = ({
  children,
  startIndex,
  endIndex,
}) => {
  const isReasoningStreaming = useAuiState((s) => {
    if (s.message.status?.type !== "running") return false;
    const lastIndex = s.message.parts.length - 1;
    if (lastIndex < 0) return false;
    const lastType = s.message.parts[lastIndex]?.type;
    if (lastType !== "reasoning") return false;
    return lastIndex >= startIndex && lastIndex <= endIndex;
  });
  const duration = useStreamingDuration(isReasoningStreaming);

  return (
    <ReasoningRoot streaming={isReasoningStreaming}>
      <ReasoningTrigger active={isReasoningStreaming} duration={duration} />
      <ReasoningContent aria-busy={isReasoningStreaming}>
        <ReasoningText>{children}</ReasoningText>
      </ReasoningContent>
    </ReasoningRoot>
  );
};

const Reasoning = memo(
  ReasoningImpl,
) as unknown as ReasoningMessagePartComponent & {
  Root: typeof ReasoningRoot;
  Trigger: typeof ReasoningTrigger;
  Content: typeof ReasoningContent;
  Text: typeof ReasoningText;
  Fade: typeof ReasoningFade;
};

Reasoning.displayName = "Reasoning";
Reasoning.Root = ReasoningRoot;
Reasoning.Trigger = ReasoningTrigger;
Reasoning.Content = ReasoningContent;
Reasoning.Text = ReasoningText;
Reasoning.Fade = ReasoningFade;

const ReasoningGroup = memo(ReasoningGroupImpl);
ReasoningGroup.displayName = "ReasoningGroup";

export const ReasoningGroupBlock: FC<
  PropsWithChildren<{ indices: readonly number[] }>
> = ({ indices, children }) => {
  const streaming = useGroupStreaming(indices);
  const duration = useStreamingDuration(streaming);

  return (
    <ReasoningRoot variant="ghost" streaming={streaming}>
      <ReasoningTrigger active={streaming} duration={duration} />
      <ReasoningContent aria-busy={streaming}>
        <ReasoningText>{children}</ReasoningText>
      </ReasoningContent>
    </ReasoningRoot>
  );
};

export {
  Reasoning,
  ReasoningGroup,
  ReasoningRoot,
  ReasoningTrigger,
  ReasoningContent,
  ReasoningText,
  ReasoningFade,
  reasoningVariants,
};

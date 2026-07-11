"use client";

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type FC,
  type PropsWithChildren,
} from "react";
import { ChevronDownIcon } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { useScrollLock, useAuiState } from "@assistant-ui/react";
import { useStreamingCollapsible, useGroupStreaming } from "@/components/assistant-ui/collapsible-streaming";
import {
  CollapsiblePanelContext,
  useCollapsiblePanel,
} from "@/components/assistant-ui/collapsible-panel-context";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useTranslation } from "react-i18next";
import { summarizeToolCalls } from "@/lib/summarize-tool-calls";
import {
  sumTableToolDiffs,
  type TableToolDiff,
} from "@/lib/table-tool-diff";
import { RollingNumber } from "@/components/assistant-ui/rolling-number";
import { cn } from "@/lib/utils";

const ANIMATION_DURATION = 200;
const STREAMING_MAX_HEIGHT = "max-h-36";

type ToolPartSnapshot = {
  toolName: string;
  args?: unknown;
  result?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function readToolPartSnapshot(part: unknown): ToolPartSnapshot | null {
  if (!isRecord(part) || typeof part.type !== "string") return null;

  let toolName = "";
  if (part.type === "tool-call" && typeof part.toolName === "string") {
    toolName = part.toolName;
  } else if (part.type.startsWith("tool-")) {
    toolName = part.type.slice("tool-".length);
  }
  if (!toolName) return null;

  const args =
    "args" in part
      ? part.args
      : "input" in part
        ? part.input
        : undefined;
  const result =
    "result" in part
      ? part.result
      : "output" in part
        ? part.output
        : undefined;

  return { toolName, args, result };
}

export const ToolGroupStreamingContext = createContext(false);

export function useToolGroupStreaming() {
  return useContext(ToolGroupStreamingContext);
}

const toolGroupVariants = cva("aui-tool-group-root group/tool-group w-full", {
  variants: {
    variant: {
      outline: "rounded-lg border py-3",
      ghost: "",
      muted: "rounded-lg border border-muted-foreground/30 bg-muted/30 py-3",
    },
  },
  defaultVariants: { variant: "ghost" },
});

export type ToolGroupRootProps = Omit<
  React.ComponentProps<typeof Collapsible>,
  "open" | "onOpenChange"
> &
  VariantProps<typeof toolGroupVariants> & {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    defaultOpen?: boolean;
    streaming?: boolean;
  };

function ToolGroupRoot({
  className,
  variant,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen = false,
  streaming,
  children,
  ...props
}: ToolGroupRootProps) {
  const collapsibleRef = useRef<HTMLDivElement>(null);
  const lockScroll = useScrollLock(collapsibleRef, ANIMATION_DURATION);
  const { isOpen, handleOpenChange } = useStreamingCollapsible(
    streaming,
    controlledOpen,
    controlledOnOpenChange,
    defaultOpen,
  );

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
      <ToolGroupStreamingContext.Provider value={streaming === true}>
        <Collapsible
          ref={collapsibleRef}
          data-slot="tool-group-root"
          data-variant={variant ?? "ghost"}
          data-streaming={streaming ? "" : undefined}
          open={isOpen}
          onOpenChange={onOpenChange}
          className={cn(
            toolGroupVariants({ variant }),
            "group/tool-group-root",
            className,
          )}
          style={
            {
              "--animation-duration": `${ANIMATION_DURATION}ms`,
            } as React.CSSProperties
          }
          {...props}
        >
          {children}
        </Collapsible>
      </ToolGroupStreamingContext.Provider>
    </CollapsiblePanelContext.Provider>
  );
}

function ToolGroupTrigger({
  count,
  summary,
  diff,
  active = false,
  className,
  ...props
}: React.ComponentProps<typeof CollapsibleTrigger> & {
  count: number;
  summary?: string;
  diff?: TableToolDiff;
  active?: boolean;
}) {
  const { t } = useTranslation();
  const { isOpen } = useCollapsiblePanel();
  const collapsedLabel =
    summary ?? t("toolGroup.toolCalls", { count });
  const showDiff = Boolean(diff && (diff.added > 0 || diff.removed > 0));

  return (
    <CollapsibleTrigger
      data-slot="tool-group-trigger"
      className={cn(
        "aui-tool-group-trigger group/trigger text-muted-foreground/50 flex w-fit max-w-full cursor-pointer items-center gap-1.5 text-base font-normal leading-snug transition-colors",
        "hover:text-muted-foreground",
        !isOpen && "-mx-1 rounded-sm px-1 hover:bg-muted/40",
        className,
      )}
      {...props}
    >
      <span className="aui-tool-group-trigger-label relative inline-flex max-w-full items-baseline gap-1.5">
        <span className="relative inline-block">
          <span>{collapsedLabel}</span>
          {active ? (
            <span
              aria-hidden
              className="aui-tool-group-trigger-shimmer shimmer pointer-events-none absolute inset-0 motion-reduce:animate-none"
            >
              {collapsedLabel}
            </span>
          ) : null}
        </span>
        {showDiff && diff!.added > 0 ? (
          <RollingNumber
            value={diff!.added}
            prefix="+"
            className="text-emerald-600"
          />
        ) : null}
        {showDiff && diff!.removed > 0 ? (
          <RollingNumber
            value={diff!.removed}
            prefix="-"
            className="text-red-600"
          />
        ) : null}
      </span>
      <ChevronDownIcon
        className={cn(
          "aui-tool-group-trigger-chevron size-4 shrink-0 opacity-0 transition-[opacity,transform] duration-200 group-hover/trigger:opacity-50",
          isOpen ? "rotate-0" : "-rotate-90",
        )}
      />
    </CollapsibleTrigger>
  );
}

function ToolGroupContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CollapsibleContent>) {
  const { isStreaming } = useCollapsiblePanel();

  return (
    <CollapsibleContent
      data-slot="tool-group-content"
      className={cn(
        "aui-tool-group-content relative mt-2 text-base outline-none",
        "data-[state=closed]:hidden",
        className,
      )}
      style={{ "--animation-duration": `${ANIMATION_DURATION}ms` } as React.CSSProperties}
      {...props}
    >
      <div
        className={cn(
          "flex flex-col gap-1.5 overflow-y-auto border-l border-border/60 ps-3 text-base font-normal leading-snug text-muted-foreground/50",
          isStreaming && STREAMING_MAX_HEIGHT,
        )}
      >
        {children}
      </div>
    </CollapsibleContent>
  );
}

function useToolSnapshotsFromIndices(
  indices: readonly number[],
): ToolPartSnapshot[] {
  const snapshotsKey = useAuiState((s) =>
    JSON.stringify(
      indices
        .map((i) => readToolPartSnapshot(s.message.parts[i]))
        .filter((part): part is ToolPartSnapshot => part != null),
    ),
  );
  return snapshotsKey ? (JSON.parse(snapshotsKey) as ToolPartSnapshot[]) : [];
}

export const ToolGroupBlock: FC<
  PropsWithChildren<{ indices: readonly number[] }>
> = ({ indices, children }) => {
  const streaming = useGroupStreaming(indices);
  const snapshots = useToolSnapshotsFromIndices(indices);
  const toolNames = snapshots.map((item) => item.toolName);
  const summary = summarizeToolCalls(toolNames);
  const diff = sumTableToolDiffs(snapshots);

  return (
    <ToolGroupRoot variant="ghost" streaming={streaming}>
      <ToolGroupTrigger
        count={indices.length}
        summary={summary}
        diff={diff}
        active={streaming}
      />
      <ToolGroupContent>{children}</ToolGroupContent>
    </ToolGroupRoot>
  );
};

type ToolGroupComponent = FC<
  PropsWithChildren<{ startIndex: number; endIndex: number }>
> & {
  Root: typeof ToolGroupRoot;
  Trigger: typeof ToolGroupTrigger;
  Content: typeof ToolGroupContent;
};

const ToolGroupImpl: FC<
  PropsWithChildren<{ startIndex: number; endIndex: number }>
> = ({ children, startIndex, endIndex }) => {
  const indices = Array.from(
    { length: endIndex - startIndex + 1 },
    (_, i) => startIndex + i,
  );
  const toolCount = indices.length;
  const snapshots = useToolSnapshotsFromIndices(indices);
  const toolNames = snapshots.map((item) => item.toolName);
  const summary = summarizeToolCalls(toolNames);
  const diff = sumTableToolDiffs(snapshots);

  return (
    <ToolGroupRoot>
      <ToolGroupTrigger count={toolCount} summary={summary} diff={diff} />
      <ToolGroupContent>{children}</ToolGroupContent>
    </ToolGroupRoot>
  );
};

const ToolGroup = memo(ToolGroupImpl) as unknown as ToolGroupComponent;

ToolGroup.displayName = "ToolGroup";
ToolGroup.Root = ToolGroupRoot;
ToolGroup.Trigger = ToolGroupTrigger;
ToolGroup.Content = ToolGroupContent;

export {
  ToolGroup,
  ToolGroupRoot,
  ToolGroupTrigger,
  ToolGroupContent,
  toolGroupVariants,
};

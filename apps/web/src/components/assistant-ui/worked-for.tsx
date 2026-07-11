"use client";

import { type FC, type PropsWithChildren } from "react";
import { ChevronDownIcon } from "lucide-react";
import { useMessageTiming } from "@assistant-ui/react";
import { useTranslation } from "react-i18next";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { CollapsiblePanelContext } from "@/components/assistant-ui/collapsible-panel-context";
import { cn } from "@/lib/utils";

function secondsFromTimingMs(ms: number | undefined): number | undefined {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return undefined;
  return Math.max(1, Math.round(ms / 1000));
}

/**
 * Cursor-style "Worked for Xs" shell. When the turn folds into multiple
 * group-worked-for islands (split by visible prose), the parent coordinates
 * `isPrimary` / `open` so only one label is shown and secondaries follow.
 */
export const WorkedForBlock: FC<
  PropsWithChildren<{
    elapsedSeconds?: number;
    /** First island renders the trigger; later islands only show when open. */
    isPrimary?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }>
> = ({
  children,
  elapsedSeconds,
  isPrimary = true,
  open = false,
  onOpenChange,
}) => {
  const { t } = useTranslation();
  const timing = useMessageTiming();

  if (!isPrimary) {
    if (!open) return null;
    return <div className="flex flex-col gap-2">{children}</div>;
  }

  const seconds =
    secondsFromTimingMs(timing?.totalStreamTime) ??
    (elapsedSeconds != null && elapsedSeconds > 0 ? elapsedSeconds : undefined);

  const label =
    seconds != null
      ? t("reasoning.workedFor", { seconds })
      : t("reasoning.workedForNoDuration");

  return (
    <Collapsible
      data-slot="aui_worked-for"
      open={open}
      onOpenChange={onOpenChange}
      className="aui-worked-for-root w-full"
    >
      <CollapsiblePanelContext.Provider
        value={{ isOpen: open, isStreaming: false }}
      >
        <CollapsibleTrigger
          data-slot="aui_worked-for-trigger"
          aria-label={label}
          className={cn(
            "aui-worked-for-trigger group/trigger text-muted-foreground/50 flex w-fit max-w-full cursor-pointer items-center gap-1.5 text-base font-normal leading-snug transition-colors",
            "hover:text-muted-foreground",
            !open && "-mx-1 rounded-sm px-1 hover:bg-muted/40",
          )}
        >
          <span className="aui-worked-for-trigger-label">{label}</span>
          <ChevronDownIcon
            className={cn(
              "aui-worked-for-trigger-chevron size-4 shrink-0 opacity-0 transition-[opacity,transform] duration-200 group-hover/trigger:opacity-50",
              open ? "rotate-0" : "-rotate-90",
            )}
          />
        </CollapsibleTrigger>
        <CollapsibleContent
          data-slot="aui_worked-for-content"
          className="aui-worked-for-content overflow-hidden data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
        >
          <div className="mt-2 flex flex-col gap-2">{children}</div>
        </CollapsibleContent>
      </CollapsiblePanelContext.Provider>
    </Collapsible>
  );
};

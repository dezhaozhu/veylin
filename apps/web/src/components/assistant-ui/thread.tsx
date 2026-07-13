import { UserMessageChipsRow, userMessageHasDisplayChips } from "@/components/assistant-ui/user-message-chips-row";
import { UserMessageText } from "@/components/assistant-ui/user-message-text";
import { AssistantMarkdownText, MarkdownText } from "@/components/assistant-ui/markdown-text";
import {
  Reasoning,
  ReasoningGroupBlock,
} from "@/components/assistant-ui/reasoning";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { ToolGroupBlock } from "@/components/assistant-ui/tool-group";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { ComposerContextUsage } from "@/components/assistant-ui/composer-context-usage";
import { ComposerChipsRow } from "@/components/assistant-ui/composer-mention/composer-chips-row";
import { ComposerAttachmentDropzone } from "@/components/assistant-ui/composer-attachment-dropzone";
import { ComposerMentionInput } from "@/components/assistant-ui/composer-mention/composer-mention-input";
import { ComposerModeChips } from "@/components/assistant-ui/composer-mode-chips";
import { ComposerPlusMenu } from "@/components/assistant-ui/composer-plus-menu";
import { ComposerStatusBar } from "@/components/assistant-ui/composer-status-bar";
import { ComposerAskPanel } from "@/components/assistant-ui/composer-ask-panel";
import {
  ComposerQueue,
  useComposerSubmitKeys,
} from "@/components/assistant-ui/composer-queue";
import {
  NetworkReconnectInAssistant,
  NetworkReconnectThreadFallback,
} from "@/components/assistant-ui/network-reconnect-inline";
import { ModelPicker } from "@/components/assistant-ui/model-picker";
import { MessageTimestamp } from "@/components/assistant-ui/message-timestamp";
import { MessageKnowledgeCitations } from "@/components/assistant-ui/message-knowledge-citations";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { formatChatError } from "@/lib/format-chat-error";
import { useMessageError } from "@assistant-ui/core/react";
import { AlertCircleIcon } from "lucide-react";
import {
  ActionBarPrimitive,
  AuiIf,
  type AssistantState,
  ComposerPrimitive,
  ErrorPrimitive,
  groupPartByType,
  type GroupByContext,
  MessagePrimitive,
  type PartState,
  ThreadPrimitive,
  type ToolCallMessagePartComponent,
  useAuiState,
} from "@assistant-ui/react";
import { useAui } from "@assistant-ui/store";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  CopyIcon,
  PencilIcon,
  SquareIcon,
} from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type FC,
  type PropsWithChildren,
} from "react";
import {
  getAskUserSessionForThread,
  subscribeAskUserSession,
} from "@/lib/ask-user-question-session";
import {
  findFinalProseIndex,
  findLastFrontendSuspendToolIndex,
  hasPreFinalWork,
  isFinalProsePart,
} from "@/lib/assistant-final-output";
import { isFrontendSuspendPartsSettled } from "@/lib/frontend-suspend-tools";
import { usePlanModeBridge, useGoalLoopBridge } from "@/lib/use-composer-settings";
import { dispatchOverlayDismiss } from "@/lib/overlay-dismiss";
import { hideWebView, isTauri } from "@/lib/tauri-web-view";
import { isTaskNotificationText } from "@veylin/shared";
import {
  getHistoryLoadState,
  retryHistoryLoad,
  subscribeHistoryLoadState,
} from "@/lib/history-load-state";
import { WorkedForBlock } from "@/components/assistant-ui/worked-for";
import { useStreamingDuration } from "@/components/assistant-ui/collapsible-streaming";

export type ThreadGroupPart = MessagePrimitive.GroupedParts.GroupPart;

type AssistantGroupKey =
  | "group-worked-for"
  | "group-chainOfThought"
  | "group-reasoning"
  | "group-prose"
  | "group-tool"
  | "group-final-prose";

const baseAssistantGroupBy = groupPartByType({
  reasoning: ["group-chainOfThought", "group-reasoning"],
  text: ["group-chainOfThought", "group-prose"],
  "tool-call": ["group-chainOfThought", "group-tool"],
  "standalone-tool-call": [],
});

/**
 * Optional component overrides for the thread. `AssistantMessage` and
 * `Welcome` replace whole sections; the remaining slots override how the
 * assistant message renders tool calls and part groups. Tool UIs registered
 * by name (toolkit `render`, `useAssistantDataUI`) take precedence over
 * `ToolFallback`.
 */
export type ThreadComponents = {
  AssistantMessage?: ComponentType | undefined;
  Welcome?: ComponentType | undefined;
  ToolFallback?: ToolCallMessagePartComponent | undefined;
  ToolGroup?:
    | ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>>
    | undefined;
  ReasoningGroup?:
    | ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>>
    | undefined;
};

export type ThreadProps = {
  components?: ThreadComponents | undefined;
};

const EMPTY_COMPONENTS: ThreadComponents = {};

const ThreadComponentsContext =
  createContext<ThreadComponents>(EMPTY_COMPONENTS);

// Startup exposes a loading placeholder thread; treat it as a new chat so
// the composer mounts centered. Loads after startup keep the docked layout.
// History threads with remoteId must not show Welcome while empty (loading or
// error) — that looked like a blank conversation.
const isNewChatView = (s: AssistantState) => {
  if (s.thread.messages.length > 0) return false;
  if (s.threadListItem.remoteId) return false;
  return !s.thread.isLoading || s.threads.isLoading;
};

export const Thread: FC<ThreadProps> = ({ components = EMPTY_COMPONENTS }) => {
  const isEmpty = useAuiState(isNewChatView);
  const hasNoMessages = useAuiState((s) => s.thread.messages.length === 0);

  return (
    <ThreadComponentsContext.Provider value={components}>
      <ThreadRoot isEmpty={isEmpty} hasNoMessages={hasNoMessages} />
    </ThreadComponentsContext.Provider>
  );
};

const ThreadRoot: FC<{ isEmpty: boolean; hasNoMessages: boolean }> = ({
  isEmpty,
  hasNoMessages,
}) => {
  const { t } = useTranslation();
  const { Welcome = ThreadWelcome } = useContext(ThreadComponentsContext);
  const threadId = useAuiState((s) => s.threadListItem.id);
  const remoteId = useAuiState((s) => s.threadListItem.remoteId);
  const threadLoading = useAuiState((s) => s.thread.isLoading);
  const historyLoad = useSyncExternalStore(
    subscribeHistoryLoadState,
    getHistoryLoadState,
    getHistoryLoadState,
  );
  const historyError =
    remoteId && historyLoad.remoteId === remoteId ? historyLoad.error : null;
  const showHistoryStatus =
    Boolean(remoteId) &&
    hasNoMessages &&
    (threadLoading || Boolean(historyError));
  usePlanModeBridge();
  useGoalLoopBridge();
  const askOpen = useSyncExternalStore(
    subscribeAskUserSession,
    () => getAskUserSessionForThread(threadId) != null,
    () => false,
  );

  useEffect(() => {
    dispatchOverlayDismiss('thread-switch');
    if (isTauri()) void hideWebView(undefined, { force: true });
  }, [threadId]);

  useEffect(() => {
    if (!isTauri() || !askOpen) return;
    void hideWebView(undefined, { force: true });
    return subscribeAskUserSession(() => {
      if (getAskUserSessionForThread(threadId) != null) {
        void hideWebView(undefined, { force: true });
      }
    });
  }, [askOpen, threadId]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    void import('@/lib/dev-test-hooks').then((m) => m.registerDevThreadId(threadId));
  }, [threadId]);

  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root bg-background @container flex h-full min-h-0 flex-col"
      style={{
        ["--thread-max-width" as string]: "44rem",
        ["--composer-bg" as string]:
          "color-mix(in oklab, var(--color-muted) 30%, var(--color-background))",
        ["--composer-radius" as string]: "1.5rem",
        ["--composer-padding" as string]: "8px",
      }}
    >
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        data-slot="aui_thread-viewport"
        className="relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto scroll-smooth"
      >
        <div
          className={cn(
            "mx-auto flex w-full min-w-0 max-w-(--thread-max-width) flex-1 flex-col px-4 pt-4",
            isEmpty && "justify-center",
          )}
        >
          <AuiIf condition={isNewChatView}>
            <Welcome />
          </AuiIf>

          {showHistoryStatus ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              {historyError ? (
                <>
                  <p className="text-muted-foreground text-sm">
                    {t("thread.historyLoadFailed")}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => retryHistoryLoad()}
                  >
                    {t("thread.historyRetry")}
                  </Button>
                </>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {t("thread.historyLoading")}
                </p>
              )}
            </div>
          ) : null}

          <div
            data-slot="aui_message-group"
            className="mb-14 flex flex-col gap-y-6"
          >
            <ThreadPrimitive.Messages>
              {() => <ThreadMessage />}
            </ThreadPrimitive.Messages>
            <NetworkReconnectThreadFallback />
          </div>

          <ThreadPrimitive.ViewportFooter
            className={cn(
              "aui-thread-viewport-footer bg-background flex shrink-0 flex-col-reverse gap-4 overflow-visible pb-5 md:pb-6",
              !isEmpty &&
                "sticky bottom-0 mt-auto rounded-t-(--composer-radius)",
            )}
          >
            <ThreadScrollToBottom />
            <Composer />
            <ComposerAskPanel />
            <ComposerStatusBar />
          </ThreadPrimitive.ViewportFooter>
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

const ThreadMessage: FC = () => {
  const { AssistantMessage: AssistantMessageComponent = AssistantMessage } =
    useContext(ThreadComponentsContext);
  const role = useAuiState((s) => s.message.role);
  const isEditing = useAuiState((s) => s.message.composer.isEditing);

  if (isEditing) return <EditComposer />;
  if (role === "user") return <UserMessage />;
  return <AssistantMessageComponent />;
};

const ThreadScrollToBottom: FC = () => {
  const { t } = useTranslation();
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip={t("thread.scrollToBottom")}
        variant="outline"
        className="aui-thread-scroll-to-bottom dark:border-border dark:bg-background dark:hover:bg-accent absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

const ThreadWelcome: FC = () => {
  const { t } = useTranslation();
  return (
    <div className="aui-thread-welcome-root mb-6 flex flex-col items-center px-4 text-center">
      <h1 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-2xl font-semibold duration-200">
        {t("thread.welcome")}
      </h1>
    </div>
  );
};

const Composer: FC = () => {
  const { t } = useTranslation();
  const onKeyDown = useComposerSubmitKeys();

  return (
    <ComposerPrimitive.Root className="aui-composer-root relative flex w-full min-w-0 flex-col">
      <ComposerAttachmentDropzone asChild>
        <div className="flex w-full min-w-0 flex-col gap-2 data-[dragging=true]:[&_[data-slot=aui_composer-shell]]:border-ring data-[dragging=true]:[&_[data-slot=aui_composer-shell]]:border-dashed data-[dragging=true]:[&_[data-slot=aui_composer-shell]]:bg-[color-mix(in_oklab,var(--color-accent)_50%,var(--color-background))]">
          <ComposerQueue />
          <div
            data-slot="aui_composer-shell"
            className="border-border/60 focus-within:border-border dark:border-muted-foreground/15 dark:focus-within:border-muted-foreground/30 flex w-full min-w-0 flex-col gap-2 overflow-hidden rounded-(--composer-radius) border bg-(--composer-bg) p-(--composer-padding) shadow-[0_4px_16px_-8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow] focus-within:shadow-[0_6px_24px_-8px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.05)] dark:shadow-none"
          >
            <ComposerChipsRow />
            <ComposerMentionInput
              placeholder={t("thread.composerPlaceholder")}
              className="aui-composer-input placeholder:text-muted-foreground/80 max-h-32 min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-base outline-none"
              rows={1}
              autoFocus
              aria-label={t("thread.composerAriaLabel")}
              onKeyDown={onKeyDown}
            />
            <ComposerAction />
          </div>
        </div>
      </ComposerAttachmentDropzone>
    </ComposerPrimitive.Root>
  );
};

const ComposerAction: FC = () => {
  const { t } = useTranslation();
  return (
    <div className="aui-composer-action-wrapper relative flex items-center justify-between gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <ComposerPlusMenu />
        <ComposerModeChips />
      </div>
      <div className="relative z-10 flex min-w-0 shrink-0 items-center justify-end gap-0.5 overflow-visible">
        <ComposerContextUsage className="@max-[22rem]:hidden" />
        <ModelPicker className="min-w-0" />
        <AuiIf condition={(s) => !s.thread.isRunning}>
          <ComposerPrimitive.Send asChild>
            <TooltipIconButton
              tooltip={t("thread.sendMessage")}
              side="bottom"
              type="button"
              variant="default"
              size="icon"
              className="aui-composer-send size-7 shrink-0 rounded-full"
              aria-label={t("thread.sendMessage")}
            >
              <ArrowUpIcon className="aui-composer-send-icon size-4.5" />
            </TooltipIconButton>
          </ComposerPrimitive.Send>
        </AuiIf>
        <AuiIf condition={(s) => s.thread.isRunning}>
          <ComposerPrimitive.Cancel asChild>
            <Button
              type="button"
              variant="default"
              size="icon"
              className="aui-composer-cancel size-7 shrink-0 rounded-full"
              aria-label={t("thread.stopGenerating")}
            >
              <SquareIcon className="aui-composer-cancel-icon size-3.5 fill-current" />
            </Button>
          </ComposerPrimitive.Cancel>
        </AuiIf>
      </div>
    </div>
  );
};

const MessageError: FC = () => {
  const { t } = useTranslation();
  const error = useMessageError();
  if (error === undefined) return null;

  const formatted =
    formatChatError(error instanceof Error ? error : new Error(String(error))) ?? {
      title: t("chatError.requestFailed.title"),
      detail: t("chatError.retryLater"),
    };

  const message = formatted.detail
    ? `${formatted.title}：${formatted.detail}`
    : formatted.title;

  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root border-border bg-muted/60 mt-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
        <AlertCircleIcon className="text-destructive size-4 shrink-0" aria-hidden />
        <span className="aui-message-error-message min-w-0 truncate" title={message}>
          {message}
        </span>
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const AssistantMessage: FC = () => {
  const { t } = useTranslation();
  const {
    ToolFallback: ToolFallbackComponent = ToolFallback,
    ToolGroup,
    ReasoningGroup,
  } = useContext(ThreadComponentsContext);

  const parts = useAuiState((s) => s.message.parts);
  const messageId = useAuiState((s) => s.message.id);
  const messageStatusRunning = useAuiState(
    (s) => s.message.status?.type === "running",
  );
  const threadIsRunning = useAuiState((s) => s.thread.isRunning);
  const isLastMessage = useAuiState((s) => {
    const last = s.thread.messages.at(-1);
    return last?.id === s.message.id;
  });
  // Prefer thread.isRunning for the active turn so ask-await / continuation
  // gaps (runtime-extended isRunning) do not fold early via message.status.
  const isRunning =
    messageStatusRunning || (isLastMessage && threadIsRunning);
  const elapsedSeconds = useStreamingDuration(isRunning === true);
  const finalProseIdx = useMemo(() => findFinalProseIndex(parts), [parts]);
  const suspendSettled = isFrontendSuspendPartsSettled(parts);
  // Fold middle work whenever there is pre-final work — including while the
  // turn is still running. Only the final prose (and unsettled ask) stay out.
  const foldWork = hasPreFinalWork(parts, finalProseIdx);
  const lastSuspendIdx = useMemo(
    () => findLastFrontendSuspendToolIndex(parts),
    [parts],
  );
  const showWorkedForDuration = !isRunning && suspendSettled;
  const [workedForOpen, setWorkedForOpen] = useState(false);
  const workedForPrimaryStartRef = useRef<number | null>(null);
  // First group-worked-for in this render pass owns the label.
  workedForPrimaryStartRef.current = null;

  const groupBy = useMemo(() => {
    const fold: (
      part: PartState,
      context?: GroupByContext,
    ) => readonly AssistantGroupKey[] = (part, context) => {
      if (!foldWork) {
        return baseAssistantGroupBy(part, context) as readonly AssistantGroupKey[];
      }
      // Only the final answer (after last ask, or last text) stays outside.
      const index = parts.indexOf(part as (typeof parts)[number]);
      if (
        part.type === "text" &&
        index >= 0 &&
        isFinalProsePart(parts, index, finalProseIdx)
      ) {
        return ["group-final-prose"];
      }
      // Keep the current (last) frontend-suspend tool visible until the turn
      // settles — earlier answered asks still fold into Worked-for.
      // Keep the current (last) frontend-suspend tool visible until the turn
      // settles — earlier answered asks still fold into Worked-for.
      // lastSuspendIdx is only ask_user_question / read_open_page.
      if (!suspendSettled && index >= 0 && index === lastSuspendIdx) {
        return [];
      }
      const path = baseAssistantGroupBy(part, context);
      // Include path=[] (step-start / leftover standalone) so islands can share
      // one Worked-for label via WorkedForBlock coordination.
      if (path.length === 0) return ["group-worked-for"];
      return ["group-worked-for", ...(path as AssistantGroupKey[])];
    };
    return fold;
  }, [foldWork, parts, finalProseIdx, messageId, suspendSettled, lastSuspendIdx]);

  // reserves space for action bar and compensates with `-mb` for consistent msg spacing
  // keeps hovered action bar from shifting layout (autohide doesn't support absolute positioning well)
  // for pt-[n] use -mb-[n + 6] & min-h-[n + 6] to preserve compensation
  const ACTION_BAR_PT = "pt-1.5";
  const ACTION_BAR_HEIGHT = `-mb-7.5 min-h-7.5 ${ACTION_BAR_PT}`;

  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      className="fade-in slide-in-from-bottom-1 animate-in relative duration-150"
    >
      <div
        data-slot="aui_assistant-message-content"
        // [contain-intrinsic-size:auto_24px] fixes issue #4104, don't change without checking for regressions
        className="text-foreground flex flex-col gap-2 px-2 leading-relaxed wrap-break-word [contain-intrinsic-size:auto_24px] [content-visibility:auto]"
      >
        <MessagePrimitive.GroupedParts groupBy={groupBy}>
          {({ part, children }) => {
            switch (part.type) {
              case "group-worked-for": {
                const start =
                  part.indices.length > 0 ? Math.min(...part.indices) : -1;
                const isPrimary =
                  workedForPrimaryStartRef.current === null ||
                  workedForPrimaryStartRef.current === start;
                if (workedForPrimaryStartRef.current === null) {
                  workedForPrimaryStartRef.current = start;
                }
                return (
                  <WorkedForBlock
                    elapsedSeconds={
                      showWorkedForDuration ? elapsedSeconds : undefined
                    }
                    isPrimary={isPrimary}
                    open={workedForOpen}
                    onOpenChange={setWorkedForOpen}
                  >
                    {children}
                  </WorkedForBlock>
                );
              }
              case "group-chainOfThought":
                return (
                  <div
                    data-slot="aui_chain-of-thought"
                    className="flex flex-col gap-2"
                  >
                    {children}
                  </div>
                );
              case "group-tool":
                if (ToolGroup) {
                  return <ToolGroup group={part}>{children}</ToolGroup>;
                }
                return (
                  <ToolGroupBlock indices={part.indices}>
                    {children}
                  </ToolGroupBlock>
                );
              case "group-reasoning": {
                if (ReasoningGroup) {
                  return (
                    <ReasoningGroup group={part}>{children}</ReasoningGroup>
                  );
                }
                return (
                  <ReasoningGroupBlock indices={part.indices}>
                    {children}
                  </ReasoningGroupBlock>
                );
              }
              case "group-final-prose":
              case "group-prose":
                return (
                  <div data-slot="aui_assistant-prose" className="flex flex-col gap-2">
                    {children}
                  </div>
                );
              case "text":
                return <AssistantMarkdownText />;
              case "reasoning":
                return <Reasoning {...part} />;
              case "tool-call":
                return part.toolUI ?? <ToolFallbackComponent {...part} />;
              case "data":
                return part.dataRendererUI;
              case "indicator":
                return (
                  <span
                    data-slot="aui_assistant-message-indicator"
                    className="animate-pulse font-sans"
                    aria-label={t("thread.assistantWorking")}
                  >
                    {"●"}
                  </span>
                );
              default:
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
        <NetworkReconnectInAssistant />
        <MessageError />
        <MessageKnowledgeCitations />
      </div>

      <div
        data-slot="aui_assistant-message-footer"
        className={cn("ms-2 flex items-center", ACTION_BAR_HEIGHT)}
      >
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  );
};

const MessageCopyButton: FC = () => (
  <ActionBarPrimitive.Copy asChild>
    <TooltipIconButton tooltip="Copy">
      <AuiIf condition={(s) => s.message.isCopied}>
        <CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
      </AuiIf>
      <AuiIf condition={(s) => !s.message.isCopied}>
        <CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
      </AuiIf>
    </TooltipIconButton>
  </ActionBarPrimitive.Copy>
);

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-assistant-action-bar-root text-muted-foreground/50 animate-in fade-in col-start-3 row-start-2 -ms-1 flex items-center gap-1 duration-200"
    >
      <MessageCopyButton />
      <MessageTimestamp className="ms-0.5" align="start" inline />
    </ActionBarPrimitive.Root>
  );
};

const UserMessage: FC = () => {
  const text = useAuiState((s) =>
    s.message.content
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("\n"),
  );
  const hasChips = useAuiState((s) => userMessageHasDisplayChips(s.message));
  const isNotificationOnly = Boolean(text.trim()) && isTaskNotificationText(text.trim());
  const hasDisplayText = Boolean(text.trim()) && !isTaskNotificationText(text.trim());
  const showBubble = hasDisplayText || hasChips;

  // Synthesis injects hidden task-notification user turns for the model only.
  if (isNotificationOnly && !hasChips) return null;

  return (
    <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      className="fade-in slide-in-from-bottom-1 animate-in flex flex-col items-end gap-2 px-2 duration-150 [contain-intrinsic-size:auto_60px] [content-visibility:auto]"
      data-role="user"
    >
      <UserMessageChipsRow />

      {showBubble && (
        <div className="aui-user-message-content-wrapper flex max-w-[85%] flex-col items-end">
          <div className="relative w-max max-w-full">
            <div
              className={cn(
                "aui-user-message-content bg-muted text-foreground rounded-3xl px-4 py-2 wrap-break-word",
                !hasDisplayText && "min-h-[2.25rem]",
              )}
            >
              <UserMessageText />
            </div>
            <div className="aui-user-action-bar-wrapper absolute top-1/2 right-full -translate-y-1/2 pe-2">
              <UserActionBar />
            </div>
          </div>
          <UserMessageFooter />
        </div>
      )}

    </MessagePrimitive.Root>
  );
};

const USER_MESSAGE_FOOTER_HEIGHT = "min-h-7";

const UserMessageFooter: FC = () => {
  return (
    <div
      className={cn(
        "aui-user-message-footer-slot mt-1 flex w-full shrink-0 items-start justify-end",
        USER_MESSAGE_FOOTER_HEIGHT,
      )}
    >
      <ActionBarPrimitive.Root
        hideWhenRunning
        autohide="not-last"
        className="aui-user-message-footer text-muted-foreground/50 flex w-max shrink-0 items-center gap-1.5 whitespace-nowrap"
      >
        <MessageTimestamp align="end" inline />
        <MessageCopyButton />
      </ActionBarPrimitive.Root>
    </div>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-user-action-bar-root flex flex-col items-end"
    >
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton tooltip="Edit" className="aui-user-action-edit">
          <PencilIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  const aui = useAui();
  const canSend = useAuiState((s) => s.composer.canSend);
  const onKeyDown = useComposerSubmitKeys();

  return (
    <MessagePrimitive.Root
      data-slot="aui_edit-composer-wrapper"
      className="flex flex-col px-2"
    >
      <ComposerPrimitive.Root className="aui-edit-composer-root border-border/60 dark:border-muted-foreground/15 ms-auto flex w-full max-w-[85%] flex-col rounded-(--composer-radius) border bg-(--composer-bg) shadow-[0_4px_16px_-8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] dark:shadow-none">
        <ComposerPrimitive.Input
          submitMode="none"
          className="aui-edit-composer-input text-foreground min-h-14 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base outline-none"
          autoFocus
          onKeyDown={onKeyDown}
        />
        <div className="aui-edit-composer-footer mx-2.5 mb-2.5 flex items-center gap-1.5 self-end">
          <ComposerPrimitive.Cancel asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-full px-3.5"
            >
              Cancel
            </Button>
          </ComposerPrimitive.Cancel>
          <Button
            type="button"
            size="sm"
            className="h-8 rounded-full px-3.5"
            disabled={!canSend}
            onClick={() => aui.composer().send({ startRun: true })}
          >
            Update
          </Button>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};

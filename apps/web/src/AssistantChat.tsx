import {
  AssistantRuntimeProvider,
  AuiProvider,
  useAui,
  useAuiState,
} from '@assistant-ui/react';
import {
  AssistantChatTransport,
} from '@assistant-ui/react-ai-sdk';
import i18n from '@/i18n';
import { useVeylinChatRuntime } from '@/lib/use-veylin-chat-runtime';
import {
  CompositeAttachmentAdapter,
  SimpleImageAttachmentAdapter,
} from '@assistant-ui/react';
import { lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from 'ai';
import { FileAttachmentAdapter } from '@/lib/file-attachment-adapter';
import { getChatSettings, setChatSettings } from '@/lib/chat-settings';
import { consumeBranchEdit } from '@/lib/context-sync-ref';
import { createResilientChatFetch } from '@/lib/create-resilient-chat-fetch';
import { useNetworkConnectivity } from '@/lib/use-network-connectivity';
import { useNetworkReconnectStore } from '@/lib/network-reconnect-store';
import { isAbortError } from '@/lib/transport-reconnect';
import { formatChatError, isBenignChatError } from '@/lib/format-chat-error';
import {
  cursorToSequenceNum,
  getResumeCursor,
} from '@/lib/stream-resume-cursor';
import { resumableStorage } from '@/lib/resumable-storage';
import { HandoffRenderers } from '@/components/assistant-ui/handoff';
import { AskUserQuestionToolUI } from '@/components/assistant-ui/ask-user-question';
import { WebFetchToolUI } from '@/components/assistant-ui/web-fetch';
import { ReadOpenPageToolUI } from '@/components/assistant-ui/read-open-page';
import { TodoWriteToolUI } from '@/components/assistant-ui/todo-write';
import { ToolSearchToolUI } from '@/components/assistant-ui/tool-search';
import { TaskCreateToolUI } from '@/components/assistant-ui/task-create-tool';
import { KnowledgeSearchToolUI } from '@/components/assistant-ui/knowledge-search';
import { ChatPanelRatioSync } from '@/components/assistant-ui/chat-panel-ratio-sync';
import { Thread } from '@/components/assistant-ui/thread';
import { ThreadListSidebar } from '@/components/assistant-ui/threadlist-sidebar';
import { ThreadRightSidebar } from '@/components/assistant-ui/thread-right-sidebar';
import { SettingsPanelProvider, useSettingsPanel } from '@/hooks/settings/use-settings-panel';
import { CustomizeWorkspace } from '@/components/features/customize/customize-workspace';
import { AutomateWorkspace } from '@/components/features/automate/automate-workspace';
import { SettingsWorkspace } from '@/components/features/settings/settings-workspace';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import {
  RightSidebarProvider,
  RightSidebarTrigger,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';

const FRONTEND_SUSPEND_TOOLS = ['ask_user_question', 'read_open_page'] as const;

/** Do not auto-continue while a frontend-suspend tool awaits user/desktop action. */
function sendAutomaticallyWhen({ messages }: { messages: UIMessage[] }) {
  const last = messages.at(-1);
  if (last?.role === 'assistant' && last.parts) {
    for (const part of last.parts) {
      const p = part as {
        type?: string;
        toolInvocation?: { toolName?: string; state?: string };
        state?: string;
      };
      if (p.type === 'tool-invocation') {
        const name = p.toolInvocation?.toolName;
        if (
          name &&
          (FRONTEND_SUSPEND_TOOLS as readonly string[]).includes(name) &&
          p.toolInvocation?.state !== 'result'
        ) {
          return false;
        }
      }
      for (const toolName of FRONTEND_SUSPEND_TOOLS) {
        if (p.type === `tool-${toolName}` && p.state !== 'output-available') {
          return false;
        }
      }
    }
  }
  return lastAssistantMessageIsCompleteWithToolCalls({ messages });
}

function ThreadHeaderTitle() {
  const title = useAuiState((s) => s.threadListItem.title);
  return <BreadcrumbPage>{title?.trim() || 'New Chat'}</BreadcrumbPage>;
}

function ChatShell() {
  const aui = useAui();
  const { view } = useSettingsPanel();

  return (
    <AuiProvider value={aui}>
      <SidebarProvider>
        <RightSidebarProvider>
          <ChatPanelRatioSync />
          <div className="flex h-dvh w-full">
            <ThreadListSidebar />
            {view === 'customize' ? (
              <CustomizeWorkspace />
            ) : view === 'automate' ? (
              <AutomateWorkspace />
            ) : view === 'settings' ? (
              <SettingsWorkspace />
            ) : (
              <>
                <SidebarInset className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <header className="flex h-14 shrink-0 items-center gap-2 px-4">
                    <SidebarTrigger />
                    <Breadcrumb className="min-w-0 flex-1">
                      <BreadcrumbList>
                        <BreadcrumbItem>
                          <ThreadHeaderTitle />
                        </BreadcrumbItem>
                      </BreadcrumbList>
                    </Breadcrumb>
                    <div className="ml-auto flex shrink-0 items-center gap-1.5">
                      <RightSidebarTrigger />
                    </div>
                  </header>
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    <Thread />
                  </div>
                </SidebarInset>
                <ThreadRightSidebar />
              </>
            )}
          </div>
        </RightSidebarProvider>
      </SidebarProvider>
    </AuiProvider>
  );
}

const resilientChatFetch = createResilientChatFetch();

export function AssistantChat() {
  useNetworkConnectivity();

  const runtime = useVeylinChatRuntime({
    resume: true,
    sendAutomaticallyWhen,
    onError: (error) => {
      if (isAbortError(error) || isBenignChatError(error)) return;
      const formatted = formatChatError(error);
      if (!formatted) return;
      useNetworkReconnectStore
        .getState()
        .setConnectionError(formatted.title, formatted.detail);
    },
    onFinish: () => {
      useNetworkReconnectStore.getState().clearTransientBanner();
      setChatSettings({ pendingSkill: null });
    },
    adapters: {
      attachments: new CompositeAttachmentAdapter([
        new SimpleImageAttachmentAdapter(),
        new FileAttachmentAdapter(),
      ]),
    },
    transport: new AssistantChatTransport({
      api: '/api/chat',
      fetch: resilientChatFetch,
      prepareReconnectToStreamRequest: ({ id }) => {
        const streamId = resumableStorage.getStreamId();
        if (streamId) {
          const cursor = getResumeCursor(streamId);
          const seq = cursorToSequenceNum(cursor);
          return {
            api:
              seq > 0
                ? `/api/chat/streams/${streamId}?from_sequence_num=${seq}`
                : `/api/chat/streams/${streamId}`,
            headers: cursor ? { 'Last-Event-ID': cursor } : undefined,
          };
        }
        return {
          api: `/api/chat/${id}/stream`,
        };
      },
      body: () => {
        const s = getChatSettings();
        return {
          model: s.model,
          agentId: s.agentId,
          planMode: s.planMode,
          mcpEnabled: s.mcpEnabled,
          pendingSkill: s.pendingSkill ?? undefined,
          branchEdit: consumeBranchEdit(),
          locale: i18n.resolvedLanguage ?? i18n.language,
        };
      },
    }),
  });

  return (
    <SettingsPanelProvider>
      <AssistantRuntimeProvider runtime={runtime}>
        <HandoffRenderers />
        <AskUserQuestionToolUI />
        <TodoWriteToolUI />
        <ToolSearchToolUI />
        <TaskCreateToolUI />
        <KnowledgeSearchToolUI />
        <WebFetchToolUI />
        <ReadOpenPageToolUI />
        <ChatShell />
      </AssistantRuntimeProvider>
    </SettingsPanelProvider>
  );
}

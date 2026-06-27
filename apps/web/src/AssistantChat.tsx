import {
  AssistantRuntimeProvider,
  AuiProvider,
  useAui,
} from '@assistant-ui/react';
import {
  AssistantChatTransport,
} from '@assistant-ui/react-ai-sdk';
import { useVeylinChatRuntime } from '@/lib/use-veylin-chat-runtime';
import {
  CompositeAttachmentAdapter,
  SimpleImageAttachmentAdapter,
} from '@assistant-ui/react';
import { shouldAutoSendChat } from '@/lib/frontend-suspend-tools';
import { FileAttachmentAdapter } from '@/lib/file-attachment-adapter';
import { getChatSettings, setChatSettings } from '@/lib/chat-settings';
import i18n, { resolveAppLanguage } from '@/i18n';
import { consumeForceReplaceNextChat } from '@/lib/chat-force-replace-ref';
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
import {
  SetWorkingMemoryToolUI,
  UpdateWorkingMemoryToolUI,
} from '@/components/assistant-ui/working-memory-tools';
import { ToolSearchToolUI } from '@/components/assistant-ui/tool-search';
import { TaskToolUI, TaskContinueToolUI } from '@/components/assistant-ui/task-tool';
import { KnowledgeSearchToolUI } from '@/components/assistant-ui/knowledge-search';
import { ChatPanelRatioSync } from '@/components/assistant-ui/chat-panel-ratio-sync';
import { Thread } from '@/components/assistant-ui/thread';
import { ThreadHeaderToolbar } from '@/components/assistant-ui/thread-header-toolbar';
import { ThreadListSidebar } from '@/components/assistant-ui/threadlist-sidebar';
import { ThreadRightSidebar } from '@/components/assistant-ui/thread-right-sidebar';
import { PanelTabsProvider } from '@/components/assistant-ui/right-panel/panel-tabs-context';
import { SettingsPanelProvider, useSettingsPanel } from '@/hooks/settings/use-settings-panel';
import { WorkspaceNavigationProvider } from '@/hooks/use-workspace-navigation';
import { CustomizeWorkspace } from '@/components/features/customize/customize-workspace';
import { AutomateWorkspace } from '@/components/features/automate/automate-workspace';
import { SettingsWorkspace } from '@/components/features/settings/settings-workspace';
import { WorkspacePanelDragOverlay } from '@/components/features/workspace-panel-drag-overlay';
import { cn } from '@/lib/utils';
import {
  RightSidebarProvider,
  SidebarInset,
  SidebarProvider,
} from '@/components/ui/sidebar';

function ChatShell() {
  const aui = useAui();
  const { view } = useSettingsPanel();

  return (
    <AuiProvider value={aui}>
      <WorkspaceNavigationProvider>
        <PanelTabsProvider>
        <SidebarProvider>
        <RightSidebarProvider>
          <ChatPanelRatioSync />
          <div className="flex h-dvh w-full overflow-hidden">
            <ThreadListSidebar />
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <div
                className={cn(
                  'flex min-h-0 min-w-0 flex-1 overflow-hidden',
                  view !== 'chat' && 'hidden',
                )}
              >
                <SidebarInset className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <ThreadHeaderToolbar />
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    <Thread />
                  </div>
                </SidebarInset>
                <ThreadRightSidebar />
              </div>
              {view === 'customize' && (
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                  <WorkspacePanelDragOverlay />
                  <CustomizeWorkspace />
                </div>
              )}
              {view === 'automate' && (
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                  <WorkspacePanelDragOverlay />
                  <AutomateWorkspace />
                </div>
              )}
              {view === 'settings' && (
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                  <WorkspacePanelDragOverlay />
                  <SettingsWorkspace />
                </div>
              )}
            </div>
          </div>
        </RightSidebarProvider>
        </SidebarProvider>
        </PanelTabsProvider>
      </WorkspaceNavigationProvider>
    </AuiProvider>
  );
}

const resilientChatFetch = createResilientChatFetch();

export function AssistantChat() {
  useNetworkConnectivity();

  const runtime = useVeylinChatRuntime({
    resume: true,
    sendAutomaticallyWhen: shouldAutoSendChat,
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
      setChatSettings({ pendingSkill: null, attachedBrowserTab: null });
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
          attachedBrowser: s.attachedBrowserTab ?? undefined,
          forceReplace: consumeForceReplaceNextChat(),
          locale: resolveAppLanguage(i18n.resolvedLanguage ?? i18n.language),
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
        <UpdateWorkingMemoryToolUI />
        <SetWorkingMemoryToolUI />
        <ToolSearchToolUI />
        <TaskToolUI />
        <TaskContinueToolUI />
        <KnowledgeSearchToolUI />
        <WebFetchToolUI />
        <ReadOpenPageToolUI />
        <ChatShell />
      </AssistantRuntimeProvider>
    </SettingsPanelProvider>
  );
}

import { useEffect } from 'react';
import {
  AssistantRuntimeProvider,
  AuiProvider,
  useAui,
} from '@assistant-ui/react';
import { bootstrapModelCatalogFromServer } from '@/hooks/use-server-model-catalog';
import { startupCheckpoint } from '@/lib/startup-profiler';
import {
  AssistantChatTransport,
} from '@assistant-ui/react-ai-sdk';
import { useVeylinChatRuntime } from '@/lib/use-veylin-chat-runtime';
import {
  CompositeAttachmentAdapter,
  SimpleImageAttachmentAdapter,
} from '@assistant-ui/react';
import { FileAttachmentAdapter } from '@/lib/file-attachment-adapter';
import { getChatSettings, setChatSettings } from '@/lib/chat-settings';
import { readWorkspacePanelContext } from '@/lib/panel-tabs-storage';
import i18n, { resolveAppLanguage } from '@/i18n';
import { consumeForceReplaceNextChat } from '@/lib/chat-force-replace-ref';
import { createResilientChatFetch } from '@/lib/create-resilient-chat-fetch';
import { useNetworkConnectivity } from '@/lib/use-network-connectivity';
import { useNetworkReconnectStore } from '@/lib/network-reconnect-store';
import {
  cursorToSequenceNum,
  getResumeCursor,
} from '@/lib/stream-resume-cursor';
import { resumableStorage } from '@/lib/resumable-storage';
import {
  LazyAssistantToolUIs,
  LazyAutomateWorkspace,
  LazyCustomizeWorkspace,
  LazyProjectWorkspace,
  LazySettingsWorkspace,
  LazyThreadRightSidebar,
} from '@/components/assistant-ui/lazy-assistant-modules';
import { ChatPanelRatioSync } from '@/components/assistant-ui/chat-panel-ratio-sync';
import { Thread } from '@/components/assistant-ui/thread';
import { AppTitlebarControls } from '@/components/assistant-ui/app-titlebar-controls';
import { ThreadHeaderToolbar } from '@/components/assistant-ui/thread-header-toolbar';
import { ThreadListSidebar } from '@/components/assistant-ui/threadlist-sidebar';
import { PanelTabsProvider } from '@/components/assistant-ui/right-panel/panel-tabs-context';
import { SettingsPanelProvider, useSettingsPanel } from '@/hooks/settings/use-settings-panel';
import { WorkspaceNavigationProvider } from '@/hooks/use-workspace-navigation';
import { WorkspaceViewFrame } from '@/components/features/workspace-view-frame';
import { cn } from '@/lib/utils';
import {
  RightSidebarProvider,
  SidebarInset,
  SidebarProvider,
  useRightSidebar,
} from '@/components/ui/sidebar';
import { usePanelTabs } from '@/components/assistant-ui/right-panel/panel-tabs-context';
import { useDesktopInteractionGuard } from '@/lib/use-desktop-interaction-guard';
import { consumeNativeResumeRequest } from '@/lib/native-suspend-resume';

function DesktopInteractionGuard() {
  const { view } = useSettingsPanel();
  const { open: rightSidebarOpen } = useRightSidebar();
  const { activeTab } = usePanelTabs();
  const hasVisibleWebTab =
    view === 'chat' && rightSidebarOpen && activeTab?.kind === 'web';

  useDesktopInteractionGuard({
    rightSidebarOpen,
    workspaceView: view,
    hasVisibleWebTab,
  });
  return null;
}

function ChatShell() {
  const aui = useAui();
  const { view } = useSettingsPanel();

  return (
    <AuiProvider value={aui}>
      <WorkspaceNavigationProvider>
        <PanelTabsProvider>
        <SidebarProvider>
        <RightSidebarProvider>
          <AppTitlebarControls />
          <ChatPanelRatioSync />
          <DesktopInteractionGuard />
          <div className="flex h-dvh w-full overflow-hidden">
            <ThreadListSidebar />
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <div
                data-slot="chat-workspace"
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
                <LazyThreadRightSidebar />
              </div>
              {view === 'customize' && (
                <WorkspaceViewFrame>
                  <LazyCustomizeWorkspace />
                </WorkspaceViewFrame>
              )}
              {view === 'automate' && (
                <WorkspaceViewFrame>
                  <LazyAutomateWorkspace />
                </WorkspaceViewFrame>
              )}
              {view === 'settings' && (
                <WorkspaceViewFrame>
                  <LazySettingsWorkspace />
                </WorkspaceViewFrame>
              )}
              {view === 'project' && (
                <WorkspaceViewFrame>
                  <LazyProjectWorkspace />
                </WorkspaceViewFrame>
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

  useEffect(() => {
    void bootstrapModelCatalogFromServer().finally(() => startupCheckpoint('catalog_ready'));
  }, []);

  const runtime = useVeylinChatRuntime({
    resume: true,
    // Tool continuation is orchestrated in useAISDKRuntimeWithQueue (single path, deduped).
    sendAutomaticallyWhen: () => false,
    onError: () => {
      // Stream errors are shown once via MessageError on the assistant row.
      // Reconnect / exhausted states use the network reconnect banner in fetch layer.
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
      prepareSendMessagesRequest: ({
        id,
        body,
        messages,
        trigger,
        messageId,
        requestMetadata,
      }) => {
        const resume = consumeNativeResumeRequest(id);
        if (!resume) {
          return {
            body: {
              ...body,
              id,
              messages,
              trigger,
              messageId,
              metadata: requestMetadata,
            },
          };
        }
        return {
          body: {
            ...body,
            id: resume.threadId,
            resume: {
              runId: resume.runId,
              toolCallId: resume.toolCallId,
              resumeData: resume.resumeData,
            },
          },
        };
      },
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
          pendingLoop: s.pendingLoop || undefined,
          mcpEnabled: s.mcpEnabled,
          pendingSkill: s.pendingSkill ?? undefined,
          attachedBrowser: s.attachedBrowserTab ?? undefined,
          // 用户本地时区 —— 服务端据此告诉模型"现在几点"。桌面端服务端就在本机,
          // 但工作站/远端部署时两者不在一个时区,而"今天"是本地语义。
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          workspacePanel: readWorkspacePanelContext(),
          forceReplace: consumeForceReplaceNextChat(),
          locale: resolveAppLanguage(i18n.resolvedLanguage ?? i18n.language),
        };
      },
    }),
  });

  return (
    <SettingsPanelProvider>
      <AssistantRuntimeProvider runtime={runtime}>
        <LazyAssistantToolUIs />
        <ChatShell />
      </AssistantRuntimeProvider>
    </SettingsPanelProvider>
  );
}

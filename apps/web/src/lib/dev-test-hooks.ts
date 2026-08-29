import {
  clearAskUserSession,
  setAskUserSession,
  type AskQuestion,
  type AskUserResult,
} from '@/lib/ask-user-question-session';
import { registerAskUserResultSubmitter } from '@/lib/ask-user-submit-bridge';
import { recoverDesktopInteraction } from '@/lib/use-desktop-interaction-guard';

let currentThreadId: string | undefined;
/**
 * 打开右侧表格面板的入口(只在 DEV 装)。
 *
 * e2e 从前靠几何去点那个"选面板类型"的大卡片:右栏可能收着、可能被左栏挤到
 * 视口外、卡片还在动画里 —— 三种情况轮流失败,红了却与产品无关(实测让两条
 * 测试反复变红,我一度以为是产品坏了)。面板本来就有 open('table') 这个 API,
 * 测试直接用它,几何不再进入判据。
 */
let openTablePanel: (() => void) | null = null;

export function registerDevPanelOpener(open: () => void): void {
  openTablePanel = open;
}

/** 分屏 e2e 的入口(只在 DEV 装),同 openTablePanel 的理由:几何不进判据。 */
export type DevPanelSplitApi = {
  openPanel: (kind: string) => void;
  moveTabToPane: (kind: string, pane: 'top' | 'bottom') => void;
  panelState: () => {
    tabs: Array<{ id: string; kind: string }>;
    activeId: string | null;
    split:
      | { bottomIds: string[]; topVisibleId: string; bottomVisibleId: string; ratio: number }
      | undefined;
  };
};

let panelSplitApi: DevPanelSplitApi | null = null;

export function registerDevPanelSplitApi(api: DevPanelSplitApi): void {
  panelSplitApi = api;
}
let lastAskResult: AskUserResult | null = null;

export function registerDevThreadId(threadId: string): void {
  currentThreadId = threadId;
}

export function installDevTestHooks(): void {
  if (!import.meta.env.DEV) return;

  const win = window as Window & {
    __veylinTest?: {
      hasThread: () => boolean;
      openAskPanel: (questions: AskQuestion[]) => void;
      openTablePanel: () => void;
      openPanel: (kind: string) => void;
      moveTabToPane: (kind: string, pane: 'top' | 'bottom') => void;
      panelState: () => ReturnType<DevPanelSplitApi['panelState']>;
      peekAskResult: () => AskUserResult | null;
      clearAskResult: () => void;
    };
    __veylinRecoverInteraction?: () => void;
  };

  win.__veylinRecoverInteraction = recoverDesktopInteraction;

  win.__veylinTest = {
    hasThread: () => Boolean(currentThreadId),
    openTablePanel() {
      if (!openTablePanel) throw new Error('dev: table panel opener not ready');
      openTablePanel();
    },
    openPanel(kind: string) {
      if (!panelSplitApi) throw new Error('dev: panel split api not ready');
      panelSplitApi.openPanel(kind);
    },
    moveTabToPane(kind: string, pane: 'top' | 'bottom') {
      if (!panelSplitApi) throw new Error('dev: panel split api not ready');
      panelSplitApi.moveTabToPane(kind, pane);
    },
    panelState() {
      if (!panelSplitApi) throw new Error('dev: panel split api not ready');
      return panelSplitApi.panelState();
    },
    openAskPanel(questions) {
      if (!currentThreadId) {
        throw new Error('dev ask panel: thread id not ready');
      }
      lastAskResult = null;
      const threadId = currentThreadId;
      // Mirror production: panel submit goes through the thread-scoped bridge.
      registerAskUserResultSubmitter(threadId, async (_toolCallId, result) => {
        lastAskResult = result;
        clearAskUserSession(threadId, 'dev-e2e-ask');
        registerAskUserResultSubmitter(threadId, null);
      });
      setAskUserSession({
        threadId,
        toolCallId: 'dev-e2e-ask',
        questions,
        addResult: (result) => {
          lastAskResult = result;
          clearAskUserSession(threadId, 'dev-e2e-ask');
          registerAskUserResultSubmitter(threadId, null);
        },
      });
    },
    peekAskResult: () => lastAskResult,
    clearAskResult: () => {
      lastAskResult = null;
    },
  };
}

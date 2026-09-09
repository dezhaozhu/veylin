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

/** 排产即导航的宿主机制 e2e 入口(只在 DEV 装):直接喂一个 NavigateTarget 给和
 * 卡片点条 / agent navigate 同一个 handler。模型走一遍另有测试;这里钉的是宿主
 * 「展开二级选三级 / 规则过滤表格 / 订单双落地」的机械,不让模型的抖动混进判据。 */
let devNavigate: ((target: unknown) => void) | null = null;
let devGanttTaskIds: (() => string[]) | null = null;
let devGanttInstance: ((id: string) => { exists: boolean; open: unknown; parent: unknown } | null) | null = null;

export function registerDevGanttInstance(fn: typeof devGanttInstance): void {
  devGanttInstance = fn;
}

/** 甘特当前喂给 dhtmlx 的 task id 清单(只在 DEV):e2e 判「子行进没进树」不靠 DOM(虚拟化/折叠都会骗人)。 */
export function registerDevGanttTasks(fn: (() => string[]) | null): void {
  devGanttTaskIds = fn;
}

export function registerDevNavigate(fn: (target: unknown) => void): void {
  devNavigate = fn;
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
      navigate: (target: unknown) => void;
      threadId: () => string | undefined;
      ganttTaskIds: () => string[];
      ganttInstanceTask: (id: string) => { exists: boolean; open: unknown; parent: unknown } | null;
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
    navigate(target: unknown) {
      if (!devNavigate) throw new Error('dev: navigate not ready');
      devNavigate(target);
    },
    threadId: () => currentThreadId,
    ganttTaskIds: () => (devGanttTaskIds ? devGanttTaskIds() : []),
    ganttInstanceTask: (id: string) => (devGanttInstance ? devGanttInstance(id) : null),
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

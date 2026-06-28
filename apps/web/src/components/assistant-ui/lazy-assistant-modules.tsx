import { lazy, Suspense } from 'react';
import { HandoffRenderers } from '@/components/assistant-ui/handoff';

const AskUserQuestionToolUI = lazy(() =>
  import('@/components/assistant-ui/ask-user-question').then((m) => ({
    default: m.AskUserQuestionToolUI,
  })),
);
const ReadOpenPageToolUI = lazy(() =>
  import('@/components/assistant-ui/read-open-page').then((m) => ({
    default: m.ReadOpenPageToolUI,
  })),
);
const TodoWriteToolUI = lazy(() =>
  import('@/components/assistant-ui/todo-write').then((m) => ({ default: m.TodoWriteToolUI })),
);
const WorkingMemoryTools = lazy(() =>
  import('@/components/assistant-ui/working-memory-tools').then((m) => ({
    default: function WorkingMemoryToolUIs() {
      return (
        <>
          <m.UpdateWorkingMemoryToolUI />
          <m.SetWorkingMemoryToolUI />
        </>
      );
    },
  })),
);
const ToolSearchToolUI = lazy(() =>
  import('@/components/assistant-ui/tool-search').then((m) => ({ default: m.ToolSearchToolUI })),
);
const TaskTools = lazy(() =>
  import('@/components/assistant-ui/task-tool').then((m) => ({
    default: function TaskToolUIs() {
      return (
        <>
          <m.TaskToolUI />
          <m.TaskContinueToolUI />
        </>
      );
    },
  })),
);
const KnowledgeSearchToolUI = lazy(() =>
  import('@/components/assistant-ui/knowledge-search').then((m) => ({
    default: m.KnowledgeSearchToolUI,
  })),
);

export function LazyAssistantToolUIs() {
  return (
    <>
      <HandoffRenderers />
      <Suspense fallback={null}>
        <AskUserQuestionToolUI />
        <TodoWriteToolUI />
        <WorkingMemoryTools />
        <ToolSearchToolUI />
        <TaskTools />
        <KnowledgeSearchToolUI />
        <ReadOpenPageToolUI />
      </Suspense>
    </>
  );
}

const CustomizeWorkspace = lazy(() =>
  import('@/components/features/customize/customize-workspace').then((m) => ({
    default: m.CustomizeWorkspace,
  })),
);
const AutomateWorkspace = lazy(() =>
  import('@/components/features/automate/automate-workspace').then((m) => ({
    default: m.AutomateWorkspace,
  })),
);
const SettingsWorkspace = lazy(() =>
  import('@/components/features/settings/settings-workspace').then((m) => ({
    default: m.SettingsWorkspace,
  })),
);
const ThreadRightSidebar = lazy(() =>
  import('@/components/assistant-ui/thread-right-sidebar').then((m) => ({
    default: m.ThreadRightSidebar,
  })),
);

export function LazyCustomizeWorkspace() {
  return (
    <Suspense fallback={null}>
      <CustomizeWorkspace />
    </Suspense>
  );
}

export function LazyAutomateWorkspace() {
  return (
    <Suspense fallback={null}>
      <AutomateWorkspace />
    </Suspense>
  );
}

export function LazySettingsWorkspace() {
  return (
    <Suspense fallback={null}>
      <SettingsWorkspace />
    </Suspense>
  );
}

export function LazyThreadRightSidebar() {
  return (
    <Suspense fallback={null}>
      <ThreadRightSidebar />
    </Suspense>
  );
}

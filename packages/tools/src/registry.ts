import type { RiskLevel } from '@veylin/shared';
// Disabled: file/shell tools (file_read, file_write, file_edit, list_dir, grep, glob, bash)
// import { fileRead, fileWrite, fileEdit, listDir, grep, glob } from './fs';
// import { bash } from './shell';
import { webFetch } from './web';
import { todoWrite, askUserQuestion, readOpenPage } from './interaction';
import { enterPlanMode, exitPlanMode } from './plan-mode';

export const builtinTools = {
  // file_read: fileRead,
  // file_write: fileWrite,
  // file_edit: fileEdit,
  // list_dir: listDir,
  // grep,
  // glob,
  // bash,
  web_fetch: webFetch,
  todo_write: todoWrite,
  ask_user_question: askUserQuestion,
  read_open_page: readOpenPage,
  enter_plan_mode: enterPlanMode,
  exit_plan_mode: exitPlanMode,
} as const;

export type BuiltinToolId = keyof typeof builtinTools;

/** Risk classification consumed by @veylin/policy and the tool-search processor. */
export const toolRisk: Record<BuiltinToolId, RiskLevel> = {
  web_fetch: 'safe',
  todo_write: 'safe',
  ask_user_question: 'safe',
  read_open_page: 'safe',
  enter_plan_mode: 'safe',
  exit_plan_mode: 'safe',
};

/** Short keyword hints used by the dynamic tool-search processor. */
export const toolKeywords: Record<BuiltinToolId, string[]> = {
  web_fetch: ['web', 'url', 'fetch', 'http', 'download', 'page', 'browse', 'website'],
  todo_write: ['todo', 'plan', 'task', 'checklist'],
  ask_user_question: ['ask', 'question', 'clarify', 'choose'],
  read_open_page: ['page', 'current', 'dom', 'read', 'open', '网页', '当前页', '内网', 'browser'],
  enter_plan_mode: ['plan', 'planning', 'explore', 'read-only'],
  exit_plan_mode: ['execute', 'exit plan', 'implement'],
};

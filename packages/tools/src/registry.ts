import type { RiskLevel } from '@veylin/shared';
import { fileRead, fileWrite, fileEdit, listDir, grep, glob } from './fs';
import { bash } from './shell';
import { webFetch } from './web';
import { todoWrite, askUserQuestion, readOpenPage } from './interaction';
import { enterPlanMode, exitPlanMode } from './plan-mode';

export const builtinTools = {
  file_read: fileRead,
  file_write: fileWrite,
  file_edit: fileEdit,
  list_dir: listDir,
  grep,
  glob,
  bash,
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
  file_read: 'safe',
  list_dir: 'safe',
  grep: 'safe',
  glob: 'safe',
  web_fetch: 'caution',
  todo_write: 'safe',
  ask_user_question: 'safe',
  read_open_page: 'caution',
  enter_plan_mode: 'safe',
  exit_plan_mode: 'safe',
  file_write: 'dangerous',
  file_edit: 'dangerous',
  bash: 'dangerous',
};

/** Short keyword hints used by the dynamic tool-search processor. */
export const toolKeywords: Record<BuiltinToolId, string[]> = {
  file_read: ['read', 'open', 'view', 'file', 'cat'],
  file_write: ['write', 'create', 'save', 'file'],
  file_edit: ['edit', 'modify', 'replace', 'change', 'patch'],
  list_dir: ['list', 'directory', 'folder', 'ls'],
  grep: ['search', 'find', 'grep', 'pattern', 'match'],
  glob: ['glob', 'files', 'find', 'pattern', 'match', 'path'],
  bash: ['run', 'command', 'shell', 'execute', 'bash', 'terminal'],
  web_fetch: ['web', 'url', 'fetch', 'http', 'download', 'page', 'browse', 'website'],
  todo_write: ['todo', 'plan', 'task', 'checklist'],
  ask_user_question: ['ask', 'question', 'clarify', 'choose'],
  read_open_page: ['page', 'current', 'dom', 'read', 'open', '网页', '当前页', '内网', 'browser'],
  enter_plan_mode: ['plan', 'planning', 'explore', 'read-only'],
  exit_plan_mode: ['execute', 'exit plan', 'implement'],
};

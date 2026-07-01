import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { updateTodos, type TodoItem } from './todo-store';

const todoSchema = z.object({
  id: z.string(),
  content: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
});

/** Plan/Todo board the agent maintains (the agent TodoWriteTool). */
export const todoWrite = createTool({
  id: 'todo_write',
  description:
    'Create or update the structured todo list for the current task. Each call REPLACES the ' +
    'full list, so always send every item with its current status. Use this for any task with ' +
    'multiple steps: create the checklist up front, mark exactly one item in_progress when you ' +
    'start it, flip it to completed the moment it is done, and use cancelled for items no longer ' +
    'needed. Before ending your turn, make sure no item is left pending or in_progress. ' +
    'Skip the list only for trivial single-step requests.',
  inputSchema: z.object({
    todos: z.array(todoSchema).describe('The complete, current todo list (replaces the previous one)'),
  }),
  outputSchema: z.object({
    oldTodos: z.array(todoSchema),
    newTodos: z.array(todoSchema),
  }),
  execute: async (input, ctx) => {
    const persist = ctx?.requestContext?.get('persistTodos') as
      | ((todos: TodoItem[]) => Promise<{ oldTodos: TodoItem[]; newTodos: TodoItem[] }>)
      | undefined;
    if (persist) return persist(input.todos);
    const threadId = (ctx?.requestContext?.get('threadId') as string | undefined) ?? '__default__';
    return updateTodos(threadId, input.todos);
  },
});

const questionOptionSchema = z.object({
  label: z.string().describe('Concise display text for this choice (1-5 words).'),
  description: z
    .string()
    .default('')
    .describe('What this option means or what happens if chosen.'),
  preview: z
    .string()
    .optional()
    .describe('Optional preview content when this option is focused (mockup, snippet, etc.).'),
});

const questionSchema = z.object({
  question: z.string().describe('The complete question, ending with a question mark.'),
  header: z.string().describe('Very short chip label (max ~12 chars).'),
  options: z.array(questionOptionSchema).min(2).max(4),
  multiSelect: z.boolean().default(false),
});

const annotationSchema = z.object({
  preview: z.string().optional(),
  notes: z.string().optional(),
});

/** Client-completed tools suspend until the chat run is stopped (user answered on UI). */
function awaitClientToolCompletion(ctx: { requestContext?: { get: (key: string) => unknown } } | undefined): Promise<never> {
  const signal = ctx?.requestContext?.get('runAbortSignal') as AbortSignal | undefined;
  return new Promise((_resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    if (!signal) return;
    signal.addEventListener(
      'abort',
      () => {
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

/**
 * Ask the user structured multiple-choice questions (the agent AskUserQuestionTool).
 * Completed on the client; the server blocks this execute until the run is aborted.
 */
export const askUserQuestion = createTool({
  id: 'ask_user_question',
  description:
    'Prompt the user with 1-4 multiple-choice questions when you need a decision. ' +
    'Each question has a header and 2-4 options with descriptions. An "Other" choice is always offered in the UI.',
  inputSchema: z.object({
    questions: z.array(questionSchema).min(1).max(4),
  }),
  outputSchema: z.object({
    questions: z.array(questionSchema),
    answers: z.record(z.string(), z.string()),
    annotations: z.record(z.string(), annotationSchema).optional(),
  }),
  execute: async (_input, ctx) => {
    await awaitClientToolCompletion(ctx);
  },
});

/**
 * Read the currently open page in the desktop docked web view (intranet / logged-in DOM).
 * Completed on the client via the desktop web view.
 */
export const readOpenPage = createTool({
  id: 'read_open_page',
  description:
    'Read the full rendered content of the page currently open in the desktop web view ' +
    '(right-side docked browser). Use this for intranet pages the user has already opened ' +
    'and logged into — it captures JS-rendered DOM with session cookies. ' +
    'Do NOT use web_fetch for that case (web_fetch has no login session). ' +
    'Requires the desktop app and an open web-view window.',
  inputSchema: z.object({
    mode: z
      .enum(['text', 'html'])
      .optional()
      .describe('text = body innerText (default); html = document outerHTML'),
    maxChars: z
      .number()
      .int()
      .positive()
      .max(200_000)
      .optional()
      .describe('Max characters to return (default 50000)'),
  }),
  outputSchema: z.object({
    mode: z.enum(['text', 'html']).optional(),
    url: z.string().optional(),
    title: z.string().optional(),
    content: z.string().optional(),
    truncated: z.boolean().optional(),
    error: z.string().optional(),
  }),
  execute: async (_input, ctx) => {
    await awaitClientToolCompletion(ctx);
  },
});

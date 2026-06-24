import type { TodoItem } from '@veylin/tools';

/**
 * Builds `<system-reminder>` blocks injected into the system message at request
 * time. These nudge the model to keep its todo list healthy, modelled after
 * the agent's reminder mechanism — but with transparent wording (we never
 * tell the model to hide the reminder from the user).
 *
 * The base system prompt explains the `<system-reminder>` contract to the
 * model: authoritative, runtime-injected, and not to be recited verbatim.
 */

/** Wrap text in a single system-reminder tag. */
function reminder(text: string): string {
  return `<system-reminder>\n${text}\n</system-reminder>`;
}

const LOCALE_NAMES: Record<string, string> = {
  en: 'English',
  'zh-CN': 'Simplified Chinese',
};

/**
 * Builds a system-reminder instructing the agent to reply in the UI locale.
 * Returns '' for unknown/empty locales so the base "match the user's language"
 * rule applies.
 */
export function buildLocaleReminder(locale: string | undefined): string {
  if (!locale) return '';
  const normalized = locale.toLowerCase().startsWith('zh') ? 'zh-CN' : locale.startsWith('en') ? 'en' : locale;
  const name = LOCALE_NAMES[normalized];
  if (!name) return '';
  return reminder(
    `The user's interface language is ${name} (${normalized}). Write your replies to the user in ${name}, ` +
      'regardless of the language of these instructions or tool output. Keep code, identifiers, file paths, and quoted data verbatim.',
  );
}

/**
 * Heuristic: does the latest user request look like a multi-step task that
 * would benefit from a todo list? Deliberately conservative to avoid nagging
 * on simple questions.
 */
function looksMultiStep(text: string): boolean {
  const t = text.trim();
  if (t.length < 40) return false;
  const lower = t.toLowerCase();
  // Enumerations / explicit step language in either language.
  if (/\b(\d+\.|\d+\)|step\s+\d+|first|then|after that|finally)\b/.test(lower)) return true;
  if (/[一二三四五六七八九1-9][、.)]\s*\S/.test(t)) return true;
  if (/(然后|接着|之后|首先|最后|分别|依次|步骤)/.test(t)) return true;
  // Multiple imperative clauses joined by "and"/"、"/"，".
  const verbHits = (lower.match(/\b(add|create|build|implement|refactor|fix|update|migrate|test|deploy|remove|rename|review)\b/g) ?? []).length;
  if (verbHits >= 2) return true;
  const cnVerbHits = (t.match(/(新增|创建|实现|重构|修复|更新|迁移|测试|部署|删除|重命名|review|审查|调整|优化)/g) ?? []).length;
  if (cnVerbHits >= 2) return true;
  return false;
}

const STALE_MS = 10 * 60 * 1000;

export interface ReminderInput {
  todos: TodoItem[];
  lastUserText: string;
  /** When the thread state (incl. todos) was last persisted. */
  todosUpdatedAt?: Date;
  now?: Date;
}

/**
 * Returns a system-reminder block, or '' when no reminder is warranted.
 */
export function buildReminderBlock({
  todos,
  lastUserText,
  todosUpdatedAt,
  now = new Date(),
}: ReminderInput): string {
  const open = todos.filter((t) => t.status === 'pending' || t.status === 'in_progress');

  // 1) No list yet, but the request looks multi-step → suggest tracking it.
  if (todos.length === 0) {
    if (looksMultiStep(lastUserText)) {
      return reminder(
        'Your todo list is currently empty. If this task has multiple steps, create a ' +
          'checklist with the todo_write tool and keep it updated as you work. If the task ' +
          'is trivial, ignore this and proceed.',
      );
    }
    return '';
  }

  // 2) Open items exist. Remind about closing the loop, and flag staleness.
  const inProgress = open.filter((t) => t.status === 'in_progress').length;
  const isStale =
    todosUpdatedAt != null && now.getTime() - todosUpdatedAt.getTime() > STALE_MS;

  if (open.length > 0) {
    const lines = [
      `Your todo list has ${open.length} unfinished item(s).`,
    ];
    if (inProgress === 0) {
      lines.push(
        'None are marked in_progress — mark the item you are actively working on before continuing.',
      );
    }
    if (isStale) {
      lines.push(
        'It has not been updated in a while; update it with todo_write if the plan changed, ' +
          'and mark items completed as you finish them.',
      );
    }
    lines.push('Before finishing, make sure every item is completed or cancelled.');
    return reminder(lines.join(' '));
  }

  // 3) Everything is closed out — no reminder needed.
  return '';
}

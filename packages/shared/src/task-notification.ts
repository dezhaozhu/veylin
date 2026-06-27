export type TaskNotificationStatus = 'completed' | 'failed' | 'killed' | 'running';

export interface TaskNotificationUsage {
  total_tokens?: number;
  duration_ms?: number;
  tool_uses?: number;
}

export interface TaskNotification {
  taskId: string;
  status: TaskNotificationStatus;
  summary: string;
  result?: string;
  usage?: TaskNotificationUsage;
  subagent_type?: string;
  agent_id?: string;
}

const TAG = 'task-notification';

export function formatTaskNotification(n: TaskNotification): string {
  const lines = [
    `<${TAG}>`,
    `<task-id>${escapeXml(n.taskId)}</task-id>`,
    `<status>${n.status}</status>`,
    `<summary>${escapeXml(n.summary)}</summary>`,
  ];
  if (n.result != null && n.result !== '') {
    lines.push(`<result>${escapeXml(n.result)}</result>`);
  }
  if (n.usage && Object.keys(n.usage).length > 0) {
    lines.push('<usage>');
    if (n.usage.total_tokens != null) {
      lines.push(`  <total_tokens>${n.usage.total_tokens}</total_tokens>`);
    }
    if (n.usage.duration_ms != null) {
      lines.push(`  <duration_ms>${n.usage.duration_ms}</duration_ms>`);
    }
    if (n.usage.tool_uses != null) {
      lines.push(`  <tool_uses>${n.usage.tool_uses}</tool_uses>`);
    }
    lines.push('</usage>');
  }
  if (n.subagent_type) {
    lines.push(`<subagent-type>${escapeXml(n.subagent_type)}</subagent-type>`);
  }
  if (n.agent_id) {
    lines.push(`<agent-id>${escapeXml(n.agent_id)}</agent-id>`);
  }
  lines.push(`</${TAG}>`);
  return lines.join('\n');
}

export function parseTaskNotification(text: string): TaskNotification | null {
  const match = text.match(new RegExp(`<${TAG}>([\\s\\S]*?)</${TAG}>`, 'i'));
  if (!match) return null;
  const block = match[1] ?? '';
  const pick = (tag: string) => {
    const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
    return m?.[1]?.trim() ?? '';
  };
  const taskId = pick('task-id');
  const status = pick('status') as TaskNotificationStatus;
  const summary = pick('summary');
  if (!taskId || !status || !summary) return null;

  const usageBlock = block.match(/<usage>([\s\S]*?)<\/usage>/i)?.[1] ?? '';
  const usageNum = (tag: string) => {
    const m = usageBlock.match(new RegExp(`<${tag}>(\\d+)</${tag}>`, 'i'));
    return m ? Number(m[1]) : undefined;
  };
  const usage: TaskNotificationUsage = {};
  const totalTokens = usageNum('total_tokens');
  const durationMs = usageNum('duration_ms');
  const toolUses = usageNum('tool_uses');
  if (totalTokens != null) usage.total_tokens = totalTokens;
  if (durationMs != null) usage.duration_ms = durationMs;
  if (toolUses != null) usage.tool_uses = toolUses;

  const result = pick('result');
  const subagent_type = pick('subagent-type') || undefined;
  const agent_id = pick('agent-id') || undefined;

  const notification: TaskNotification = {
    taskId,
    status,
    summary,
    result: result || undefined,
    usage: Object.keys(usage).length > 0 ? usage : undefined,
  };
  if (subagent_type) notification.subagent_type = subagent_type;
  if (agent_id) notification.agent_id = agent_id;
  return notification;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

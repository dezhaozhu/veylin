/**
 * 点开聊天里拖进来的文件看一眼。
 *
 * 服务端用的是**和项目文件预览同一个抽取器**,回参也一样(`text` / `overview` /
 * `note`)—— 同一份 xlsx,从项目页点开和从聊天里点开,看到的必须是同一个东西。
 *
 * 失败一律**说出原话**:一个转圈转到空白的预览,比一句"这类文件看不了,用
 * Office 另存为 .docx 再来"更让人不知道该干嘛。
 */
import type { PreviewPayload } from './document-preview.js';

export type PreviewState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'text'; body: string; note?: string; payload: PreviewPayload }
  | { state: 'note'; body: string; payload: PreviewPayload };

export async function previewAttachment(
  name: string,
  data: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<PreviewState> {
  if (!data) {
    // 消息里的附件不一定还带着字节(历史线程只留了引用)。这不是错误,
    // 但也不能转圈等一个永远不来的响应。
    const body = '这个附件的内容已经不在本地了,看不了。';
    return { state: 'note', body, payload: { note: body } };
  }
  let body: PreviewPayload & { error?: string };
  try {
    const res = await fetchImpl('/api/attachment/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, data }),
    });
    body = (await res.json().catch(() => ({}))) as typeof body;
    if (!res.ok) {
      const note = body.error ?? `读不了(HTTP ${res.status})`;
      return { state: 'note', body: note, payload: { note } };
    }
  } catch (err) {
    const note = err instanceof Error ? err.message : String(err);
    return { state: 'note', body: note, payload: { note } };
  }
  // 表格没有 text,只有 overview —— 少看一个字段,表格就会显示成"没有内容"。
  // 缩略图/HTML 也一并带出去,由 document-preview 决定怎么显示。
  const payload: PreviewPayload = body;
  const text = body.text ?? body.overview ?? '';
  if (!text && !body.html && !body.thumbnail) {
    return { state: 'note', body: body.note ?? body.error ?? '这个文件没法在这里打开。', payload };
  }
  return { state: 'text', body: text, payload, ...(body.note ? { note: body.note } : {}) };
}

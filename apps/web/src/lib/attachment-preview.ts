/**
 * 点开聊天里拖进来的文件看一眼。
 *
 * 服务端用的是**和项目文件预览同一个抽取器**,回参也一样(`text` / `overview` /
 * `note`)—— 同一份 xlsx,从项目页点开和从聊天里点开,看到的必须是同一个东西。
 *
 * 失败一律**说出原话**:一个转圈转到空白的预览,比一句"这类文件看不了,用
 * Office 另存为 .docx 再来"更让人不知道该干嘛。
 */
export type PreviewState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'text'; body: string; note?: string }
  | { state: 'note'; body: string };

export async function previewAttachment(
  name: string,
  data: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<PreviewState> {
  if (!data) {
    // 消息里的附件不一定还带着字节(历史线程只留了引用)。这不是错误,
    // 但也不能转圈等一个永远不来的响应。
    return { state: 'note', body: '这个附件的内容已经不在本地了,看不了。' };
  }
  let body: { text?: string; overview?: string; note?: string; error?: string };
  try {
    const res = await fetchImpl('/api/attachment/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, data }),
    });
    body = (await res.json().catch(() => ({}))) as typeof body;
    if (!res.ok) return { state: 'note', body: body.error ?? `读不了(HTTP ${res.status})` };
  } catch (err) {
    return { state: 'note', body: err instanceof Error ? err.message : String(err) };
  }
  // 表格没有 text,只有 overview —— 少看一个字段,表格就会显示成"没有内容"。
  const text = body.text ?? body.overview ?? '';
  if (!text) return { state: 'note', body: body.note ?? body.error ?? '这个文件没有可直接预览的内容。' };
  return { state: 'text', body: text, ...(body.note ? { note: body.note } : {}) };
}

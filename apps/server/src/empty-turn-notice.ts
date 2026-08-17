/**
 * **一轮什么都没产出,就得明说。**
 *
 * 已经栽了两次,病因完全不同、症状一模一样(界面空白,用户以为"对话又没了"):
 *  1. 历史里悬空的前端 tool call → 每轮空 step;
 *  2. 附件 file part 重放 → provider 抛 UnsupportedFunctionality,而 Mastra 把
 *     错误 log 完就 `return`,我们外层的 catch 压根不触发。
 *
 * 所以这张网**不认病因**:只看这一轮有没有产出可见内容。病因还得各修各的
 * (那两条都修了),但"静默空白"这个症状本身不该再有第三次。
 */

/** 骨架 chunk(start/finish/step 边界/data-*)不算产出 —— 空轮次里剩下的正是这些。 */
export function isVisibleStreamPart(part: { type?: string } | null | undefined): boolean {
  const type = part?.type;
  if (!type) return false;
  if (type.startsWith('text-delta') || type === 'text') return true;
  if (type.startsWith('tool-')) return true;
  if (type.startsWith('reasoning')) return true;
  if (type === 'file' || type === 'source') return true;
  return false;
}

export const EMPTY_TURN_NOTICE =
  '这一轮没有产出任何内容 —— 通常是模型侧的调用出错了(错误在服务端日志里)。' +
  '可以直接再说一遍试试;要是每轮都这样,多半是这条对话的历史里有它读不了的东西。';

export function shouldReportEmptyTurn(state: {
  sawVisibleOutput: boolean;
  /** 挂起正等着人回答 —— 不是空轮次,报错反而是噪音。 */
  sawSuspension?: boolean;
  /** 用户自己按了停 —— 那是他要的结果。 */
  aborted?: boolean;
  /** 已经报过错就不再叠一句(一个事实一处表达)。 */
  sawError?: boolean;
}): boolean {
  if (state.sawVisibleOutput) return false;
  if (state.sawSuspension || state.aborted || state.sawError) return false;
  return true;
}

/**
 * 跨面版本一致性:表格是导入那一刻的排产(sheet.source.runId),甘特是刚拉的
 * (meta.run_id)。定位从一面落到另一面时比一次;不一致要**说出来**,不能静默定位到
 * 一个可能已经变了的位置。
 *
 * 三态而不是布尔:任一侧不知道自己是哪一版(老表没盖 run_id、没排产运行)就是
 * `unknown` —— 不知道不能当「一致」,也不能当「不一致」去吓人。
 */
export type RunMismatch = 'same' | 'differs' | 'unknown';

export function compareRuns(origin: string | null | undefined, landing: string | null | undefined): RunMismatch {
  if (!origin || !landing) return 'unknown';
  return origin === landing ? 'same' : 'differs';
}

/** 给人看的短 id:`tenantrun-2026-08-18T17:56:01.249392` → `08-18 17:56`;认不出的原样。 */
export function shortRunId(runId: string | null | undefined): string {
  if (!runId) return '';
  const m = /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(runId);
  return m ? `${m[2]}-${m[3]} ${m[4]}:${m[5]}` : runId;
}

/**
 * 哪几台连不上、分别为什么。
 *
 * 起因是实测:横幅只说"部分 MCP 服务连接失败",既点不出名字也展不开原因,
 * 重试也没反应。根子在 MCP 客户端库 —— 它把每台服务器的连接错误吞进 console,
 * `listToolsets()` 不抛,只是安静地少返回一个,上层于是只知道"它不在里面"。
 *
 * 所以这里自己去问一次。只问**远程**条目:本地 stdio 的没有 URL 可问。
 */
import { useEffect, useState } from 'react';

import { describeDiagnosis, diagnoseMcp } from '@/lib/mcp-oauth';
import type { McpHealthSnapshot, McpServer } from '@/hooks/settings/api';

export type FailingServer = { name: string; reason: string };

export function useFailingServers(
  health: McpHealthSnapshot | null,
  remote: McpServer[],
): FailingServer[] {
  const [failing, setFailing] = useState<FailingServer[]>([]);
  const down = (health?.servers ?? []).filter((s) => !s.connected).map((s) => s.name);
  const key = down.join(',');

  useEffect(() => {
    let alive = true;
    void (async () => {
      const out: FailingServer[] = [];
      for (const name of down) {
        const entry = remote.find((r) => r.name === name);
        // 本地条目没有地址可问 —— 说"问不出来",不编。
        const d = entry?.url ? await diagnoseMcp(entry.url) : null;
        out.push({ name, reason: describeDiagnosis(d) });
      }
      if (alive) setFailing(out);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return failing;
}

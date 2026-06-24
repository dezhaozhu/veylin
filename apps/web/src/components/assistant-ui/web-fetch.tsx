import { makeAssistantToolUI } from '@assistant-ui/react';
import { GlobeIcon, LoaderIcon } from 'lucide-react';

interface WebFetchArgs {
  url?: string;
  prompt?: string;
}

interface WebFetchResult {
  result?: string;
  code?: number;
  durationMs?: number;
  url?: string;
}

export const WebFetchToolUI = makeAssistantToolUI<WebFetchArgs, WebFetchResult>({
  toolName: 'web_fetch',
  display: 'standalone',
  render: ({ args, result, status }) => {
    let hostname = args?.url ?? '';
    try {
      if (args?.url) hostname = new URL(args.url).hostname;
    } catch {
      /* keep raw */
    }

    const running = status.type === 'running';
    const done = status.type === 'complete';

    return (
      <div className="border-border/60 bg-muted/20 my-2 rounded-lg border p-3 text-xs">
        <div className="text-muted-foreground mb-2 flex items-center gap-1.5 font-medium">
          {running ? (
            <LoaderIcon className="size-3.5 animate-spin" />
          ) : (
            <GlobeIcon className="size-3.5" />
          )}
          {running ? `Fetching ${hostname || 'page'}…` : `Fetch ${hostname || 'page'}`}
        </div>
        {args?.prompt && (
          <p className="text-muted-foreground mb-2">
            <span className="font-medium text-foreground">Prompt: </span>
            {args.prompt}
          </p>
        )}
        {done && result?.result && (
          <div className="border-border/40 bg-background/60 max-h-48 overflow-y-auto rounded border p-2 whitespace-pre-wrap">
            {result.result}
          </div>
        )}
        {done && result?.durationMs != null && (
          <p className="text-muted-foreground mt-1.5 tabular-nums">
            HTTP {result.code} · {(result.durationMs / 1000).toFixed(1)}s
          </p>
        )}
      </div>
    );
  },
});

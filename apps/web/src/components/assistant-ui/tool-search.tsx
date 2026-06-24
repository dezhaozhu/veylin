import { makeAssistantToolUI } from '@assistant-ui/react';
import { SearchIcon } from 'lucide-react';

interface ToolHit {
  id: string;
  score: number;
  description: string;
}

interface SearchResult {
  tools: ToolHit[];
}

export const ToolSearchToolUI = makeAssistantToolUI<
  { query: string; limit?: number },
  SearchResult
>({
  toolName: 'tool_search',
  render: ({ args, result, status }) => {
    const hits = result?.tools ?? [];
    if (status.type === 'running') {
      return (
        <div className="text-muted-foreground my-1 flex items-center gap-1.5 text-xs">
          <SearchIcon className="size-3.5" />
          Searching tools for &quot;{args?.query}&quot;…
        </div>
      );
    }
    if (hits.length === 0) return null;
    return (
      <div className="border-border/60 bg-muted/20 my-2 rounded-lg border p-2 text-xs">
        <div className="text-muted-foreground mb-1 flex items-center gap-1.5 font-medium">
          <SearchIcon className="size-3.5" />
          Tool search: {args?.query}
        </div>
        <ul className="flex flex-col gap-0.5">
          {hits.map((h) => (
            <li key={h.id} className="flex justify-between gap-2">
              <span className="font-mono">{h.id}</span>
              <span className="text-muted-foreground truncate">{h.description}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  },
});

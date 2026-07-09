import { makeAssistantToolUI } from '@assistant-ui/react';
import { SearchIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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
  render: function ToolSearchRender({ args, result, status }) {
    const { t } = useTranslation();
    const query = args?.query ?? '';
    const hits = result?.tools ?? [];
    if (status.type === 'running') {
      return (
        <div className="text-muted-foreground my-1 flex items-center gap-1.5 text-xs">
          <SearchIcon className="size-3.5" />
          {t('toolSearch.searching', { query })}
        </div>
      );
    }
    if (hits.length === 0) {
      return (
        <div className="border-border/60 bg-muted/20 my-2 rounded-lg border px-2 py-1.5 text-xs">
          <div className="text-muted-foreground flex items-center gap-1.5 font-medium">
            <SearchIcon className="size-3.5 shrink-0" />
            {t('toolSearch.noResults', { query })}
          </div>
          <p className="text-muted-foreground mt-1 ps-5">{t('toolSearch.noResultsHint')}</p>
        </div>
      );
    }
    return (
      <div className="border-border/60 bg-muted/20 my-2 rounded-lg border p-2 text-xs">
        <div className="text-muted-foreground mb-1 flex items-center gap-1.5 font-medium">
          <SearchIcon className="size-3.5" />
          {t('toolSearch.title', { query })}
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

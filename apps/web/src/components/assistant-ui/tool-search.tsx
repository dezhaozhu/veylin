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
        <div className="text-muted-foreground/50 my-1 flex items-center gap-1.5 text-base font-normal leading-snug">
          <SearchIcon className="size-4 shrink-0 opacity-70" />
          {t('toolSearch.searching', { query })}
        </div>
      );
    }
    if (hits.length === 0) {
      return (
        <div className="text-muted-foreground/50 my-1 text-base font-normal leading-snug">
          <div className="flex items-center gap-1.5">
            <SearchIcon className="size-4 shrink-0 opacity-70" />
            {t('toolSearch.noResults', { query })}
          </div>
          <p className="mt-1 ps-5 opacity-80">{t('toolSearch.noResultsHint')}</p>
        </div>
      );
    }
    return (
      <div className="text-muted-foreground/50 my-1 text-base font-normal leading-snug">
        <div className="mb-1 flex items-center gap-1.5">
          <SearchIcon className="size-4 shrink-0 opacity-70" />
          {t('toolSearch.title', { query })}
        </div>
        <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto ps-5">
          {hits.map((h) => (
            <li key={h.id} className="flex justify-between gap-2">
              <span>{h.id}</span>
              <span className="truncate opacity-80">{h.description}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  },
});

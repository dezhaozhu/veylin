import type { FC } from 'react';
import { cn } from '@/lib/utils';
import { skillMenuDescription } from '@/lib/skill-menu-description';
import { ComposerMenuPanel } from '@/components/assistant-ui/composer-menu-flyout';

export const ComposerSkillsFlyout: FC<{
  skills: { name: string; description: string }[];
  query: string;
  onSelect: (name: string) => void;
}> = ({ skills, query, onSelect }) => {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? skills.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q),
      )
    : skills;

  return (
    <ComposerMenuPanel className="max-h-72 overflow-y-auto">
      {filtered.length === 0 && (
        <div className="text-muted-foreground px-2.5 py-2 text-xs">No skills</div>
      )}
      {filtered.map((s) => (
        <button
          key={s.name}
          type="button"
          className="hover:bg-accent w-full rounded-md px-2.5 py-2 text-left"
          onClick={() => onSelect(s.name)}
        >
          <div className="text-sm font-medium">{s.name}</div>
          {s.description && (
            <div className="text-muted-foreground mt-0.5 truncate text-xs">
              {skillMenuDescription(s.description)}
            </div>
          )}
        </button>
      ))}
    </ComposerMenuPanel>
  );
};

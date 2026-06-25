import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SkillListItem } from '@/hooks/settings/api';
import { settingsApi } from '@/hooks/settings/api';
import { SettingsSwitch } from '../settings-switch';
import {
  PageHeader,
  PageSearchBar,
  PrimaryActionButton,
  SectionHeading,
} from '../page-header';
import {
  FormField,
  FormInput,
  FormTextarea,
  SettingsInlineEditor,
} from '../settings-form-dialog';
import { cn } from '@/lib/utils';

function SkillCard({
  skill,
  onToggle,
  onEdit,
  onDelete,
}: {
  skill: SkillListItem;
  onToggle: (enabled: boolean) => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="border-border bg-card flex items-start gap-3 rounded-xl border p-4">
      <div className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg text-xs font-bold">
        {skill.name.slice(0, 2).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{skill.name}</span>
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase',
              skill.source === 'bundled' ? 'bg-muted text-muted-foreground' : 'bg-blue-500/15 text-blue-600',
            )}
          >
            {skill.source}
          </span>
        </div>
        {skill.description && (
          <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{skill.description}</p>
        )}
        {skill.content && (
          <p className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-relaxed">
            {skill.content}
          </p>
        )}
        {skill.triggers?.length > 0 && (
          <p className="text-muted-foreground mt-1 text-xs">
            Triggers: {skill.triggers.join(', ')}
          </p>
        )}
        {skill.source === 'custom' && (
          <div className="mt-2 flex gap-3">
            {onEdit && (
              <button type="button" className="text-xs underline" onClick={onEdit}>
                Edit
              </button>
            )}
            {onDelete && (
              <button type="button" className="text-destructive text-xs underline" onClick={onDelete}>
                Delete
              </button>
            )}
          </div>
        )}
      </div>
      <SettingsSwitch checked={skill.enabled} onChange={onToggle} label={`Toggle ${skill.name}`} />
    </div>
  );
}

export function SkillsSettingsScreen() {
  const [skills, setSkills] = useState<SkillListItem[]>([]);
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SkillListItem | null>(null);
  const [form, setForm] = useState({ name: '', description: '', content: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await settingsApi.getSkills();
      setSkills(data.skills);
      setDisabled(new Set(data.disabledSkills));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const q = query.trim().toLowerCase();
  const bundled = useMemo(
    () => skills.filter((s) => s.source === 'bundled' && (!q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))),
    [skills, q],
  );
  const custom = useMemo(
    () => skills.filter((s) => s.source === 'custom' && (!q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))),
    [skills, q],
  );

  const toggleBundled = async (name: string, enabled: boolean) => {
    const next = new Set(disabled);
    if (enabled) next.delete(name);
    else next.add(name);
    setDisabled(next);
    setSkills((prev) =>
      prev.map((s) => (s.name === name && s.source === 'bundled' ? { ...s, enabled } : s)),
    );
    await settingsApi.saveDisabledSkills([...next]);
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', description: '', content: '' });
    setDialogOpen(true);
  };

  const openEdit = (skill: SkillListItem) => {
    setEditing(skill);
    setForm({
      name: skill.name,
      description: skill.description,
      content: skill.content ?? '',
    });
    setDialogOpen(true);
  };

  const saveCustom = async () => {
    if (!form.name.trim() || !form.content.trim()) return;
    try {
      const saved = editing?.id
        ? await settingsApi.updateSkill(editing.id, form)
        : await settingsApi.createSkill(form);
      setSkills((prev) =>
        editing?.id
          ? prev.map((skill) =>
              skill.source === 'custom' && skill.id === saved.skill.id ? saved.skill : skill,
            )
          : [saved.skill, ...prev],
      );
      setDialogOpen(false);
      setEditing(null);
      await load();
    } catch (err) {
      alert(`Failed to save skill: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (loading) {
    return <div className="text-muted-foreground text-sm">Loading skills…</div>;
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Skills"
        description="Enable bundled skills or create custom knowledge blocks that agents can activate during conversations."
        action={<PrimaryActionButton onClick={openCreate}>Add custom skill</PrimaryActionButton>}
      />

      <PageSearchBar value={query} onChange={setQuery} placeholder="Search skills…" />

      <SettingsInlineEditor
        open={dialogOpen}
        title={editing ? 'Edit skill' : 'Add custom skill'}
        description="Skills provide specialized knowledge the agent can load when relevant."
        submitLabel={editing ? 'Save changes' : 'Add skill'}
        onSubmit={() => void saveCustom()}
        onCancel={() => setDialogOpen(false)}
      >
        <FormField label="Name" required>
          <FormInput
            placeholder="e.g. schedule-risk-review"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </FormField>
        <FormField label="Description" hint="Short summary shown in the skills list.">
          <FormInput
            placeholder="What this skill helps with"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </FormField>
        <FormField label="Content" required hint="Markdown body injected when the skill is activated.">
          <FormTextarea
            placeholder="## When to use&#10;..."
            value={form.content}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
          />
        </FormField>
      </SettingsInlineEditor>

      <section className="mb-8">
        <SectionHeading title="Built-in" count={bundled.length} />
        <div className="flex flex-col gap-2">
          {bundled.map((s) => (
            <SkillCard
              key={s.name}
              skill={s}
              onToggle={(on) => void toggleBundled(s.name, on)}
            />
          ))}
        </div>
      </section>

      <section className="mb-8">
        <SectionHeading title="Custom" count={custom.length} />
        <div className="flex flex-col gap-2">
          {custom.map((s) => (
            <SkillCard
              key={s.id ?? s.name}
              skill={s}
              onToggle={async (on) => {
                if (s.id) {
                  await settingsApi.updateSkill(s.id, { enabled: on });
                  await load();
                }
              }}
              onEdit={() => openEdit(s)}
              onDelete={async () => {
                if (s.id && confirm('Delete this skill?')) {
                  await settingsApi.deleteSkill(s.id);
                  await load();
                }
              }}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

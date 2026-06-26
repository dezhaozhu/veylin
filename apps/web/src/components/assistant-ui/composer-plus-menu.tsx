import { useComposerAddAttachment } from '@assistant-ui/core/react';
import {
  BookOpenIcon,
  FileTextIcon,
  ImageIcon,
  Minimize2Icon,
  NotebookPenIcon,
  PlugIcon,
  PlusIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState, type FC } from 'react';
import { useAui, useAuiState } from '@assistant-ui/store';
import { applyCompactToThread } from '@/lib/compact-context';
import { getChatSettings } from '@/lib/chat-settings';
import { commitPendingSkillAtEnd } from '@/lib/composer-pending-skill';
import { TooltipIconButton } from '@/components/assistant-ui/tooltip-icon-button';
import {
  ComposerMenuFlyoutItem,
  ComposerMenuPanel,
  ComposerMenuRow,
  ComposerMenuSeparator,
} from '@/components/assistant-ui/composer-menu-flyout';
import { ComposerMcpFlyout } from '@/components/assistant-ui/composer-mcp-flyout';
import { ComposerSkillsFlyout } from '@/components/assistant-ui/composer-skills-flyout';
import { addComposerFiles } from '@/lib/add-composer-files';
import { FILE_ATTACHMENT_ACCEPT } from '@/lib/file-attachment-adapter';
import {
  useAgentContext,
  useMcpEnabled,
  usePendingSkill,
  usePlanMode,
} from '@/lib/use-composer-settings';

type Submenu = 'skills' | 'mcp' | null;

export const ComposerPlusMenu: FC = () => {
  const aui = useAui();
  const threadId = useAuiState(
    (s) => s.threadListItem.remoteId ?? s.threadListItem.externalId,
  );
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<Submenu>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [mcpSearch, setMcpSearch] = useState('');
  const [compacting, setCompacting] = useState(false);
  const { addAttachment } = useComposerAddAttachment();

  const { planMode, togglePlanMode } = usePlanMode();
  const { setPendingSkill } = usePendingSkill();
  const { isServerEnabled, setServerEnabled } = useMcpEnabled();
  const { context } = useAgentContext(open);

  const close = useCallback(() => {
    setOpen(false);
    setSubmenu(null);
    setSearchQuery('');
    setMcpSearch('');
  }, []);

  const openImagePicker = useCallback(() => {
    if (!addAttachment) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.hidden = true;
    document.body.appendChild(input);
    input.onchange = () => {
      const files = input.files;
      if (files && files.length > 0) {
        void addComposerFiles((file) => addAttachment(file), files);
      }
      document.body.removeChild(input);
    };
    input.click();
    close();
  }, [addAttachment, close]);

  const openDocumentPicker = useCallback(() => {
    if (!addAttachment) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = FILE_ATTACHMENT_ACCEPT;
    input.multiple = true;
    input.hidden = true;
    document.body.appendChild(input);
    input.onchange = () => {
      const files = input.files;
      if (files && files.length > 0) {
        void addComposerFiles((file) => addAttachment(file), files);
      }
      document.body.removeChild(input);
    };
    input.click();
    close();
  }, [addAttachment, close]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const selectSkill = (name: string) => {
    const composer = aui.composer();
    const text = composer.getState().text;
    commitPendingSkillAtEnd(
      (next) => composer.setText(next),
      setPendingSkill,
      text,
      name,
    );
    close();
  };

  const compactContext = useCallback(async () => {
    if (!threadId || compacting) return;
    setCompacting(true);
    try {
      const { model } = getChatSettings();
      const result = await applyCompactToThread(aui, threadId, model);
      if (!result.ok) {
        console.warn('[compact]', result.error);
      }
    } finally {
      setCompacting(false);
      close();
    }
  }, [aui, threadId, compacting, close]);

  const skills = context?.skills ?? [];
  const mcpServers = context?.mcpServers ?? [];

  return (
    <div className="relative shrink-0">
      <TooltipIconButton
        tooltip="Add context"
        side="bottom"
        type="button"
        variant="ghost"
        size="icon"
        className="aui-composer-plus hover:bg-muted-foreground/15 size-7 rounded-full"
        aria-label="Add context"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <PlusIcon className="size-4.5 stroke-[1.5px]" />
      </TooltipIconButton>

      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40"
            aria-label="Close menu"
            onClick={close}
          />
          <div
            className="absolute bottom-full left-0 z-50 mb-2"
            onClick={(e) => e.stopPropagation()}
          >
            <ComposerMenuPanel className="min-w-[240px]">
              <div className="px-1 pb-1">
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Add context, tools..."
                  className="border-input bg-background placeholder:text-muted-foreground h-8 w-full rounded-md border px-2.5 text-xs outline-none"
                />
              </div>

              <ComposerMenuRow
                icon={<NotebookPenIcon className="size-4" />}
                label="Plan"
                pressed={planMode}
                onClick={() => {
                  togglePlanMode();
                  close();
                }}
              />
              <ComposerMenuSeparator />

              <ComposerMenuRow
                icon={<ImageIcon className="size-4" />}
                label="Image"
                onClick={openImagePicker}
              />
              <ComposerMenuRow
                icon={<FileTextIcon className="size-4" />}
                label="Document"
                onClick={openDocumentPicker}
              />

              <ComposerMenuFlyoutItem
                icon={<BookOpenIcon className="size-4" />}
                label="Skills"
                active={submenu === 'skills'}
                onOpen={() => setSubmenu('skills')}
              >
                <ComposerSkillsFlyout
                  skills={skills}
                  query={searchQuery}
                  onSelect={selectSkill}
                />
              </ComposerMenuFlyoutItem>

              <ComposerMenuFlyoutItem
                icon={<PlugIcon className="size-4" />}
                label="MCP Servers"
                active={submenu === 'mcp'}
                onOpen={() => setSubmenu('mcp')}
              >
                <ComposerMcpFlyout
                  servers={mcpServers}
                  query={mcpSearch}
                  onQueryChange={setMcpSearch}
                  isEnabled={isServerEnabled}
                  onToggle={setServerEnabled}
                />
              </ComposerMenuFlyoutItem>

              <ComposerMenuRow
                icon={<Minimize2Icon className="size-4" />}
                label={compacting ? 'Compressing…' : 'Compact context'}
                onClick={() => {
                  if (!threadId || compacting) return;
                  void compactContext();
                }}
              />
            </ComposerMenuPanel>
          </div>
        </>
      )}
    </div>
  );
};

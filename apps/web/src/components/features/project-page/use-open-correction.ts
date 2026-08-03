import { useCallback } from 'react';
import { useAui } from '@assistant-ui/react';
import { useTranslation } from 'react-i18next';
import { useSettingsPanel } from '@/hooks/settings/use-settings-panel';
import { placeComposerCaret } from '@/lib/composer-caret';
import { correctionDraftSpec, type CorrectionPayload } from '@/lib/correction-bridge';
import { projectSourceLabel } from '@/lib/project-labels';
import { postThreadProject, writeCachedThreadProject } from '@/lib/project-sync';
import { invalidateThreadProjects } from '@/lib/thread-projects-sync';

/**
 * 修正桥, 项目首页 context — the ONE implementation of "this card is wrong",
 * shared by both shapes the cards area can take:
 * - the side-by-side widget cell (scene-card-cell.tsx), where the request
 *   arrives as a postMessage from the widget iframe and is validated by
 *   McpAppActionBridge/parseCorrectionMessage first;
 * - the 对比合并视图 table (scene-card-merge-table.tsx), where the host itself
 *   composes the payload from the row it is already rendering.
 *
 * Both end in the same sequence: create a thread → pin it to the page's
 * CURRENT project → prefill the composer with a draft → leave the workspace
 * for the chat with the caret at the end. Nothing is auto-sent.
 *
 * SECURITY INVARIANT (unchanged from Phase 3): the TARGET is derived from host
 * context only — `projectId` is the page's prop and the scene label is the
 * caller's own column/cell source. Nothing in a widget message ever selects
 * where the draft lands; payload strings are untrusted display text that reach
 * only a user-editable composer draft.
 */

/**
 * One correction at a time, ACROSS every path on the page: `aui.threads()` is
 * app-global, so two overlapping create→pin sequences would both resolve
 * `item('main')` to whichever thread was created last — two pins on one
 * thread, an orphan thread, and a draft naming the other card's scene. Module
 * scope is the right granularity (a page mounts many cells and one table, and
 * per-mount refs cannot serialize across them), and it must stay a SINGLE flag
 * shared by both paths — a second copy would let a cell and the table race.
 */
let correctionInFlight = false;

export type OpenCorrection = (source: string, payload: CorrectionPayload) => void;

/**
 * @param projectId the page's current project — the draft's only possible home.
 * The returned callback takes the SOURCE (scene) of the cell/column that was
 * clicked, since one page can show several, and the payload to quote.
 */
export function useOpenCorrection(projectId: string): OpenCorrection {
  const { t } = useTranslation();
  const aui = useAui();
  const { closeWorkspace } = useSettingsPanel();

  return useCallback(
    (source: string, p: CorrectionPayload) => {
      if (correctionInFlight) return;
      correctionInFlight = true;
      void (async () => {
        try {
          await aui.threads().switchToNewThread();
          const item = aui.threads().item('main');
          const initialized = await item.initialize();
          // Triple fallback as in project-list.tsx — the local id later
          // BECOMES the remoteId, so the pin lands under the right key.
          const rid = initialized.remoteId ?? initialized.externalId ?? item.getState().id;
          const confirmed = await postThreadProject(rid, projectId);
          writeCachedThreadProject(rid, confirmed ?? projectId);
          invalidateThreadProjects();
          const spec = correctionDraftSpec(projectSourceLabel(source), p);
          const draft = t(spec.key, spec.vars);
          aui.composer().setText(draft);
          closeWorkspace();
          placeComposerCaret(draft.length);
        } catch (err) {
          console.error('[scene-card] open-correction failed:', err);
        } finally {
          correctionInFlight = false;
        }
      })();
    },
    [aui, projectId, t, closeWorkspace],
  );
}

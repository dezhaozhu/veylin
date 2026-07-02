import { makeAssistantToolUI } from '@assistant-ui/react';
import { Layers3Icon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  setViewer3dSelectionRequest,
  type Viewer3dSelectionRequest,
} from '@/lib/viewer3d-selection-session';

interface Args {
  prompt: string;
}

interface Result {
  face_ids: number[];
  cancelled?: boolean;
}

/**
 * request_3d_selection tool UI. Structure mirrors read-open-page.tsx
 * (makeAssistantToolUI, standalone display); the fill-in timing mirrors
 * ask-user-question.tsx's session bridge — while awaiting an answer, publish
 * {toolCallId, prompt, confirm, cancel} to the viewer3d selection session so
 * the '3d' right-panel can render the prompt bar and call back into
 * `addResult` via a stable ref (avoids capturing a stale closure).
 */
export const Request3dSelectionToolUI = makeAssistantToolUI<Args, Result>({
  toolName: 'request_3d_selection',
  display: 'standalone',
  render: ({ args, addResult, result, toolCallId, status }) => {
    const { t } = useTranslation();
    const prompt = args?.prompt ?? '';
    const answered = Array.isArray(result?.face_ids);
    const awaiting = Boolean(addResult) && !answered && status.type !== 'complete';
    const addResultRef = useRef(addResult);
    addResultRef.current = addResult;

    useEffect(() => {
      if (!awaiting) {
        setViewer3dSelectionRequest(null);
        return;
      }
      const request: Viewer3dSelectionRequest = {
        toolCallId,
        prompt,
        confirm: (faceIds) => {
          const fn = addResultRef.current;
          if (!fn) {
            throw new Error('request_3d_selection addResult unavailable');
          }
          fn({ face_ids: faceIds });
        },
        cancel: () => {
          const fn = addResultRef.current;
          if (!fn) {
            throw new Error('request_3d_selection addResult unavailable');
          }
          fn({ face_ids: [], cancelled: true });
        },
      };
      setViewer3dSelectionRequest(request);
      return () => setViewer3dSelectionRequest(null);
    }, [awaiting, toolCallId, prompt]);

    if (awaiting) {
      return (
        <div className="border-border/60 bg-muted/30 my-1 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs">
          <Layers3Icon className="text-primary size-3.5 shrink-0" />
          <p className="text-foreground">{t('viewer3d.awaitingSelection', { prompt })}</p>
        </div>
      );
    }

    if (answered && result) {
      const cancelled = Boolean(result.cancelled);
      return (
        <div className="text-muted-foreground my-1 text-xs">
          <div className="mb-1 flex items-center gap-1.5 font-medium">
            <Layers3Icon className="size-3.5" />
            {cancelled ? t('viewer3d.selectionCancelled') : t('viewer3d.selectionConfirmed')}
          </div>
          {!cancelled && result.face_ids.length > 0 ? (
            <p>{t('viewer3d.selectedFaces', { ids: result.face_ids.join(', ') })}</p>
          ) : null}
        </div>
      );
    }

    return null;
  },
});

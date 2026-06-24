import type {
  AttachmentAdapter,
  PendingAttachment,
  CompleteAttachment,
} from '@assistant-ui/react';

const MAX_BYTES = 20 * 1024 * 1024; // ~20MB raw (API 32MB limit after base64).

/** Shared with composer menus and drag-drop adapters. */
export const FILE_ATTACHMENT_ACCEPT =
  'application/pdf,.pdf,' +
  'text/*,' +
  'application/json,.json,.jsonc,.json5,' +
  'application/xml,text/xml,.xml,' +
  'application/yaml,application/x-yaml,text/yaml,.yaml,.yml,' +
  'application/javascript,text/javascript,.js,.mjs,.cjs,' +
  'application/typescript,.ts,.tsx,.jsx,.vue,.svelte,.astro,' +
  'application/sql,.sql,' +
  '.md,.markdown,.txt,.csv,.tsv,.toml,.ini,.cfg,.conf,.env,.log,.svg,.ipynb';

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Attachment adapter for documents (PDF and other non-image files). Produces a
 * `file` message part carrying a data URL; the server decodes text-like files
 * into inline content (the agent Read-style line numbers) before calling the model.
 */
export class FileAttachmentAdapter implements AttachmentAdapter {
  accept = FILE_ATTACHMENT_ACCEPT;

  async add({ file }: { file: File }): Promise<PendingAttachment> {
    if (file.size > MAX_BYTES) {
      throw new Error(`File exceeds ${MAX_BYTES / (1024 * 1024)}MB limit`);
    }
    return {
      id: crypto.randomUUID(),
      type: 'document',
      name: file.name,
      contentType: file.type || 'application/octet-stream',
      file,
      status: { type: 'requires-action', reason: 'composer-send' },
    };
  }

  async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    const dataUrl = await readAsDataURL(attachment.file);
    return {
      ...attachment,
      status: { type: 'complete' },
      content: [
        {
          type: 'file',
          data: dataUrl,
          mimeType: attachment.file.type || 'application/octet-stream',
          filename: attachment.name,
        },
      ],
    };
  }

  async remove(): Promise<void> {
    // Nothing to clean up; data URLs are inlined.
  }
}

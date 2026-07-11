import { LangfuseMedia } from '@langfuse/core';

/** Minimal UIMessage file-part shape used for Langfuse media metadata. */
export type TraceAttachmentPart = {
  type?: string;
  mediaType?: string;
  url?: string;
  filename?: string;
};

export type TraceAttachmentMeta =
  | {
      kind: 'media';
      filename: string;
      mediaType: string;
      sizeBytes: number;
      media: LangfuseMedia;
    }
  | {
      kind: 'text';
      filename: string;
      mediaType: string;
      sizeBytes: number;
      preview: string;
    }
  | {
      kind: 'skipped';
      filename: string;
      mediaType: string;
      sizeBytes: number;
      reason: 'too_large' | 'missing_url' | 'unsupported';
    };

const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
const TEXT_PREVIEW_CHARS = 500;

const MEDIA_CONTENT_TYPES = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'image/tiff',
  'image/bmp',
  'image/avif',
  'image/heic',
  'application/pdf',
  'text/plain',
  'text/html',
  'text/css',
  'text/csv',
  'text/markdown',
  'application/json',
  'application/xml',
  'application/octet-stream',
]);

function dataUrlByteLength(url: string): number {
  const comma = url.indexOf(',');
  if (!url.startsWith('data:') || comma < 0) return 0;
  const b64 = url.slice(comma + 1);
  // Rough decoded size; padding ignored for the size gate.
  return Math.floor((b64.length * 3) / 4);
}

function decodeDataUrlPreview(url: string): string | null {
  const comma = url.indexOf(',');
  if (!url.startsWith('data:') || comma < 0) return null;
  try {
    const raw = Buffer.from(url.slice(comma + 1), 'base64').toString('utf8');
    if (raw.includes('\0')) return null;
    return raw.length > TEXT_PREVIEW_CHARS
      ? `${raw.slice(0, TEXT_PREVIEW_CHARS)}…`
      : raw;
  } catch {
    return null;
  }
}

function isTextLikeMime(mediaType: string, filename: string): boolean {
  if (mediaType.startsWith('text/')) return true;
  if (
    mediaType === 'application/json' ||
    mediaType === 'application/xml' ||
    mediaType === 'application/javascript' ||
    mediaType === 'application/x-yaml'
  ) {
    return true;
  }
  const lower = filename.toLowerCase();
  return /\.(txt|md|markdown|json|ya?ml|xml|csv|tsv|js|ts|tsx|jsx|css|html|py|rs|go|sh)$/.test(
    lower,
  );
}

/**
 * Collect UIMessage file parts into Langfuse-friendly attachment metadata.
 * Images/PDFs become LangfuseMedia (JSON-serializes to data URI → auto Media upload).
 * Text attachments get filename + truncated preview only.
 */
export function collectLangfuseAttachments(
  messages: Array<{ parts?: TraceAttachmentPart[] | undefined }>,
): TraceAttachmentMeta[] {
  const out: TraceAttachmentMeta[] = [];
  for (const msg of messages) {
    for (const part of msg.parts ?? []) {
      if (part.type !== 'file') continue;
      const filename = part.filename?.trim() || 'attachment';
      const mediaType = part.mediaType?.trim() || 'application/octet-stream';
      const url = part.url;
      if (!url) {
        out.push({
          kind: 'skipped',
          filename,
          mediaType,
          sizeBytes: 0,
          reason: 'missing_url',
        });
        continue;
      }

      const sizeBytes = dataUrlByteLength(url);
      if (sizeBytes > MAX_MEDIA_BYTES) {
        out.push({
          kind: 'skipped',
          filename,
          mediaType,
          sizeBytes,
          reason: 'too_large',
        });
        continue;
      }

      if (mediaType.startsWith('image/') || mediaType === 'application/pdf') {
        if (!url.startsWith('data:')) {
          out.push({
            kind: 'skipped',
            filename,
            mediaType,
            sizeBytes,
            reason: 'unsupported',
          });
          continue;
        }
        out.push({
          kind: 'media',
          filename,
          mediaType,
          sizeBytes,
          media: new LangfuseMedia({
            source: 'base64_data_uri',
            base64DataUri: url,
          }),
        });
        continue;
      }

      if (isTextLikeMime(mediaType, filename)) {
        const preview = decodeDataUrlPreview(url) ?? '';
        out.push({
          kind: 'text',
          filename,
          mediaType,
          sizeBytes,
          preview,
        });
        continue;
      }

      // Other document MIME types Langfuse accepts — upload original bytes.
      if (url.startsWith('data:') && MEDIA_CONTENT_TYPES.has(mediaType)) {
        out.push({
          kind: 'media',
          filename,
          mediaType,
          sizeBytes,
          media: new LangfuseMedia({
            source: 'base64_data_uri',
            base64DataUri: url,
          }),
        });
        continue;
      }

      out.push({
        kind: 'skipped',
        filename,
        mediaType,
        sizeBytes,
        reason: 'unsupported',
      });
    }
  }
  return out;
}

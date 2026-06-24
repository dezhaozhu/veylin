import { urlCache, type CacheEntry } from './cache';
import { applyPromptToMarkdown, MAX_MARKDOWN_LENGTH } from './llm';
import { htmlToMarkdown, isBinaryContentType } from './markdown';
import { isPreapprovedUrl } from './preapproved';
import {
  httpStatusText,
  isPermittedRedirect,
  upgradeToHttps,
  validateUrl,
} from './security';

const FETCH_TIMEOUT_MS = Number(process.env.VEYLIN_WEB_FETCH_TIMEOUT_MS ?? 60_000);
const MAX_HTTP_BYTES = Number(process.env.VEYLIN_WEB_FETCH_MAX_BYTES ?? 10 * 1024 * 1024);
const MAX_REDIRECTS = 10;
const USER_AGENT = process.env.VEYLIN_WEB_FETCH_USER_AGENT ?? 'Veylin-WebFetch/1.0';

export type RedirectInfo = {
  type: 'redirect';
  originalUrl: string;
  redirectUrl: string;
  statusCode: number;
};

export type FetchedContent = CacheEntry;

async function fetchWithPermittedRedirects(
  url: string,
  depth = 0,
): Promise<Response | RedirectInfo> {
  if (depth > MAX_REDIRECTS) {
    throw new Error(`Too many redirects (exceeded ${MAX_REDIRECTS})`);
  }

  const res = await fetch(url, {
    redirect: 'manual',
    headers: {
      Accept: 'text/markdown, text/html, text/plain, application/json, */*',
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if ([301, 302, 307, 308].includes(res.status)) {
    const location = res.headers.get('location');
    if (!location) throw new Error('Redirect missing Location header');
    const redirectUrl = new URL(location, url).toString();
    if (isPermittedRedirect(url, redirectUrl)) {
      return fetchWithPermittedRedirects(redirectUrl, depth + 1);
    }
    return { type: 'redirect', originalUrl: url, redirectUrl, statusCode: res.status };
  }

  return res;
}

function formatRedirectMessage(originalUrl: string, info: RedirectInfo, prompt: string): string {
  const statusText = httpStatusText(info.statusCode);
  return `REDIRECT DETECTED: The URL redirects to a different host.

Original URL: ${originalUrl}
Redirect URL: ${info.redirectUrl}
Status: ${info.statusCode} ${statusText}

To complete your request, fetch content from the redirected URL. Use web_fetch again with:
- url: "${info.redirectUrl}"
- prompt: "${prompt.replace(/"/g, '\\"')}"`;
}

/** Fetch URL, convert HTML→markdown, cache raw content (the agent WebFetch core). */
export async function getUrlMarkdownContent(
  url: string,
): Promise<FetchedContent | RedirectInfo> {
  if (!validateUrl(url)) {
    throw new Error('Invalid URL');
  }

  const cached = urlCache.get(url);
  if (cached) return cached;

  const fetchUrl = upgradeToHttps(url);
  const response = await fetchWithPermittedRedirects(fetchUrl);

  if ('type' in response && response.type === 'redirect') {
    return response;
  }

  if (!response.ok && response.status !== 200) {
    // Still return body for 404 etc. so the model can reason about it.
  }

  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  const buf = Buffer.from(await response.arrayBuffer());
  if (buf.length > MAX_HTTP_BYTES) {
    throw new Error(`Response exceeds ${MAX_HTTP_BYTES / (1024 * 1024)}MB limit`);
  }

  if (isBinaryContentType(contentType)) {
    throw new Error(
      `Binary content (${contentType}, ${buf.length} bytes) cannot be processed as web text. ` +
        `For PDFs/images attach them in the composer instead.`,
    );
  }

  const raw = buf.toString('utf8');
  const markdown = contentType.includes('text/html') ? htmlToMarkdown(raw) : raw;
  const contentBytes = Buffer.byteLength(markdown);

  const entry: CacheEntry = {
    bytes: buf.length,
    code: response.status,
    codeText: response.statusText || httpStatusText(response.status),
    content: markdown,
    contentType,
  };
  urlCache.set(url, entry, { size: Math.max(1, contentBytes) });
  return entry;
}

/** Full WebFetch pipeline: fetch → (optional LLM) → result string. */
export async function runWebFetch(url: string, prompt: string): Promise<{
  bytes: number;
  code: number;
  codeText: string;
  result: string;
  durationMs: number;
  url: string;
}> {
  const start = Date.now();
  const fetched = await getUrlMarkdownContent(url);

  if ('type' in fetched && fetched.type === 'redirect') {
    const message = formatRedirectMessage(url, fetched, prompt);
    return {
      bytes: Buffer.byteLength(message),
      code: fetched.statusCode,
      codeText: httpStatusText(fetched.statusCode),
      result: message,
      durationMs: Date.now() - start,
      url,
    };
  }

  const page = fetched as FetchedContent;
  const { content, bytes, code, codeText, contentType } = page;
  const preapproved = isPreapprovedUrl(url);

  let result: string;
  if (preapproved && contentType.includes('text/markdown') && content.length < MAX_MARKDOWN_LENGTH) {
    result = content;
  } else {
    result = await applyPromptToMarkdown(prompt, content, preapproved);
  }

  return {
    bytes,
    code,
    codeText,
    result,
    durationMs: Date.now() - start,
    url,
  };
}

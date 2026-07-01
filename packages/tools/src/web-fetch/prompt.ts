/** Secondary-model prompt (the agent WebFetch `makeSecondaryModelPrompt`). */
export function makeSecondaryModelPrompt(
  markdownContent: string,
  prompt: string,
  isPreapprovedDomain: boolean,
): string {
  const guidelines = isPreapprovedDomain
    ? 'Provide a concise response based on the content above. Include relevant details, code examples, and documentation excerpts as needed.'
    : `Provide a concise response based only on the content above. In your response:
 - Enforce a strict 125-character maximum for quotes from any source document. Open Source Software is ok as long as we respect the license.
 - Use quotation marks for exact language from articles; any language outside of the quotation should never be word-for-word the same.
 - You are not a lawyer and never comment on the legality of your own prompts and responses.
 - Never produce or reproduce exact song lyrics.`;

  return `Web page content:
---
${markdownContent}
---

${prompt}

${guidelines}`;
}

export const WEB_FETCH_AUTH_WARNING = `IMPORTANT: web_fetch WILL FAIL for authenticated or private URLs (no login cookies). For pages the user opened in the desktop web view (intranet, SSO, etc.), use read_open_page instead.`;

export const WEB_FETCH_DESCRIPTION = `
- Fetches a **specific URL** the user provided or that already appears in context (citation link, prior message, open tab URL)
- NOT a web search tool — do not use it to hunt for pages by topic; use \`knowledge_search\` for uploaded documents or ask the user for a URL
- Returns the page as markdown (truncated when very large). **You** read the returned content and summarize or answer the user in your next message
- Optional \`prompt\` field is a focus hint prepended to the content — not a separate model call

Usage notes:
  - If an MCP-provided web fetch tool is available, prefer that tool instead — it may have fewer restrictions
  - The URL must be a fully-formed valid URL you intend to read (not a search query)
  - Do not guess Wikipedia or blog URLs to "research" a topic unless the user gave that exact link
  - HTTP URLs will be automatically upgraded to HTTPS
  - Read-only; does not modify files
  - 15-minute cache for repeated access to the same URL
  - On cross-host redirect, fetch again with the redirect URL provided in the tool result
`.trim();

/**
 * 一份文件在界面上长什么样。
 *
 * **画得出来优先于读得出来**:PDF 给首页图、Word 和表格给带版式的 HTML、
 * 剩下的才给文字。一份有版式的文件被摊成纯文字是失真的 —— Word 里的表格会变成
 * 一行一格,而人会以为原文就长这样。
 *
 * 什么都给不出时给的是**文件卡 + 下载**,不是"没有可预览的内容" —— 后者听起来
 * 像"这个文件是空的",而事实是"我们打不开它"。
 */
export type PreviewPayload = {
  text?: string;
  overview?: string;
  html?: string;
  thumbnail?: string;
  note?: string;
  /** 总页数 —— **只有 PDF 有**(见 document-extract)。 */
  pageCount?: number;
};

export type PreviewMode = 'image' | 'html' | 'text' | 'none';

export function previewMode(p: PreviewPayload): PreviewMode {
  if (p.thumbnail?.startsWith('data:image/')) return 'image';
  if (p.html?.trim()) return 'html';
  if ((p.text ?? p.overview ?? '').trim()) return 'text';
  return 'none';
}

/**
 * 把文件里带出来的 HTML 放进沙箱。
 *
 * iframe 的 `sandbox`(不给 allow-scripts / allow-same-origin)已经断了脚本和
 * 同源访问;CSP 再断一次外连 —— 一份文档里的 `<img src="http://…">` 会在打开
 * 预览的瞬间把"谁看了这份文件"发出去。图只留 data:(Word 的内嵌图就是它)。
 */
export function sandboxSrcDoc(html: string, dark = false): string {
  const csp = "default-src 'none'; img-src data:; style-src 'unsafe-inline'";
  const fg = dark ? '#e7e7e7' : '#1a1a1a';
  const border = dark ? '#3a3a3a' : '#e0e0e0';
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  body { margin:0; padding:12px; color:${fg}; background:transparent;
         font: 13px/1.7 -apple-system, "PingFang SC", system-ui, sans-serif; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 12px; }
  th, td { border: 1px solid ${border}; padding: 4px 8px; text-align: left; vertical-align: top; }
  th { background: ${dark ? '#2a2a2a' : '#f5f5f5'}; font-weight: 600; }
  td p, th p { margin: 0; }
  h1,h2,h3,h4 { margin: 14px 0 6px; font-size: 15px; }
  img { max-width: 100%; height: auto; }
  p { margin: 6px 0; }
</style></head><body>${html}</body></html>`;
}

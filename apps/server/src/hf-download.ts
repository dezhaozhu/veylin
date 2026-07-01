import { createWriteStream, existsSync, unlinkSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export function downloadFile(
  url: string,
  dest: string,
  onProgress: (loaded: number, total: number, fileUrl: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const visit = (currentUrl: string, redirects = 0) => {
      if (redirects > 12) {
        reject(new Error(`Too many redirects while downloading ${url}`));
        return;
      }

      const parsed = new URL(currentUrl);
      const lib = parsed.protocol === 'https:' ? httpsRequest : httpRequest;
      const req = lib(
        parsed,
        {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        },
        (response) => {
          const status = response.statusCode ?? 0;
          if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
            response.resume();
            visit(new URL(response.headers.location, currentUrl).href, redirects + 1);
            return;
          }
          if (status < 200 || status >= 300) {
            response.resume();
            reject(new Error(`Download failed (${status}): ${currentUrl}`));
            return;
          }

          const total = Number.parseInt(response.headers['content-length'] ?? '0', 10) || 0;
          let loaded = 0;
          const fileStream = createWriteStream(dest);
          response.on('data', (chunk: Buffer) => {
            loaded += chunk.length;
            onProgress(loaded, total, currentUrl);
          });
          response.on('error', reject);
          response.pipe(fileStream);
          fileStream.on('finish', () => {
            fileStream.close();
            resolve();
          });
          fileStream.on('error', reject);
        },
      );
      req.on('error', (err) => {
        if (existsSync(dest)) unlinkSync(dest);
        reject(err);
      });
      req.end();
    };

    visit(url);
  });
}

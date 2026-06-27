import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const DEFAULT_HF_HOSTS = ['https://huggingface.co', 'https://hf-mirror.com'] as const;

let cachedEndpoint: string | null = null;

function parseHfHosts(): readonly string[] {
  const raw = process.env.VEYLIN_HF_HOSTS?.trim();
  if (!raw) return DEFAULT_HF_HOSTS;
  const hosts = raw
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean)
    .map((host) => (host.startsWith('http') ? host : `https://${host}`));
  return hosts.length > 0 ? hosts : DEFAULT_HF_HOSTS;
}

function probeHost(host: string, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const url = new URL(host);
    const lib = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = lib(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: '/',
        method: 'HEAD',
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        const code = res.statusCode ?? 500;
        resolve(code > 0 && code < 500);
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

/** Pick huggingface.co or hf-mirror.com based on reachability. */
export async function resolveHuggingfaceEndpoint(): Promise<string> {
  const fromEnv = process.env.HF_ENDPOINT?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');

  if (cachedEndpoint) return cachedEndpoint;

  const hosts = parseHfHosts();
  for (const host of hosts) {
    if (await probeHost(host)) {
      cachedEndpoint = host;
      console.info(`[hf] using endpoint ${host}`);
      return host;
    }
  }

  cachedEndpoint = hosts[0]!;
  console.warn(`[hf] no endpoint reachable, falling back to ${hosts[0]}`);
  return hosts[0]!;
}

export function buildHfResolveUrl(
  endpoint: string,
  modelId: string,
  file: string,
  revision = 'main',
): string {
  const base = endpoint.replace(/\/$/, '');
  const encodedModel = modelId
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  const encodedFile = file
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `${base}/${encodedModel}/resolve/${revision}/${encodedFile}`;
}

export async function applyTransformersHfEndpoint(
  transformers: typeof import('@huggingface/transformers'),
): Promise<string> {
  const endpoint = await resolveHuggingfaceEndpoint();
  transformers.env.remoteHost = `${endpoint}/`;
  return endpoint;
}

export const __test__ = {
  resetCache: () => {
    cachedEndpoint = null;
  },
  HF_HOSTS: DEFAULT_HF_HOSTS,
};

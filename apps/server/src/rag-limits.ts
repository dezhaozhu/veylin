/** Max upload size for knowledge-base documents (PDF extract + text ingest). Fastify default is 1 MiB. */
export const RAG_UPLOAD_MAX_BYTES = Number(
  process.env.RAG_UPLOAD_MAX_BYTES ?? 32 * 1024 * 1024,
);

export const RAG_UPLOAD_MAX_MB = Math.floor(RAG_UPLOAD_MAX_BYTES / (1024 * 1024));

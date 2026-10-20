// GSAM228 persistent serverless storage adapter.
// Uses Vercel Blob when configured; falls back to per-instance memory only for local/dev.
const memory = new Map();
let blobModule;

async function getBlobModule() {
  if (blobModule !== undefined) return blobModule;
  try { blobModule = await import('@vercel/blob'); }
  catch { blobModule = null; }
  return blobModule;
}

export async function persistentGet(key) {
  const blob = await getBlobModule();
  if (blob && process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const r = await blob.get(key, { token: process.env.BLOB_READ_WRITE_TOKEN });
      if (r) return JSON.parse(await r.text());
    } catch {}
  }
  return memory.get(key) ?? null;
}

export async function persistentSet(key, value) {
  memory.set(key, value);
  const blob = await getBlobModule();
  if (blob && process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      await blob.put(key, JSON.stringify(value), {
        access: 'private', addRandomSuffix: false, allowOverwrite: true,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      return true;
    } catch {}
  }
  return false;
}

export function isPersistentStorageConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

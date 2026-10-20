// GSAM228 persistent serverless storage adapter.
// Vercel Blob is the source of truth in production; in-memory storage is local-development only.
const memory = new Map();
let blobModule;

async function getBlobModule() {
  if (blobModule !== undefined) return blobModule;
  try {
    blobModule = await import('@vercel/blob');
  } catch {
    blobModule = null;
  }
  return blobModule;
}

function isProduction() {
  return Boolean(process.env.VERCEL) || process.env.NODE_ENV === 'production';
}

function requireToken() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token && isProduction()) {
    throw new Error('BLOB_READ_WRITE_TOKEN is required for persistent production storage.');
  }
  return token || '';
}

export async function persistentGet(key) {
  const token = requireToken();
  if (!token) return memory.get(key) ?? null;

  const blob = await getBlobModule();
  if (!blob?.get) throw new Error('The @vercel/blob SDK is unavailable.');

  try {
    const result = await blob.get(key, { access: 'private', token });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    const text = await new Response(result.stream).text();
    return JSON.parse(text);
  } catch (error) {
    throw new Error('Persistent storage read failed: ' + String(error?.message || error).slice(0, 240));
  }
}

export async function persistentSet(key, value) {
  const token = requireToken();
  if (!token) {
    memory.set(key, value);
    return true;
  }

  const blob = await getBlobModule();
  if (!blob?.put) throw new Error('The @vercel/blob SDK is unavailable.');

  try {
    await blob.put(key, JSON.stringify(value), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      token,
    });
    memory.set(key, value);
    return true;
  } catch (error) {
    throw new Error('Persistent storage write failed: ' + String(error?.message || error).slice(0, 240));
  }
}

export function isPersistentStorageConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

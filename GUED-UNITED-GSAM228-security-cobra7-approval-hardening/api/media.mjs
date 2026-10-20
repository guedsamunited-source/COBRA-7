// GSAM228 v6 — média stateless-first.
// Image: URL immédiate. Vidéo: utilise VIDEO_API_URL si configuré, sinon retourne honnêtement
// un poster cinématique. Aucun job en mémoire ne prétend survivre à une instance Vercel.
import { rateLimit, genImageUrl, fetchJSON, requireSession } from './_lib.mjs';

function bodyOf(req) {
  try { return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); }
  catch { return {}; }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST uniquement. Utilise /api/media.' });
  const auth = requireSession(req, res);
  if (!auth) return;
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'anon';
  if (!rateLimit(ip, 12, 60000)) return res.status(429).json({ error: 'Limite média atteinte (12/min).' });

  const body = bodyOf(req);
  const kind = body.kind === 'video' ? 'video' : 'image';
  const prompt = String(body.prompt || '').trim().slice(0, 900);
  if (!prompt) return res.status(400).json({ error: 'prompt requis' });

  const width = Math.min(Math.max(Number(body.width) || 1024, 256), 1920);
  const height = Math.min(Math.max(Number(body.height) || 1024, 256), 1920);

  if (kind === 'image') {
    return res.status(200).json({ ok: true, kind, url: genImageUrl(prompt, width, height), provider: 'pollinations' });
  }

  // Intégration vidéo réelle facultative : le fournisseur doit renvoyer {url}.
  if (process.env.VIDEO_API_URL) {
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.VIDEO_API_KEY) headers.Authorization = `Bearer ${process.env.VIDEO_API_KEY}`;
    const r = await fetchJSON(process.env.VIDEO_API_URL, {
      method: 'POST', headers,
      body: JSON.stringify({ prompt, width, height, duration: Math.min(Number(body.duration) || 8, 30) }),
    }, 50000);
    const url = r.data?.url || r.data?.video_url || r.data?.output?.url;
    if (r.ok && typeof url === 'string' && /^https:\/\//i.test(url)) {
      return res.status(200).json({ ok: true, kind, url, provider: 'configured-video-provider' });
    }
  }

  return res.status(200).json({
    ok: true,
    kind: 'video',
    degraded: true,
    status: 'fallback',
    poster: genImageUrl(`${prompt}, cinematic movie still, photorealistic, high detail`, 1280, 720),
    message: 'Aucun fournisseur vidéo persistant n’est configuré. GSAM228 a généré un poster cinématique au lieu de simuler une vidéo en arrière-plan.',
    nextStep: 'Configure VIDEO_API_URL et VIDEO_API_KEY dans Vercel pour activer un générateur vidéo réel.',
  });
}

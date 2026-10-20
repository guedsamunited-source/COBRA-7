// GSAM228 v4.1 — endpoint Knowledge Core (super base de cerveaux)
import { ensureQuery, rateLimit, requireSession } from './_lib.mjs';
import { ingestNews, knowledgeAnswer, learningStats, kvGet } from './_knowledge.mjs';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const auth = requireSession(req, res);
  if (!auth) return;
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'anon';
  if (!rateLimit(ip, 60, 60000)) return res.status(429).json({ error: 'Trop de requêtes.' });

  if (req.method === 'GET') {
    const q = ensureQuery(req);
    if (q.stats) return res.status(200).json({ ok: true, ...(await learningStats()) });
    if (q.query) return res.status(200).json({ ok: true, ...(await knowledgeAnswer(String(q.query))) });
    // ?kb=1 ou par défaut : déclenche une veille autonome et renvoie l'état du cerveau documentaire
    const kb = await ingestNews();
    return res.status(200).json({ ok: true, knowledge_base: kb, stats: await learningStats(), time: new Date().toISOString() });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch {}
  if (body.ingest) { await ingestNews(); return res.status(200).json({ ok: true, stats: await learningStats() }); }
  return res.status(400).json({ error: 'GET ?stats | ?query= | POST {ingest:true}' });
}

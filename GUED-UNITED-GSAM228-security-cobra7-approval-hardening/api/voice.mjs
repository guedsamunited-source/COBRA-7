// GSAM228 v4.2 — Agent vocal temps réel façon Ava (call-ava.com) : pipeline STT → askAgent → TTS
// avec interruption vocale (« stop/arrête/tais »), réponse partielle instantanée et session continue.
import { askAgentAlways as askAgent, ensureQuery, rateLimit, loadMemory, saveMemory, hasValidKey, BRAINS, requireSession } from './_lib.mjs';

const SYSTEM = `Tu es GSAM228 en MODE VOCAL temps réel (comme une assistante qui parle). Règles absolues :
- Réponses COURTES et NATURELLES à l'oral : 1 à 3 phrases max, pas de listes markdown, pas de liens URL lus à voix haute, pas de code.
- Tu écoutes, tu réponds, tu poses une question de relance quand c'est utile.
- Si l'utilisateur dit "stop", "arrête", "tais-toi" : le système coupe la voix automatiquement.
- Langue : celle de l'utilisateur.`;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    const q = ensureQuery(req);
    if (q.status) {
      const brains = [];
      for (const b of BRAINS) brains.push({ id: b.id, label: b.label, ready: await hasValidKey(b.id) || !b.needsKey });
      return res.status(200).json({ ok: true, service: 'voice agent v4.2', brains });
    }
    return res.status(200).json({ ok: true, endpoints: ['POST /api/voice {transcript,session}'] });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const auth = requireSession(req, res);
  if (!auth) return;

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'anon';
  if (!rateLimit(ip, 60, 60000)) return res.status(429).json({ error: 'Trop de requêtes vocales (60/min).' });

  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch {}
  const transcript = String(body.transcript || '').slice(0, 2000).trim();
  const sessionId = String(body.session || 'voice-default').slice(0, 64);
  if (!transcript) return res.status(400).json({ error: 'transcript requis' });

  // Commandes vocales locales (instantanées, sans LLM)
  if (/^(bonjour|salut|hello|couleur?|hey)\b/i.test(transcript) && transcript.length < 25) {
    return res.status(200).json({ ok: true, reply: 'GSAM228', provider: 'local-greeting', ms: 0 });
  }

  try {
    const history = await loadMemory(sessionId);
    const messages = [{ role: 'system', content: SYSTEM }, ...history.slice(-12), { role: 'user', content: transcript }];
    const t0 = Date.now();
    const r = await askAgent(messages);
    // Nettoyage voix : suppression markdown/URLs pour un rendu oral propre
    let reply = r.text
      .replace(/```[\s\S]*?```/g, ' code affiché à l\'écran ')
      .replace(/https?:\/\/\S+/g, 'un lien')
      .replace(/[*_#`>|-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim().slice(0, 1200);
    if (!reply || reply.length < 2) reply = 'Je réfléchis encore — repose ta question dans quelques secondes.';
    await saveMemory(sessionId, [...history, { role: 'user', content: transcript }, { role: 'assistant', content: reply }].slice(-40));
    return res.status(200).json({ ok: true, reply, provider: r.provider, label: r.label, ms: Date.now() - t0, session: sessionId });
  } catch (e) {
    return res.status(200).json({
      ok: true, degraded: true, provider: 'fallback-local',
      reply: 'Les cerveaux IA sont momentanément indisponibles, mais je reste à l\'écoute. Tu peux me demander la météo, les actualités ou une recherche — j\'y réponds directement.',
    });
  }
}

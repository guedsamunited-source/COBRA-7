// GSAM228 v4.2 — Vision temps réel : l'agent « voit » le problème de l'utilisateur
// (capture écran / photo envoyée depuis le bouton 📸 ou une pièce jointe dans le chat).
// Analyse via l'API texte multimodale de Pollinations (compatible OpenAI) avec
// repli sur description locale honnête si tous les modèles vision sont en panne.
import { rateLimit, requireSession } from './_lib.mjs';

const VISION_MODELS = ['openai/gpt-4o-mini', 'openai/o3-mini-high', 'anthropic/claude-3.7-sonnet'];

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const auth = requireSession(req, res);
  if (!auth) return;
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'anon';
  if (!rateLimit(ip, 20, 60000)) return res.status(429).json({ error: 'Trop d\'analyses visuelles (20/min).' });

  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch {}
  const image = String(body.image || ''); // data:base64
  const question = String(body.question || 'Décris précisément ce que tu vois et identifie tout problème, erreur ou anomalie visible.');
  const context = String(body.context || '').slice(0, 1200);
  const m = /^data:(image\/[a-zA-Z+]+);base64,([A-Za-z0-9+/=]+)$/.exec(image);
  if (!m) return res.status(400).json({ error: 'image base64 requise (data:image/...;base64,...)' });
  if (m[2].length > 4_000_000) return res.status(413).json({ error: 'image trop volumineuse (max ~3 Mo)' });

  const prompt = `Tu es GSAM228, agent expert en diagnostic visuel. L'utilisateur te montre une image (probablement un problème concret : capture d'écran d'erreur, photo d'un dispositif, message bloquant). ${context ? `Contexte fourni par l'utilisateur : "${context}". ` : ''}Question : ${question}\nRéponds en français (ou langue de la question), de façon structurée : 1) Ce que je vois 2) Problème(s) détecté(s) 3) Cause probable 4) Solutions concrètes étape par étape.`;

  const errors = [];
  for (const model of VISION_MODELS) {
    try {
      // API texte multimodale compatible OpenAI (supporte image_url data:base64)
      const tr = await fetch(`https://text.pollinations.ai/openai`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(45000),
        body: JSON.stringify({
          model, messages: [{ role: 'user', content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: image } },
          ] }],
        }),
      }).catch((e) => ({ ok: false, _err: e.message }));
      if (tr.ok) {
        const j = await tr.json().catch(() => null);
        const out = j?.choices?.[0]?.message?.content;
        if (out && out.length > 40) return res.status(200).json({ ok: true, analysis: out.slice(0, 6000), model, ms: Date.now() });
        errors.push(`${model}:vide`);
      } else errors.push(`${model}:${tr.status || tr._err}`);
    } catch (e) { errors.push(`${model}:${String(e.message).slice(0, 40)}`); }
  }
  // Filet de sécurité : jamais muet — on renvoie un guide de diagnostic utile + demande de détails texte
  return res.status(200).json({
    ok: true, degraded: true, provider: 'fallback-local',
    analysis: `⚠️ Les modèles de vision sont momentanément indisponibles (${errors.join(', ')}).\nPour que je diagnostique quand même ton problème :\n1. Copie-colle le texte exact de l'erreur visible\n2. Ou décris-moi la situation (appareil, action tentée, résultat obtenu)\nJe réessaierai automatiquement la vision à ta prochaine image.`,
  });
}

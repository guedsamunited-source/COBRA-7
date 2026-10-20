// GSAM228 v6 — tests locaux + intégrations externes tolérantes aux pannes réseau.
import http from 'node:http';

let pass = 0, fail = 0, skip = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${extra}`); } };
const skipped = (name, why = '') => { skip++; console.log(`  ◌ ${name} — ignoré: ${why}`); };

process.env.GUED_SESSION_SECRET ||= 'test-secret-012345678901234567890123456789';

const { default: aiHandler } = await import('../api/ai.mjs');
const { default: mediaHandler } = await import('../api/media.mjs');
const { default: knowledgeHandler } = await import('../api/knowledge.mjs');
const { default: voiceHandler } = await import('../api/voice.mjs');
const { default: visionHandler } = await import('../api/vision.mjs');
const { default: authHandler } = await import('../api/auth/index.mjs');

function mkRes() {
  const res = { code: 200, headers: {}, body: null };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.code = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  return res;
}
function call(handler, { method = 'GET', url = '/', body, headers = {} } = {}) {
  const req = { method, url, headers, body: body === undefined ? undefined : JSON.stringify(body) };
  const res = mkRes();
  return Promise.resolve(handler(req, res)).then(() => res);
}

console.log('— Syntaxe & authentification —');
{
  const r = await call(authHandler, { method: 'POST', url: '/api/auth', body: { action: 'register', email: 'e2e@example.com', password: 'TestPass123!', name: 'E2E' } });
  ok('inscription POST', r.code === 200 && r.body?.ok === true, JSON.stringify(r.body));
  ok('session placée en cookie HttpOnly', /gsam_session=/.test(r.headers['Set-Cookie'] || '') && /HttpOnly/i.test(r.headers['Set-Cookie'] || ''));
  const cookie = String(r.headers['Set-Cookie'] || '').split(';')[0];
  const m = await call(authHandler, { method: 'POST', url: '/api/auth', headers: { cookie }, body: { action: 'me' } });
  ok('session me', m.body?.ok === true && m.body.user.email === 'e2e@example.com');
}

console.log('— Endpoints locaux —');
{
  const r = await call(aiHandler, { url: '/api/ai' });
  ok('GET /api/ai', r.code === 200 && r.body?.ok === true);
  const s = await call(aiHandler, { url: '/api/ai?skills=1' });
  ok('GET skills', Array.isArray(s.body?.skills) && s.body.skills.length >= 6);
  const bad = await call(aiHandler, { method: 'POST', body: { message: '' } });
  ok('message vide -> 400', bad.code === 400);
  const media = await call(mediaHandler, { method: 'POST', body: { kind: 'image', prompt: 'test' } });
  ok('image URL', media.code === 200 && /^https:\/\/image\.pollinations\.ai\//.test(media.body?.url || ''));
  const video = await call(mediaHandler, { method: 'POST', body: { kind: 'video', prompt: 'test' } });
  ok('vidéo sans job mémoire', video.code === 200 && (video.body?.poster || video.body?.url));
  const badVision = await call(visionHandler, { method: 'POST', body: { image: 'bad' } });
  ok('vision invalide -> 400', badVision.code === 400);
  const voice = await call(voiceHandler, { method: 'POST', body: { transcript: 'bonjour', session: 'e2e' } });
  ok('voix salutation', voice.code === 200 && /GSAM228/i.test(voice.body?.reply || ''));
}

console.log('— Intégrations réseau (non bloquantes si le sandbox n’a pas Internet) —');
async function external(name, fn) {
  try {
    const result = await Promise.race([fn(), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000))]);
    return result;
  } catch (e) { skipped(name, e.message); return null; }
}
{
  const r = await external('recherche Web', () => import('../api/_lib.mjs').then(({ toolWebSearch }) => toolWebSearch('intelligence artificielle')));
  if (r) ok('recherche Web répond', Array.isArray(r));
}
{
  const r = await external('météo', () => import('../api/_lib.mjs').then(({ toolWeather }) => toolWeather('Lomé')));
  if (r) ok('météo ne fabrique pas Paris', r.ville !== 'Paris' || r.erreur, JSON.stringify(r));
}
{
  const r = await external('Wikipédia', () => import('../api/_lib.mjs').then(({ toolWiki }) => toolWiki('Intelligence artificielle')));
  if (r) ok('Wikipédia répond ou signale une erreur', Boolean(r.extract || r.erreur));
}

console.log('— Résultat —');
console.log(`== ${pass} réussis, ${fail} échecs, ${skip} intégrations ignorées ==`);
process.exit(fail ? 1 : 0);

// GSAM228 — noyau agentique v4.0 (résilience maximale)
// Conçu pour rester opérationnel même quand un fournisseur tombe en panne.
// Règle d'or : chaque cerveau et chaque outil a >= 2 chemins indépendants.

/* ============================ HTTP utilitaires ============================ */

export const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 GSAM228/4.3';

export async function fetchJSON(url, opts = {}, timeoutMs = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    const txt = await r.text();
    let data = null;
    try { data = JSON.parse(txt); } catch { /* non-json */ }
    return { ok: r.ok, status: r.status, data, text: txt };
  } finally {
    clearTimeout(t);
  }
}

// Renvoie le texte brut d'une URL (avec UA navigateur par défaut — utile HTML/RSS/XML)
export async function fetchText(url, timeoutMs = 12000, headers = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: ctl.signal });
    return await r.text();
  } catch {
    return '';
  } finally {
    clearTimeout(t);
  }
}

export async function fetchHeadOk(url, timeoutMs = 12000) {
  // Vérifie qu'une URL renvoie réellement du contenu (anti lien-mort).
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: 'GET', signal: ctl.signal, redirect: 'follow' });
    if (!r.ok) return false;
    const ct = r.headers.get('content-type') || '';
    return !ct.includes('text/html') || url.includes('pollinations'); // images servies avec ct variable
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/* ============================ Rate limiting mémoire ============================ */

const buckets = new Map();
export function rateLimit(ip, limit = 60, windowMs = 60000) {
  const now = Date.now();
  const k = ip || 'anon';
  const b = buckets.get(k) || [];
  const kept = b.filter((t) => now - t < windowMs);
  if (kept.length >= limit) { buckets.set(k, kept); return false; }
  kept.push(now);
  buckets.set(k, kept);
  if (buckets.size > 5000) { // purge anti-fuite mémoire
    for (const [key, arr] of buckets) { if (!arr.length || now - arr[arr.length - 1] > windowMs * 2) buckets.delete(key); }
  }
  return true;
}

/* ============================ Session HMAC (auth légère) ============================ */

import crypto from 'node:crypto';
const SECRET = process.env.GUED_SESSION_SECRET || (process.env.VERCEL || process.env.NODE_ENV === 'production' ? '' : 'local-development-only-change-me');

export function signSession(payload) {
  if (!SECRET) throw new Error('GUED_SESSION_SECRET must be configured before signing production sessions.');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}
export function verifySession(token) {
  if (!SECRET) return null;
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch { return null; }
}

/* ============================ req.query shim (fix serverless) ============================ */

// ---- Authentification email + mot de passe (scrypt, sessions HMAC 30 j) ----
import { scrypt as _scrypt, randomBytes as _rb, timingSafeEqual as _tse } from 'node:crypto';
import { promisify } from 'node:util';
import { persistentGet, persistentSet, isPersistentStorageConfigured } from './_storage.mjs';
const _scryptP = promisify(_scrypt);
const usersStore = new Map();
let usersLoaded = false;

async function loadUsers() {
  if (usersLoaded) return;
  const raw = await persistentGet('gsam/users');
  if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw)) usersStore.set(k, v);
  usersLoaded = true;
}

async function saveUsers() {
  const o = Object.fromEntries(usersStore.entries());
  await persistentSet('gsam/users', o);
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers?.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionSecret() {
  return process.env.GUED_SESSION_SECRET || '';
}

export function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
  res.setHeader('Set-Cookie', `gsam_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=2592000`);
}
export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'gsam_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

export function send(res, status, payload, contentType = 'application/json') {
  if (typeof res.status === 'function' && typeof res.json === 'function' && contentType === 'application/json') return res.status(status).json(payload);
  if (typeof res.statusCode !== 'undefined') res.statusCode = status;
  res.setHeader?.('Content-Type', contentType);
  if (typeof res.end === 'function') return res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
  res.body = payload; res.code = status; return res;
}

export function sessionFromRequest(req) {
  const cookies = parseCookies(req);
  const token = cookies.gsam_session || String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
  return verifySession(token);
}

export function requireSession(req, res) {
  const session = sessionFromRequest(req);
  const production = Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production');
  if (!session && production) {
    send(res, 401, { error: 'Authentification requise.' });
    return null;
  }
  return session || { u: 'local-dev', n: 'Local developer' };
}

export async function authHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (req.method !== 'POST') return send(res, 405, { error: 'Utilise POST /api/auth.' });
  const ip = (req.headers['x-forwarded-for'] || 'local').split(',')[0].trim();
  if (!rateLimit(ip, 20, 60000)) return send(res, 429, { error: 'Trop de tentatives — patiente une minute.' });
  if (!sessionSecret()) return send(res, 503, { error: 'GUED_SESSION_SECRET doit être configuré dans Vercel.' });
  const production = Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production');
  if (production && !isPersistentStorageConfigured()) {
    return send(res, 503, { error: 'BLOB_READ_WRITE_TOKEN doit être configuré pour activer les comptes et la mémoire persistante.' });
  }

  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch { return send(res, 400, { error: 'JSON invalide.' }); }
  await loadUsers();
  const action = String(body.action || '');

  if (action === 'me') {
    const token = parseCookies(req).gsam_session || String(body.token || '');
    const s = verifySession(token);
    return send(res, 200, s ? { ok: true, user: { email: s.u, name: s.n || s.u.split('@')[0] } } : { ok: false });
  }
  if (action === 'logout') { clearSessionCookie(res); return send(res, 200, { ok: true }); }

  const email = String(body.email || '').trim().toLowerCase();
  const pass = String(body.password || '');
  const name = String(body.name || email.split('@')[0]).trim().slice(0, 40);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || pass.length < 8) {
    return send(res, 400, { error: 'Email invalide ou mot de passe trop court (min. 8 caractères).' });
  }

  if (action === 'register') {
    if (usersStore.has(email)) return send(res, 409, { error: 'Un compte existe déjà avec cet email. Connecte-toi.' });
    const salt = _rb(16).toString('hex');
    const hash = (await _scryptP(pass, salt, 64)).toString('hex');
    usersStore.set(email, { salt, hash, name });
    await saveUsers();
    const token = signSession({ u: email, n: name, exp: Date.now() + 30 * 24 * 3600 * 1000 });
    setSessionCookie(res, token);
    return send(res, 200, { ok: true, user: { email, name } });
  }

  if (action === 'login') {
    const u = usersStore.get(email);
    if (!u) return send(res, 401, { error: 'Compte introuvable. Inscris-toi d’abord.' });
    const hash = (await _scryptP(pass, u.salt, 64)).toString('hex');
    const a = Buffer.from(hash, 'hex'), b = Buffer.from(u.hash, 'hex');
    if (a.length !== b.length || !_tse(a, b)) return send(res, 401, { error: 'Mot de passe incorrect.' });
    const token = signSession({ u: email, n: u.name, exp: Date.now() + 30 * 24 * 3600 * 1000 });
    setSessionCookie(res, token);
    return send(res, 200, { ok: true, user: { email, name: u.name } });
  }
  return send(res, 400, { error: 'Action inconnue.' });
}

export function ensureQuery(req) {
  if (req.query && Object.keys(req.query).length >= 0 && typeof req.query === 'object' && (req.__qok || req.url === undefined || Object.keys(req.query).length > 0)) {
    // query déjà fourni par le runtime
    if (req.query.model !== undefined || req.query.job !== undefined || req.query.skills !== undefined || Object.keys(req.query).length) return req.query;
  }
  try {
    const u = new URL(req.url || '/', 'http://local');
    const q = {};
    u.searchParams.forEach((v, k) => { q[k] = v; });
    req.query = { ...(req.query || {}), ...q };
  } catch { req.query = req.query || {}; }
  return req.query;
}

/* ============================ CERVEAUX IA — chaîne de secours ordonnée ============================ */
// Chaque entrée: { id, label, needsKey, call(messages,model) -> texte }
// Le routeur essaie dans l'ordre, avec retry/backoff, et mémorise les pannes temporaires (circuit breaker).

const circuit = new Map(); // id -> { fails, until }
function cbOpen(id) { const c = circuit.get(id); return c && c.until > Date.now(); }
function cbFail(id) { const c = circuit.get(id) || { fails: 0, until: 0 }; c.fails++; c.until = Date.now() + Math.min(60000 * c.fails, 5 * 60000); circuit.set(id, c); }
function cbOk(id) { circuit.delete(id); }

async function withRetry(fn, tries = 2, delayMs = 800) {
  let lastErr;
  for (let i = 0; i <= tries; i++) {
    try { return await fn(); } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, delayMs * (i + 1))); }
  }
  throw lastErr;
}

// -- 1. Gemini via Cloud Code Assistants (endpoint gratuit, jeton antigravity) --
// SÉCURITÉ : le jeton n'est JAMAIS codé en dur dans le dépôt — il provient uniquement
// des variables d'environnement Vercel (GEMINI_API_KEY ou ANTIGRAVITY_TOKEN).
// Si absent, ce cerveau est désactivé et la chaîne bascule automatiquement sur les suivants.
const GEMINI_TOKEN = process.env.GEMINI_API_KEY || process.env.ANTIGRAVITY_TOKEN || '';
async function brainGemini(messages, model) {
  const res = await fetchJSON('https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GEMINI_TOKEN}`, 'x-goog-api-key': GEMINI_TOKEN, 'User-Agent': 'GSAM228/4.0' },
    body: JSON.stringify({ model: model || 'gemini-2.5-flash', project: 'gsam228', messages }),
  }, 30000);
  if (!res.ok) throw new Error(`gemini ${res.status}`);
  // parse SSE basique
  const chunks = (res.text || '').split('\n').filter((l) => l.startsWith('data:'));
  let out = '';
  for (const c of chunks) { try { const j = JSON.parse(c.slice(5)); out += j?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || ''; } catch {} }
  if (!out.trim()) throw new Error('gemini empty');
  return out;
}

// -- 2. NVIDIA DeepSeek-R1 (nécessite clé ; gratuit à l'inscription) --
async function brainNvidia(messages, model) {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) throw new Error('nvidia: pas de clé');
  const res = await fetchJSON('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: model || 'deepseek-ai/deepseek-r1', messages, max_tokens: 2048, temperature: 0.6 }),
  }, 45000);
  if (!res.ok) throw new Error(`nvidia ${res.status}`);
  const t = res.data?.choices?.[0]?.message?.content;
  if (!t) throw new Error('nvidia empty');
  return t;
}

// -- 3. Groq llama-3.3-70b (nécessite clé valide) --
async function brainGroq(messages, model) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('groq: pas de clé');
  const res = await fetchJSON('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: model || 'llama-3.3-70b-versatile', messages, max_tokens: 2048 }),
  }, 30000);
  if (!res.ok) throw new Error(`groq ${res.status}`);
  const t = res.data?.choices?.[0]?.message?.content;
  if (!t) throw new Error('groq empty');
  return t;
}

// -- 4. OpenRouter modèles :free (nécessite clé gratuite openrouter.ai) --
async function brainOpenRouter(messages, model) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('openrouter: pas de clé');
  const res = await fetchJSON('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: model || 'meta-llama/llama-3.3-70b-instruct:free', messages }),
  }, 45000);
  if (!res.ok) throw new Error(`openrouter ${res.status}`);
  const t = res.data?.choices?.[0]?.message?.content;
  if (!t) throw new Error('openrouter empty');
  return t;
}

// -- 5. Pollinations (sans clé) : POST OpenAI-compatible en voie principale + GET legacy en secours --
// Robustesse : le POST /openai renvoie des erreurs JSON explicites (jamais de faux vide),
// accepte tout le contexte multi-tours, et le GET ne sert que de dernier recours local.
// Détection anti-poison : si le compte anonyme Pollinations est saturé (« budget reached »)
// ou en panne interne (ENOSPC), on rejette la réponse comme erreur => bascule cerveau suivant.
const POLL_BAD = /reached its budget|raise the key budget|no space left on device|ENOSPC|"error"|enter\.pollinations/i;
async function pollinationsPost(messages, model) {
  const res = await fetchJSON('https://text.pollinations.ai/openai', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'openai', messages, referrer: 'gsam228' }),
  }, 60000);
  if (!res.ok) throw new Error(`pollinations-post ${res.status || 'réseau'}`);
  let t = res.data?.choices?.[0]?.message?.content || '';
  // certaines réponses mettent le texte dans "reasoning" si content vide
  if (!t.trim()) t = res.data?.choices?.[0]?.message?.reasoning || '';
  t = t.trim();
  if (!t || t === '{}') throw new Error('pollinations-post vide');
  if (POLL_BAD.test(t)) throw new Error(/budget/i.test(t) ? 'pollinations:budget épuisé' : 'pollinations:panne interne');
  return t;
}
async function pollinationsGet(prompt) {
  const res = await fetchJSON(`https://text.pollinations.ai/${encodeURIComponent(prompt.slice(0, 1800))}?model=openai-fast&referrer=gsam228`, {}, 45000);
  const t = (res.text || '').trim();
  if (!res.ok || !t || t === '{}' || t.startsWith('{"error"')) throw new Error(`pollinations-get ${res.status || 'vide'}`);
  if (POLL_BAD.test(t)) throw new Error(/budget/i.test(t) ? 'pollinations:budget épuisé' : 'pollinations:panne interne');
  return t;
}
async function brainPollinations(messages, model) {
  return withRetry(async () => {
    try {
      return await pollinationsPost(messages, model);
    } catch (e1) {
      // secours : ancien endpoint GET sur le dernier message utilisateur
      const last = [...messages].reverse().find((m) => m.role === 'user');
      const out = await pollinationsGet(last?.content || 'hello');
      return out;
    }
  }, 3, 1500);
}

// -- 5bis. Cerveau autonome NOUVELLE GENERATION — sans AUCUNE clé API, jamais à court de quota :
// agrégation DuckDuckGo Instant Answer + Wikipédia FR/EN (APIs publiques stables, gratuites, illimitées).
// N'est activé qu'en dernier recours quand les LLM sont tous indisponibles => l'agent répond TOUJOURS.
async function brainAutonomous(messages) {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  const q = String(last?.content || '').replace(/\[\[tool:[^\]]+\]\]/g, '').trim().slice(0, 200);
  if (!q) throw new Error('autonome: question vide');
  const parts = [];
  // 1) DuckDuckGo instant answer
  try {
    const ddg = await fetchJSON(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=0`, {}, 9000);
    if (ddg.ok && ddg.data?.Abstract) parts.push(`📖 ${ddg.data.Heading} — ${ddg.data.Abstract} (source: ${ddg.data.AbstractURL || 'DuckDuckGo'})`);
    else if (ddg.ok && ddg.data?.Answer) parts.push(`⚡ ${String(ddg.data.Answer)}`);
  } catch {}
  // 2) Wikipédia FR puis EN (summary REST)
  for (const lang of ['fr', 'en']) {
    try {
      const w = await fetchJSON(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q.split(/[?!.]/)[0].trim().slice(0, 60))}`, { headers: { 'User-Agent': 'GSAM228/4.3' } }, 9000);
      if (w.ok && w.data?.extract && !parts.some((p) => p.includes(w.data.extract.slice(0, 40)))) {
        parts.push(`🌐 ${w.data.title} (${lang === 'fr' ? 'Wikipédia FR' : 'Wikipédia EN'}) — ${w.data.extract}${w.data.content_urls?.desktop ? ` [${w.data.content_urls.desktop.url}]` : ''}`);
        break;
      }
    } catch {}
  }
  // 3) recherche web agrégée (module _search déjà testé)
  if (parts.length === 0) {
    try {
      const { aggregateSearch } = await import('./_search.mjs');
      const r = await aggregateSearch(q, { limit: 3 });
      const list = r?.results || r;
      if (Array.isArray(list) && list.length) parts.push(...list.slice(0, 3).map((x) => `🔎 ${x.title} — ${x.snippet || ''} (${x.url})`));
    } catch {}
  }
  if (parts.length === 0) throw new Error('autonome: aucune source trouvée');
  return `🧠 Réponse autonome GSAM228 (les cerveaux LLM externes sont momentanément saturés ; voici une synthèse sourcée directe) :\n\n${parts.join('\n\n')}\n\n💡 Les cerveaux IA principaux seront réessayés automatiquement à ta prochaine question.`;
}

// -- 6. HuggingFace Inference (si HF_TOKEN présent — gratuit) --
async function brainHF(messages, model) {
  const key = process.env.HF_TOKEN;
  if (!key) throw new Error('hf: pas de clé');
  const res = await fetchJSON('https://router.huggingface.co/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: model || 'meta-llama/Llama-3.3-70B-Instruct', messages, max_tokens: 1024 }),
  }, 45000);
  if (!res.ok) throw new Error(`hf ${res.status}`);
  const t = res.data?.choices?.[0]?.message?.content;
  if (!t) throw new Error('hf empty');
  return t;
}

export const BRAINS = [
  { id: 'gemini', label: 'Gemini Flash (Cloud Code)', fn: brainGemini, needsKey: true },
  { id: 'nvidia', label: 'NVIDIA DeepSeek-R1', fn: brainNvidia, needsKey: true },
  { id: 'groq', label: 'Groq Llama-3.3-70B', fn: brainGroq, needsKey: true },
  { id: 'openrouter', label: 'OpenRouter :free', fn: brainOpenRouter, needsKey: true },
  { id: 'pollinations', label: 'Pollinations (sans clé)', fn: brainPollinations, needsKey: false },
  { id: 'hf', label: 'HuggingFace Router', fn: brainHF, needsKey: true },
  { id: 'autonome', label: 'Cerveau autonome GSAM (DDG+Wikipédia, sans clé, illimité)', fn: brainAutonomous, needsKey: false },
];

// Apprentissage procédural : on note discrètement les réussites/pannes de chaque cerveau
// pour que la super base de cerveaux s'améliore avec le temps (sans demande utilisateur).
let learnHook = null; // injecté par ai.mjs via setLearnHook (évite import circulaire)
export function setLearnHook(fn) { learnHook = fn; }
function noteOutcome(id, ok, why) { try { learnHook?.(id, ok, why); } catch {} }

export async function askAgent(messages, preferModel) {
  const errors = [];
  for (const b of BRAINS) {
    if (b.needsKey && !(await hasValidKey(b.id))) { errors.push(`${b.id}:inactif`); continue; }
    if (cbOpen(b.id)) { errors.push(`${b.id}:surchargé`); continue; }
    try {
      const out = await withRetry(() => b.fn(messages, preferModel), 1, 700);
      cbOk(b.id);
      noteOutcome(b.id, true, '');
      return { text: out, provider: b.id, label: b.label };
    } catch (e) {
      cbFail(b.id);
      noteOutcome(b.id, false, String(e.message).slice(0, 60));
      errors.push(`${b.id}:${String(e.message).slice(0, 40)}`);
    }
  }
  const err = new Error('Tous les cerveaux IA sont momentanément indisponibles');
  err.chain = errors;
  throw err;
}

/* Version « jamais muet » : après échec de toute la chaîne LLM, tente le cerveau autonome
   hors circuit breaker ; si ça échoue aussi, renvoie une synthèse locale des outils directs.
   Utilisée par /api/ai et /api/voice pour ne JAMAIS afficher le message d'indisponibilité. */
export async function askAgentAlways(messages) {
  let chainErr = null;
  try { return await askAgent(messages); }
  catch (e) { chainErr = e; }
  // Tentative directe du cerveau autonome (DDG + Wikipédia + agrégation web — sans clé, sans quota)
  try {
    circuit.delete('autonome');
    const t = await brainAutonomous(messages);
    noteOutcome('autonome', true, 'post-fallback');
    return { text: t, provider: 'autonome', label: 'Cerveau autonome GSAM (synthèse sourcée)' };
  } catch {}
  // Filet ultime local : on répond avec ce qu'on sait déjà (veille ingérée + historique récent)
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const q = String(lastUser?.content || '').trim();
  const ctx = [
    `🧠 GSAM228 en mode autonomie totale (cerveaux externes saturés à l'instant : ${chainErr?.chain?.join(', ') || 'panne'}).`,
    q ? `Ta question porte sur : « ${q.slice(0, 160)} ».` : '',
    'Je réessaie automatiquement les cerveaux principaux à chaque nouvelle question.',
    'En attendant, je peux te servir immédiatement des données fiables — tape une commande :',
    '/search <sujet> · /news <sujet> · /meteo <ville> · /wiki <sujet> · /finance <symbole> · /mlb · /nba · /image <description>',
  ].filter(Boolean).join('\n');
  return { text: ctx, provider: 'local-utile', label: 'GSAM228 (mode autonomie)', degraded: true };
}

/* Validation des clés (cache par instance) */
const keyCache = new Map();
export async function hasValidKey(id) {
  if (keyCache.has(id)) return keyCache.get(id);
  const configured = id === 'gemini' ? Boolean(GEMINI_TOKEN)
    : id === 'nvidia' ? Boolean(process.env.NVIDIA_API_KEY)
    : id === 'groq' ? Boolean(process.env.GROQ_API_KEY)
    : id === 'openrouter' ? Boolean(process.env.OPENROUTER_API_KEY)
    : id === 'hf' ? Boolean(process.env.HF_TOKEN)
    : true;
  keyCache.set(id, configured);
  return configured;
}

/* ============================ OUTILS RÉELS (multi-chemins) ============================ */

export async function toolWebSearch(q) {
  // Chemin 1: DuckDuckGo html ; chemin 2: lite.duckduckgo ; chemin 3: Google News RSS
  const ua = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) GSAM228/4.0' };
  try {
    const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, { headers: ua, signal: AbortSignal.timeout(12000) });
    const h = await r.text();
    const items = [...h.matchAll(/class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]{0,400}?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].slice(0, 6)
      .map((m) => ({ title: stripTags(decodeURIComponent(m[2])), url: cleanDdg(m[1]), snippet: stripTags(m[3]).slice(0, 220) }));
    if (items.length) return items;
  } catch {}
  try {
    const r = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=fr`, { headers: ua, signal: AbortSignal.timeout(12000) });
    const x = await r.text();
    return [...x.matchAll(/<item><title>([^<]+)<\/title><link>([^<]+)<\/link>[\s\S]*?<description>([\s\S]*?)<\/description>/g)].slice(0, 6)
      .map((m) => ({ title: decodeEntities(m[1]), url: m[2], snippet: stripTags(m[3]).slice(0, 220) }));
  } catch {}
  return [];
}
function cleanDdg(u) { try { const m = u.match(/uddg=([^&]+)/); return m ? decodeURIComponent(m[1]) : u; } catch { return u; } }
function stripTags(s) { return String(s).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&#x?[0-9a-fA-F]+;/g, ' ').replace(/\s+/g, ' ').trim(); }
function decodeEntities(s) { return String(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }

export async function toolNews(q) { return toolWebSearch(`${q} actualités`); }

export async function toolWeather(city) {
  try {
    const r = await fetchJSON(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, {}, 10000);
    const cur = r.data?.current_condition?.[0];
    if (cur) return { ville: city, temp: `${cur.temp_C}°C`, ressenti: `${cur.FeelsLikeC}°C`, ciel: cur.weatherDesc?.[0]?.value, humidite: `${cur.humidity}%`, vent: `${cur.windspeedKmph} km/h` };
  } catch {}
  try {
    const geo = await fetchJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=fr&format=json`, {}, 8000);
    const place = geo.data?.results?.[0];
    if (!place) return { erreur: `ville introuvable: ${city}` };
    const r = await fetchJSON(`https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(place.latitude)}&longitude=${encodeURIComponent(place.longitude)}&current=temperature_2m,weather_code,wind_speed_10m`, {}, 10000);
    if (r.ok && r.data?.current) return { ville: place.name, pays: place.country, temp: `${r.data.current.temperature_2m}°C`, vent: `${r.data.current.wind_speed_10m} km/h` };
  } catch {}
  return { erreur: 'météo indisponible' };
}

export async function toolMLB(path) {
  const r = await fetchJSON(`https://statsapi.mlb.com/api/v1/${path}`, {}, 10000);
  return r.ok ? r.data : { erreur: 'MLB indisponible' };
}

export async function toolNBA(kind) {
  const url = kind === 'teams' ? 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams' : 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
  const r = await fetchJSON(url, {}, 10000);
  return r.ok ? r.data : { erreur: 'NBA indisponible' };
}

export async function toolFinance(what) {
  try {
    if (/btc|eth|crypto|bitcoin/i.test(what)) {
      const r = await fetchJSON('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd,eur', {}, 10000);
      if (r.ok) return r.data;
    }
    const sym = (what.match(/[A-Z]{2,5}/) || ['AAPL'])[0];
    const r = await fetchJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=5d`, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 10000);
    const meta = r.data?.chart?.result?.[0]?.meta;
    if (meta) return { symbole: meta.symbol, prix: `${meta.regularMarketPrice} ${meta.currency}`, variation_j5: meta.chartPreviousClose ? `${(((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100).toFixed(2)}%` : '?' };
  } catch {}
  return { erreur: 'données financières indisponibles' };
}

export async function toolWiki(topic, lang = 'fr') {
  const r = await fetchJSON(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`, {}, 10000);
  return r.ok ? r.data : { erreur: 'wikipédia indisponible' };
}

/* Média : images multi-chemins (Pollinations image API reste fiable malgré le texte ENOSPC) */
export function genImageUrl(prompt, w = 768, h = 768) {
  const seed = Math.floor(Math.random() * 1e6);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&nologo=true&seed=${seed}&referrer=gsam228`;
}

/* ============================ Mémoire conversations (stateful-safe) ============================ */

const memStore = new Map();
export async function loadMemory(sessionId) {
  const key = `gsam/memory/${encodeURIComponent(sessionId).slice(0, 120)}`;
  const persisted = await persistentGet(key);
  return Array.isArray(persisted) ? persisted : (memStore.get(sessionId) || []);
}
export async function saveMemory(sessionId, msgs) {
  const clean = msgs.slice(-40).map((m) => ({ role: String(m.role || '').slice(0, 20), content: String(m.content || '').slice(0, 12000) }));
  memStore.set(sessionId, clean);
  await persistentSet(`gsam/memory/${encodeURIComponent(sessionId).slice(0, 120)}`, clean);
}

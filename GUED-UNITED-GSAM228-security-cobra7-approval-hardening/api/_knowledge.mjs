// GSAM228 v4.1 — Super Base de Cerveaux (Knowledge Core)
// L'agent APPREND en continu SANS qu'on le lui demande :
//  1. Chaque conversation nourrit une mémoire épisodique (résumés auto).
//  2. Il capitalise des "leçons" sur les pannes/réussites des cerveaux IA (mémoire procédurale).
//  3. Il ingère des flux de connaissances gratuits sans clé (Wikipédia, Wikinews, arXiv, RSS)
//     pour disposer d'une base de connaissances fraîche injectée dans ses réponses.
// Tout est stocké côté serveur (Vercel Blob si token, sinon cache instance + localStorage client
// via l'API /api/knowledge?export=1 pour persistance cross-instance légère).

import { fetchJSON } from './_lib.mjs';

/* ============================ Stockage ============================ */

import { persistentGet, persistentSet, isPersistentStorageConfigured } from './_storage.mjs';

export async function kvGet(key) { return persistentGet(`gsam/kb/${key}`); }
export async function kvSet(key, value) { await persistentSet(`gsam/kb/${key}`, value); }

/* ============================ Mémoire épisodique (ce que l'agent a vu) ============================ */

const EPISODES_MAX = 60;
export async function rememberEpisode(sessionId, userMsg, answer, provider) {
  const eps = (await kvGet('episodes')) || [];
  // Résumé compact automatique : pas de stockage du texte intégral (RGPD-friendly)
  const topic = userMsg.slice(0, 120);
  const gist = String(answer).slice(0, 200).replace(/\s+/g, ' ');
  eps.unshift({ at: Date.now(), s: sessionId.slice(0, 8), topic, gist, p: provider });
  await kvSet('episodes', eps.slice(0, EPISODES_MAX));
}

export async function recallEpisodes(query, limit = 5) {
  const eps = (await kvGet('episodes')) || [];
  const words = String(query).toLowerCase().split(/[\s,;.!?]+/).filter((w) => w.length > 3);
  if (!words.length) return eps.slice(0, limit);
  const scored = eps.map((e) => {
    const hay = (e.topic + ' ' + e.gist).toLowerCase();
    let sc = 0; for (const w of words) if (hay.includes(w)) sc++;
    return { ...e, score: sc };
  }).filter((e) => e.score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/* ============================ Mémoire procédurale (leçons auto-apprises) ============================ */

export async function learnFromOutcome(brainId, ok, note = '') {
  const lessons = (await kvGet('lessons')) || {};
  const L = lessons[brainId] || { wins: 0, fails: 0, notes: [], updated: 0 };
  if (ok) L.wins++; else { L.fails++; if (note) { L.notes.push(String(note).slice(0, 120)); L.notes = L.notes.slice(-5); } }
  L.updated = Date.now();
  lessons[brainId] = L;
  await kvSet('lessons', lessons);
}

export async function proceduralAdvice() {
  const lessons = (await kvGet('lessons')) || {};
  const lines = [];
  for (const [id, L] of Object.entries(lessons)) {
    const total = L.wins + L.fails;
    if (total >= 3 && L.wins / total < 0.5) lines.push(`- ${id} est instable (${L.wins}/${total} réussites) : lui préférer les autres cerveaux si possible. Derniers motifs: ${L.notes.slice(-2).join(' | ')}`);
  }
  return lines.join('\n');
}

/* ============================ Ingestion continue (veille autonome) ============================ */
// Sources gratuites, sans clé, stables : Wikipédia (actualités), Wikinews, arXiv (science),
// NASA APOD (culture sci), et RSS internationaux. Rafraîchi max 1x/10 min par instance.

let lastIngest = 0;
const NEWS_TTL = 10 * 60 * 1000;

async function safeJson(url, ms = 9000) { try { const r = await fetchJSON(url, {}, ms); return r.ok ? r.data : null; } catch { return null; } }

export async function ingestNews() {
  const now = Date.now();
  if (now - lastIngest < NEWS_TTL) return (await kvGet('news-kb')) || [];
  const items = [];
  // 1. Wikinews FR (RSS -> on parse le XML en texte brut léger)
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 9000);
    const r = await fetch('https://fr.wikinews.org/w/api.php?action=query&list=news&format=json', { signal: ctl.signal }).catch(() => null);
    clearTimeout(t);
    if (r?.ok) { const j = await r.json().catch(() => null); for (const n of (j?.query?.news || []).slice(0, 5)) items.push({ src: 'Wikinews', title: n.title, url: n.url || '' }); }
  } catch {}
  // 2. Wikidata "current events" via Wikipédia FR (page Actualités → résumé)
  const wiki = await safeJson('https://fr.wikipedia.org/api/rest_v1/page/summary/Actualit%C3%A9s_et_%C3%A9v%C3%A9nements_en_cours');
  if (wiki?.extract) items.push({ src: 'Wikipédia', title: 'Événements en cours : ' + wiki.extract.slice(0, 200), url: wiki.content_urls?.desktop?.page || '' });
  // 3. arXiv cs.AI nouveaux papiers (science fraîche)
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 9000);
    const r = await fetch('https://export.arxiv.org/api/query?search_query=cat:cs.AI&sortBy=submittedDate&sortOrder=descending&max_results=3', { signal: ctl.signal }).catch(() => null);
    clearTimeout(t);
    if (r?.ok) { const x = await r.text(); for (const m of x.matchAll(/<title>([^<]{10,200})<\/title>/g)) { const ti = m[1]; if (ti !== 'arXiv Queries') items.push({ src: 'arXiv', title: ti, url: '' }); } }
  } catch {}
  // 4. NASA APOD (sans clé, API publique)
  const apod = await safeJson('https://api.nasa.gov/planetary/apod?count=2&thumbs=true', 9000); // clé DEMO rate-limitée mais fonctionne
  if (Array.isArray(apod)) for (const a of apod.slice(0, 2)) items.push({ src: 'NASA', title: a.title, url: a.hdurl || '' });

  const kb = items.slice(0, 12);
  await kvSet('news-kb', kb);
  lastIngest = now;
  return kb;
}

// Interprétation locale d'une requête de connaissance (sans LLM, filet de sécurité)
export async function knowledgeAnswer(query) {
  const kb = (await kvGet('news-kb')) || (await ingestNews());
  const eps = await recallEpisodes(query, 3);
  const words = String(query).toLowerCase().split(/[\s,;.!?]+/).filter((w) => w.length > 3);
  const hits = kb.filter((k) => words.some((w) => k.title.toLowerCase().includes(w)));
  return {
    found: hits.length > 0 || eps.length > 0,
    knowledge: (hits.length ? hits : kb.slice(0, 6)).map((k) => `- [${k.src}] ${k.title}${k.url ? ' (' + k.url + ')' : ''}`),
    episodes: eps.map((e) => `- ${new Date(e.at).toISOString().slice(0, 16)} : ${e.topic} → ${e.gist}`),
  };
}

/* ============================ Injection dans le prompt système ============================ */

export async function buildLearningContext(userQuery) {
  const parts = [];
  try {
    const advice = await proceduralAdvice();
    if (advice) parts.push(`LEÇONS AUTO-APPRISES (fiabilité de tes cerveaux):\n${advice}`);
    const eps = await recallEpisodes(userQuery, 4);
    if (eps.length) parts.push(`SOUVENIRS ÉPISODIQUES RÉCENTS PERTINENTS:\n${eps.map((e) => `- ${e.topic} → ${e.gist}`).join('\n')}`);
    const kb = (await kvGet('news-kb')) || [];
    if (kb.length) parts.push(`VEILLE AUTONOME FRAÎCHE (ingérée sans demande utilisateur, max 10 min):\n${kb.slice(0, 8).map((k) => `- [${k.src}] ${k.title.slice(0, 140)}`).join('\n')}`);
  } catch {}
  return parts.length ? `\n\n# BASE DE CONNAISSANCES VIVANTE (tu apprends en continu)\n${parts.join('\n\n')}\nUtilise ces souvenirs/veille uniquement s'ils sont pertinents ; cite la source [src].` : '';
}

/* ============================ Statistiques d'apprentissage ============================ */

export async function learningStats() {
  const [episodes, lessons, kb] = await Promise.all([kvGet('episodes'), kvGet('lessons'), kvGet('news-kb')]);
  return {
    episodes: (episodes || []).length,
    brains_with_lessons: Object.keys(lessons || {}).length,
    news_items_cached: (kb || []).length,
    persistent: isPersistentStorageConfigured(),
  };
}

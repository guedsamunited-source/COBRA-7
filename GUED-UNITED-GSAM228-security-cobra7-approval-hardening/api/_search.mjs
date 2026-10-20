// GUED-UNITED GSAM228 — module de recherche web agrégée (adaptation du concept Agent-Reach)
// Agent-Reach (github.com/Panniantong/Agent-Reach, MIT, ~5.7k★) est un CLI Python multi-sources :
// il est incompatible avec une architecture serverless Vercel/Node sans build step.
// Ce module en réimporte l'ARCHITECTURE côté JavaScript natif (zéro dépendance) :
//   1. Agrégation multi-sources avec ordre de priorité + fallback automatique
//   2. Timeout par source (une source morte ne bloque jamais la réponse)
//   3. Normalisation des résultats ({title, url, snippet, date, source})
// Sources : DuckDuckGo HTML (principale) → Google News RSS (actualités datées) → Wikipédia (encyclopédique).

import { fetchText, fetchJSON, UA } from './_lib.mjs';

const DDG_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function clean(s) {
  return String(s)
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\s+/g, ' ')
    .trim();
}

// Source 1 : DuckDuckGo HTML — titres + liens + extraits réels
export async function ddgSearch(q, limit = 6) {
  const html = await fetchText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, 9000, {
    'User-Agent': DDG_UA, 'Accept-Language': 'fr,en;q=0.8',
  });
  const results = [];
  const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>(?:[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g;
  let m;
  while ((m = re.exec(html)) && results.length < limit) {
    let url = decodeURIComponent(m[1]);
    const uddg = url.match(/uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    if (!/^https?:\/\//.test(url)) continue;
    const title = clean(m[2]);
    if (title) results.push({ title, url, snippet: clean(m[3] || ''), source: 'duckduckgo' });
  }
  return results;
}

// Source 2 : Google News RSS — actualités réelles avec date et média
export async function newsSearch(q, limit = 6) {
  const xml = await fetchText(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=fr&gl=FR&ceid=FR:fr`, 9000, { 'User-Agent': 'Mozilla/5.0' });
  const items = [];
  const re = /<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?(?:<pubDate>([\s\S]*?)<\/pubDate>)?[\s\S]*?(?:<source[^>]*>([\s\S]*?)<\/source>)?[\s\S]*?<\/item>/g;
  let m;
  while ((m = re.exec(xml)) && items.length < limit) {
    items.push({ title: clean(m[1]), url: m[2].trim(), date: (m[3] || '').trim(), media: clean(m[4] || ''), source: 'google-news' });
  }
  return items;
}

// Source 3 : Wikipédia FR — résumé encyclopédique sourcé
export async function wikiSearch(q, limit = 3) {
  const d = await fetchJSON(`https://fr.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrlimit=${limit}&gsrsearch=${encodeURIComponent(q)}&prop=extracts|info&exintro&explaintext&inprop=url`, 9000, { 'User-Agent': UA });
  return Object.values(d?.query?.pages || {})
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((p) => ({ title: p.title, url: p.fullurl, snippet: String(p.extract || '').slice(0, 400), source: 'wikipedia' }));
}

// Recherche agrégée à la manière d'Agent-Reach : tentative séquentielle avec repli automatique.
// Retourne toujours un tableau (éventuellement partiel) — ne lève jamais si au moins une source répond.
export async function aggregateSearch(q, { limit = 6 } = {}) {
  const errors = [];
  for (const [name, fn] of [['duckduckgo', ddgSearch], ['google-news', newsSearch], ['wikipedia', wikiSearch]]) {
    try {
      const r = await fn(q, limit);
      if (r.length) return { results: r.slice(0, limit), engine: name, degraded: errors.length > 0 ? errors : undefined };
      errors.push(`${name}: vide`);
    } catch (e) { errors.push(`${name}: ${e.message}`); }
  }
  return { results: [], engine: null, errors };
}

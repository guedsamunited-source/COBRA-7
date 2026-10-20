// GSAM228 v4.1 — endpoint agent principal (résilient + super base de cerveaux apprenante)
import { askAgentAlways as askAgent, ensureQuery, rateLimit, requireSession, toolWebSearch, toolNews, toolWeather, toolMLB, toolNBA, toolFinance, toolWiki, genImageUrl, BRAINS, hasValidKey, loadMemory, saveMemory, setLearnHook } from './_lib.mjs';
import { rememberEpisode, buildLearningContext, learnFromOutcome, ingestNews } from './_knowledge.mjs';

// Branchement des leçons procédurales : chaque succès/panne de cerveau est mémorisé automatiquement.
setLearnHook((id, ok, why) => { learnFromOutcome(id, ok, why).catch(() => {}); });
// Veille autonome déclenchée à chaque cold-start (fire-and-forget, jamais bloquant).
setTimeout(() => { ingestNews().catch(() => {}); }, 500);

const SYSTEM_BASE = `Tu es GSAM228, agent IA autonome de GUED-UNITED. Tu es toujours serviable, réponds dans la langue de l'utilisateur, cites tes sources quand tu utilises des outils.
Outils disponibles (syntaxe exacte sur une ligne) :
[[tool:web_search:requête]] [[tool:news:sujet]] [[tool:weather:ville]] [[tool:mlb:schedule?sportId=1]] [[tool:nba:games]] [[tool:finance:AAPL]] [[tool:wiki:sujet]] [[tool:genimage:description]]
Règles : si l'utilisateur demande une image/vidéo/fichier -> utilise l'outil, ne dis JAMAIS "je ne peux pas créer de fichiers". Si tu n'es pas sûr, pose une question.`;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    const q = ensureQuery(req);
    if (q.skills) {
      const skills = [];
      for (const b of BRAINS) skills.push({ id: b.id, label: b.label, active: await hasValidKey(b.id) || !b.needsKey });
      return res.status(200).json({ ok: true, skills, time: new Date().toISOString() });
    }
    if (q.search) return res.status(200).json({ ok: true, results: await toolWebSearch(String(q.search)) });
    return res.status(200).json({ ok: true, service: 'GSAM228 agent v4.1', endpoints: ['POST /api/ai', 'GET /api/ai?skills|search=', 'POST /api/media', 'GET /api/knowledge'] });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });

  const auth = requireSession(req, res);
  if (!auth) return;
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'anon';
  if (!rateLimit(ip, 60, 60000)) return res.status(429).json({ error: 'Trop de requêtes (60/min). Réessaie dans une minute.' });

  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch {}
  const message = String(body.message || '').slice(0, 4000);
  const sessionId = String(body.session || 'default').slice(0, 64);
  const model = body.model ? String(body.model).slice(0, 60) : undefined;
  if (!message.trim()) return res.status(400).json({ error: 'message requis' });
  // Outils directs : apprentissage épisodique aussi (l'agent mémorise ce qu'il a servi)
  const rememberDirect = (ans, prov) => { import('./_knowledge.mjs').then((k) => k.rememberEpisode(sessionId, message, ans, prov)).catch(() => {}); };

  // Outils directs côté serveur (pas besoin de LLM pour données brutes)
  const direct = /^(\/news|\/google|\/search|\/météo|\/meteo|\/mlb|\/nba|\/finance|\/wiki)\s+(.+)$/is.exec(message.trim());
  if (direct) {
    const cmd = direct[1].toLowerCase(), arg = direct[2];
    let out;
    if (cmd === '/news') out = await toolNews(arg);
    else if (cmd === '/google' || cmd === '/search') out = await toolWebSearch(arg);
    else if (cmd.startsWith('/m')) out = await toolWeather(arg);
    else if (cmd === '/mlb') out = await toolMLB(`schedule?sportId=1`);
    else if (cmd === '/nba') out = await toolNBA(/team/i.test(arg) ? 'teams' : 'games');
    else if (cmd === '/finance') out = await toolFinance(arg);
    else if (cmd === '/wiki') out = await toolWiki(arg);
    const ansD = formatTool(out); rememberDirect(ansD, 'outils-directs');
    return res.status(200).json({ ok: true, answer: ansD, provider: 'outils-directs', toolsUsed: [cmd] });
  }

  // Image directe
  if (/^\/(image|photo)\s+/i.test(message.trim())) {
    const url = genImageUrl(message.replace(/^\/(image|photo)\s*/i, ''), 1024, 1024);
    return res.status(200).json({ ok: true, answer: `🖼️ Image générée : ${url}`, imageUrl: url, provider: 'pollinations-image' });
  }

  try {
    const history = await loadMemory(sessionId);
    // Super base de cerveaux : contexte d'apprentissage injecté automatiquement (veille + souvenirs + leçons)
    const learnCtx = await buildLearningContext(message).catch(() => '');
    const SYSTEM = SYSTEM_BASE + (learnCtx || '');
    const messages = [{ role: 'system', content: SYSTEM }, ...history.slice(-16), { role: 'user', content: message }];
    const t0 = Date.now();
    const r = await askAgent(messages, model);
    let answer = r.text;
    const usedTools = [];
    // Exécution des outils demandés par le cerveau + rebouclage 1 fois
    const toolCalls = [...answer.matchAll(/\[\[tool:(\w+):([^\]]+)\]\]/g)];
    if (toolCalls.length) {
      const toolResults = [];
      for (const [, name, arg] of toolCalls.slice(0, 3)) {
        usedTools.push(name);
        let out;
        if (name === 'web_search') out = await toolWebSearch(arg);
        else if (name === 'news') out = await toolNews(arg);
        else if (name === 'weather') out = await toolWeather(arg);
        else if (name === 'mlb') out = await toolMLB(arg);
        else if (name === 'nba') out = await toolNBA(arg);
        else if (name === 'finance') out = await toolFinance(arg);
        else if (name === 'wiki') out = await toolWiki(arg);
        else if (name === 'genimage') { const u = genImageUrl(arg, 1024, 768); out = { image: u }; }
        toolResults.push(`${name}(${arg}) => ${JSON.stringify(out).slice(0, 1500)}`);
      }
      const finalMsgs = [...messages, { role: 'assistant', content: answer }, { role: 'user', content: `Résultats outils:\n${toolResults.join('\n')}\nRédige maintenant la réponse finale à la question initiale en français/langue utilisateur avec ces données et les sources URLs.` }];
      try {
        const r2 = await askAgent(finalMsgs, model);
        answer = r2.text;
      } catch { answer = answer.replace(/\[\[tool:[^\]]+\]\]/g, '') + '\n\n' + toolResults.map((t) => t.split('=>')[1]).join('\n'); }
    }
    answer = answer.replace(/\[\[tool:[^\]]+\]\]/g, '');
    const img = /https:\/\/image\.pollinations\.ai\/[^\s)"']+/ .exec(answer);
    await saveMemory(sessionId, [...history, { role: 'user', content: message }, { role: 'assistant', content: answer }].slice(-40));
    // Apprentissage épisodique automatique (sans demande utilisateur)
    rememberEpisode(sessionId, message, answer, r.provider).catch(() => {});
    return res.status(200).json({
      ok: true, answer, provider: r.provider, label: r.label,
      toolsUsed: usedTools, imageUrl: img?.[0], ms: Date.now() - t0, session: sessionId,
    });
  } catch (e) {
    // Filet de sécurité ultime : réponse locale utile même sans aucun cerveau disponible
    const fallback = `⚠️ Les cerveaux IA sont momentanément indisponibles (${(e.chain || []).join(', ') || e.message}).
Je reste opérationnel pour mes outils directs : tape /news <sujet>, /search <requête>, /meteo <ville>, /mlb, /nba, /finance <symbole>, /wiki <sujet>, /image <description>. Un nouvel essai du cerveau principal se fera automatiquement à ta prochaine question.`;
    return res.status(200).json({ ok: true, answer: fallback, provider: 'fallback-local', degraded: true });
  }
}

function formatTool(o) {
  if (Array.isArray(o)) return o.map((it, i) => `${i + 1}. **${it.title || it.name || 'résultat'}**\n   ${it.snippet || ''}\n   🔗 ${it.url || ''}`).join('\n\n') || 'Aucun résultat.';
  return '```json\n' + JSON.stringify(o, null, 1).slice(0, 3000) + '\n```';
}

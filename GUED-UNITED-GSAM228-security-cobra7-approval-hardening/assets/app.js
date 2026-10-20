// GSAM228 v5.0 — frontend agent (chat, voix, outils, statut temps réel) + gate d'accès sécurisé
const $ = (s) => document.querySelector(s);
const msgs = $('#msgs'), input = $('#chatInput'), meta = $('#chatMeta');
let session = '';
let currentUser = null;

/* Lecture défensive JSON : ne plante jamais sur une réponse HTML/texte (erreur Vercel, 404, 5xx…) */
async function safeJson(r) { try { const j = JSON.parse(await r.text()); return (j && typeof j === 'object') ? j : null; } catch { return null; } }

/* ---------- GATE : inscription / connexion obligatoire avant accès ---------- */
async function authApi(params) {
  const r = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(params) });
  return (await safeJson(r)) || { error: 'Service indisponible (' + r.status + ') — réessaie.' };
}
function enterSite(user) {
  currentUser = user || currentUser;
  $('#gate').style.display = 'none';
  document.body.classList.remove('locked');
  if (currentUser) localStorage.setItem('gsam_user', JSON.stringify(currentUser));
  refreshStatus && refreshStatus();
  updateSessionChip();
}
function updateSessionChip() {
  const el = $('#sessionChip');
  if (!el) return;
  el.textContent = currentUser ? `👤 ${currentUser.name || currentUser.email}` : '🟢 GSAM228';
  const b = document.createElement('button'); b.className = 'sessionLogout'; b.textContent = 'Déconnexion';
  b.onclick = async () => { await authApi({ action: 'logout' }).catch(() => {}); currentUser = null; localStorage.removeItem('gsam_user'); $('#gate').style.display = ''; document.body.classList.add('locked'); };
  el.append(' · ', b);
}
function showGateError(msg) { const el = $('#gateErr'); el.textContent = msg; el.style.display = msg ? 'block' : 'none'; }
function initGate() {
  const g = $('#gate'); if (!g) return;
  let mode = 'login';
  const render = () => {
    $('#gateTitle').textContent = mode === 'login' ? 'Connexion à GSAM228' : 'Créer un compte GSAM228';
    $('#gateSubmit').textContent = mode === 'login' ? 'Se connecter →' : "S'inscrire →";
    $('#gateNameRow').style.display = mode === 'register' ? '' : 'none';
    $('#gateSwitch').textContent = mode === 'login' ? "Pas de compte ? Inscris-toi" : 'Déjà un compte ? Connecte-toi';
    showGateError('');
  };
  $('#gateSwitch').onclick = () => { mode = mode === 'login' ? 'register' : 'login'; render(); };
  render();
  $('#gateForm').onsubmit = async (e) => {
    e.preventDefault(); showGateError('⏳ …');
    try {
      const j = await authApi({ action: mode, email: $('#gateEmail').value, password: $('#gatePassword').value, name: $('#gateName').value });
      if (j.ok) enterSite(j.user); else showGateError(j.error || 'Échec de la connexion.');
    } catch (err) { showGateError('Serveur injoignable — vérifie ton réseau ou le déploiement (' + err.message + ').'); }
  };
  $('#gateGoogle').onclick = () => {
    // OAuth full-page : plus robuste qu'un popup (pas de postMessage, pas de fenêtre bloquée).
    showGateError('⏳ Redirection sécurisée vers Google…');
    window.location.assign('/api/auth/google?returnTo=' + encodeURIComponent(location.pathname + location.search));
  };
  // La session est désormais HttpOnly : aucun token d'authentification n'est stocké dans localStorage.
  const params = new URLSearchParams(location.search);
  const authError = params.get('auth_error');
  if (authError) { showGateError('❌ ' + authError); params.delete('auth_error'); history.replaceState({}, '', location.pathname + (params.toString() ? '?' + params.toString() : '') + location.hash); }
  authApi({ action: 'me' }).then((j) => {
    if (j.ok) enterSite(j.user);
    else { currentUser = null; localStorage.removeItem('gsam_user'); }
  }).catch(() => {});
}
document.body.classList.add('locked');

/* ---------- fond animé : ondes + particules ---------- */
(function bgfx() {
  const c = $('#bgfx'), x = c.getContext('2d');
  let W, H, t = 0, mx = 0.5, parts = [];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function size() { W = c.width = innerWidth; H = c.height = innerHeight; }
  addEventListener('resize', size); size();
  for (let i = 0; i < 40; i++) parts.push({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .3, vy: (Math.random() - .5) * .3, r: Math.random() * 1.8 + .4 });
  addEventListener('mousemove', (e) => { mx = e.clientX / W; });
  function draw() {
    x.clearRect(0, 0, W, H); t += .008;
    for (let k = 0; k < 9; k++) {
      x.beginPath();
      for (let px = 0; px <= W; px += 8) {
        const py = H * (.35 + k * .05) + Math.sin(px * .004 + t * (1 + k * .18) + k) * (26 + k * 7) * Math.sin(t * .5 + mx * 3);
        px ? x.lineTo(px, py) : x.moveTo(px, py);
      }
      x.strokeStyle = `hsla(${190 + k * 14},95%,62%,${.05 + .02 * Math.sin(t + k)})`;
      x.lineWidth = 1.4; x.stroke();
    }
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = W; if (p.x > W) p.x = 0; if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
      x.beginPath(); x.arc(p.x, p.y, p.r, 0, 7); x.fillStyle = 'rgba(120,180,255,.35)'; x.fill();
    }
    if (!reduced) requestAnimationFrame(draw);
  }
  draw();
})();

/* ---------- onglets ---------- */
document.querySelectorAll('.tab').forEach((b) => b.onclick = () => {
  document.querySelectorAll('.tab,.panel').forEach((el) => el.classList.remove('active'));
  b.classList.add('active'); $('#tab-' + b.dataset.tab).classList.add('active');
});
document.querySelectorAll('.cards button').forEach((b) => b.onclick = () => { switchTab('chat'); ask(b.dataset.cmd.trim() || b.dataset.cmd + 'exemple'); });
function switchTab(id) { document.querySelectorAll('.tab,.panel').forEach((el) => el.classList.remove('active')); document.querySelector(`.tab[data-tab=${id}]`).classList.add('active'); $(`#tab-${id}`).classList.add('active'); }

/* ---------- bulles ---------- */
function bubble(cls, html) { const d = document.createElement('div'); d.className = 'bubble ' + cls; d.innerHTML = html; msgs.append(d); msgs.scrollTop = msgs.scrollHeight; return d; }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function md(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.*?)`/g, '<code>$1</code>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>'); }

/* ---------- envoi ---------- */
$('#chatForm').onsubmit = (e) => { e.preventDefault(); const v = input.value.trim(); if (!v) return; input.value = ''; ask(v); };
async function ask(text) {
  if (/^\/video\s+/i.test(text)) return askVideo(text.replace(/^\/video\s+/i, ''));
  if (text === '/clear') { msgs.innerHTML = ''; meta.textContent = 'Historique local effacé.'; return; }
  if (text === '/skills' || text === '/status') { switchTab('status'); refreshStatus(); return; }
  if (text.startsWith('/aide')) { bubble('agent', md('Commandes : /search /news /meteo /mlb /nba /finance /wiki /image /video /skills /clear /ping')); return; }
  if (text === '/ping') { bubble('agent', '🏓 pong ! Service vivant.'); return; }
  bubble('user', md(text));
  const typing = bubble('agent typing', '<i></i><i></i><i></i> Analyse…');
  try {
    const r = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, session }) });
    // Lecture défensive : ne JAMAIS planter sur une réponse non-JSON (erreur HTML Vercel, page 404/5xx, texte brut…)
    const raw = await r.text();
    let j = null;
    try { j = JSON.parse(raw); } catch { j = null; }
    typing.remove();
    if (!j || typeof j !== 'object') {
      const hint = r.status === 404 ? "Service introuvable (déploiement inactif ou URL erronée)."
        : r.status === 429 ? "Trop de requêtes — patiente une minute."
        : `Le service a répondu ${r.status} au lieu d'un résultat exploitable.`;
      bubble('agent', md(`⚠️ ${hint} Réessaie — le service auto-guérit ses cerveaux en cascade.`));
      return;
    }
    if (!r.ok && !j.answer) { bubble('agent', md('⚠️ ' + (j.error || 'Erreur serveur ' + r.status + '. Réessaie — le service auto-guérit ses cerveaux en cascade.'))); return; }
    let out = md(j.answer || j.error || 'Réponse vide.');
    if (j.imageUrl && !/!\[/.test(out)) out += `<br><img src="${esc(j.imageUrl)}" alt="image générée" loading="lazy">`;
    bubble('agent', out);
    meta.textContent = `cerveau: ${j.label || j.provider}${j.toolsUsed?.length ? ' · outils: ' + j.toolsUsed.join(',') : ''} · ${j.ms ?? '?'} ms${j.degraded ? ' · mode dégradé actif' : ''}`;
    speakLast(j.answer);
  } catch (e) {
    typing.remove();
    bubble('agent', md('⚠️ Erseau réseau : ' + e.message + '. Réessaie — le service auto-guérit ses cerveaux en cascade.'));
  }
}

/* ---------- vidéo (job asynchrone) ---------- */
async function askVideo(prompt) {
  bubble('user', md('/video ' + prompt));
  const card = bubble('agent', '🎬 Préparation média…');
  try {
    const r = await fetch('/api/media', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'video', prompt }) });
    const j = (await safeJson(r)) || {};
    if (!r.ok) { card.innerHTML = md('❌ ' + (j.error || `Service média ${r.status}.`)); return; }
    if (j.url) { card.innerHTML = `🎬 Média prêt :<br><video src="${esc(j.url)}" controls preload="metadata" style="max-width:100%;border-radius:12px"></video>`; return; }
    if (j.poster) { card.innerHTML = `🎞️ ${md(j.message || 'Poster cinématique généré.')}<br><img src="${esc(j.poster)}" alt="poster cinématique" loading="lazy" style="max-width:100%;border-radius:12px">`; return; }
    card.textContent = '⚠️ Aucun résultat média exploitable.';
  } catch (e) { card.textContent = '⚠️ ' + e.message; }
}

/* ---------- voix STT/TTS (dictée chat) ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recog = null, listening = false;
function setupRecog(lang = 'fr-FR') { if (!SR) return null; const r = new SR(); r.lang = lang; r.interimResults = true; r.continuous = true; r.maxAlternatives = 1; return r; }
function micToggle(target) {
  if (!SR) { bubble('agent', '🎤 Reconnaissance vocale non supportée par ce navigateur (essaie Chrome).'); return; }
  if (listening) { recog.stop(); return; }
  recog = setupRecog(); listening = true; target.classList.add('listening');
  recog.onresult = (e) => { input.value = e.results[e.results.length - 1][0].transcript; };
  recog.onend = () => { listening = false; target.classList.remove('listening'); const v = input.value.trim(); if (v && !v.startsWith('/')) ask(v); input.value = ''; };
  recog.onerror = () => { listening = false; target.classList.remove('listening'); };
  recog.start();
}
$('#micBtn').onclick = () => micToggle($('#micBtn'));

/* ==================== 📞 CONVERSATION VOCALE TEMPS RÉEL (façon Ava) ==================== */
let inCall = false, callRecog = null;
const orb = $('#callOrb'), orbIcon = $('#orbIcon'), vStatus = $('#voiceStatus'), transcriptBox = $('#callTranscript');
function tLine(cls, txt) { const d = document.createElement('div'); d.className = 'tline ' + cls; d.textContent = txt; transcriptBox.append(d); transcriptBox.scrollTop = transcriptBox.scrollHeight; }
function speak(text, onend) {
  if (!$('#ttsOn')?.checked || !text || !window.speechSynthesis) { onend?.(); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.slice(0, 900));
  u.lang = 'fr-FR'; u.rate = 1.04; u.pitch = 1.0;
  u.onstart = () => { orbIcon.textContent = '🔊'; orb.classList.add('speaking'); };
  u.onend = () => { orbIcon.textContent = inCall ? '🎙️' : '📞'; orb.classList.remove('speaking'); if (inCall) resumeListening(); onend?.(); };
  speechSynthesis.speak(u);
}
function resumeListening() { try { if (inCall && callRecog && !callRecog._running) callRecog.start(); } catch {} }
async function voiceTurn(transcript) {
  if (!transcript) return;
  tLine('me', transcript);
  // Barge-in vocal : « stop / arrête / tais-toi » coupe la voix, comme Ava
  if (/^(stop|arr[\eê]te|tais[-\s]?toi|chut|silence)\b/i.test(transcript)) { speechSynthesis.cancel(); vStatus.textContent = 'Voix coupée. Je t\'écoute toujours…'; return; }
  orbIcon.textContent = '🧠'; vStatus.textContent = 'Je réfléchis…';
  try {
    const r = await fetch('/api/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript, session }) });
    const j = (await safeJson(r)) || {};
    const reply = j.reply || 'Je n\'ai pas bien compris — peux-tu répéter ?';
    tLine('ia', reply);
    vStatus.textContent = 'Je réponds à voix haute…';
    speak(reply);
  } catch (e) { tLine('ia', '⚠️ Réseau instable, je réessaierai.'); vStatus.textContent = 'Réseau instable — parle encore, j\'écoute.'; orbIcon.textContent = '🎙️'; }
}
function startCall() {
  if (!SR) { vStatus.textContent = '🎤 Appel vocal non supporté par ce navigateur (Chrome requis).'; return; }
  inCall = true; transcriptBox.innerHTML = '';
  $('#startCall').hidden = true; $('#hangUp').hidden = false;
  orb.classList.add('incall'); orbIcon.textContent = '🎙️';
  vStatus.textContent = 'Appel en cours — parle naturellement, je réponds à voix haute.';
  callRecog = setupRecog(); callRecog._running = true;
  let finalBuf = '';
  callRecog.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) finalBuf += res[0].transcript; else interim += res[0].transcript;
    }
    if (interim) { vStatus.textContent = '👂 ' + interim.slice(-60); orbIcon.textContent = '👂'; }
    if (finalBuf.trim()) { const t = finalBuf.trim(); finalBuf = ''; voiceTurn(t); }
  };
  callRecog.onend = () => { callRecog._running = false; if (inCall) setTimeout(resumeListening, 350); };
  callRecog.onerror = (ev) => { callRecog._running = false; if (inCall && ev.error !== 'no-speech') setTimeout(resumeListening, 700); };
  callRecog.start();
  speak('GSAM228');
}
function hangUp() {
  inCall = false; try { callRecog?.stop(); } catch {}
  speechSynthesis.cancel();
  $('#startCall').hidden = false; $('#hangUp').hidden = true;
  orb.classList.remove('incall', 'speaking'); orbIcon.textContent = '📞';
  vStatus.textContent = 'Appel terminé. Rappelle quand tu veux.';
}
$('#startCall').onclick = startCall;
$('#hangUp').onclick = hangUp;
orb.onclick = () => { if (inCall) hangUp(); else startCall(); };
// Barge-in technique : un tap pendant que l'agent parle -> coupe le TTS immédiatement
document.addEventListener('pointerdown', (e) => { if (inCall && $('#bargeOn')?.checked && window.speechSynthesis?.speaking && !e.target.closest('#hangUp')) speechSynthesis.cancel(); });

/* ==================== 📸 VISION : montrer un problème réel à l'agent ==================== */
$('#visionBtn').onclick = () => $('#visionFile').click();
$('#visionFile').onchange = async (e) => {
  const f = e.target.files?.[0]; if (!f) return;
  e.target.value = '';
  if (f.size > 3_500_000) { bubble('agent', '📸 Image trop lourde (max ~3 Mo). Compresse-la ou recadre-la.'); return; }
  const q = input.value.trim(); input.value = '';
  bubble('user', `📸 [capture : ${esc(f.name)}]${q ? ' — ' + md(q) : ''}`);
  const typing = bubble('agent typing', '<i></i><i></i><i></i> J\'analyse ton image…');
  try {
    const dataUrl = await new Promise((res, rej) => { const rd = new FileReader(); rd.onload = () => res(rd.result); rd.onerror = rej; rd.readAsDataURL(f); });
    const r = await fetch('/api/vision', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: dataUrl, question: q || undefined }) });
    const j = (await safeJson(r)) || {};
    typing.remove();
    bubble('agent', md(j.analysis || j.error || 'Analyse indisponible.') + `<br><img src="${esc(dataUrl)}" alt="ton problème" style="max-width:280px;border-radius:10px;opacity:.85">`);
    meta.textContent = j.degraded ? 'vision: mode dégradé (cerveaux vision occupés)' : `vision: ${j.model}`;
    speakLast(j.analysis);
  } catch (err) { typing.remove(); bubble('agent', md('⚠️ ' + err.message)); }
};
function speakLast(t) { if (!$('#ttsOn')?.checked || !t || !window.speechSynthesis) return; speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t.slice(0, 700).replace(/```[\s\S]*?```/g, ' code omis ').replace(/https?:\/\/\S+/g, 'lien')); u.lang = 'fr-FR'; u.rate = 1.05; speechSynthesis.speak(u); }

/* ---------- statut / skills ---------- */
async function refreshStatus() {
  updateSessionChip();
  try {
    const j = (await safeJson(await fetch('/api/ai?skills=1'))) || {};
    const list = j.skills || [];
    const active = list.filter((s) => s.active).length;
    const pct = list.length ? Math.round((active / list.length) * 100) : 0;
    $('#gaugeTxt').textContent = pct + '%';
    $('#ringFg').style.strokeDashoffset = String(327 - 327 * pct / 100);
    $('#ringFg').style.stroke = pct >= 60 ? '#3ce88f' : pct >= 30 ? '#ffc75c' : '#ff6b6b';
    $('#skillsList').innerHTML = list.map((s) => `<div class="skill"><span>${esc(s.label)}</span><span class="dot ${s.active ? 'ok' : 'off'}"></span></div>`).join('');
  } catch { $('#skillsList').innerHTML = '<div class="skill">❌ Endpoint /api/ai injoignable — vérifie le déploiement.</div>'; }
  // Super base de cerveaux : statistiques d'apprentissage continu
  try {
    const k = (await safeJson(await fetch('/api/knowledge?stats=1'))) || {};
    if (k.ok) {
      $('#skillsList').insertAdjacentHTML('beforeend',
        `<div class="skill"><span>🧠 Cerveau apprenant — ${k.episodes} souvenirs, ${k.brains_with_lessons} cerveaux notés, ${k.news_items_cached} veille fraîche${k.persistent ? ' · persistant ✔' : ''}</span><span class="dot ok"></span></div>`);
    }
  } catch {}
}
$('#refreshStatus').onclick = refreshStatus;
if (document.body.classList.contains('locked')) {
  // Gate actif : pas de statut tant que non connecté (enterSite déclenchera refreshStatus)
} else { refreshStatus(); }

/* ---------- déconnexion ---------- */
initGate();

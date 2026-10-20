// GET /api/auth/google — démarre OAuth Google par redirection serveur.
// Le flux full-page est volontairement utilisé : il évite les problèmes de popup,
// postMessage, bloqueurs de fenêtres et politiques COOP/ITP des navigateurs.
import { buildAuthUrl, googleConfigured } from '../_google.mjs';

function redirect(res, location, status = 302) {
  if (typeof res.redirect === 'function') return res.redirect(status, location);
  res.statusCode = status;
  res.setHeader('Location', location);
  return res.end();
}

function safeReturnTo(value) {
  const s = String(value || '/');
  return /^\/[A-Za-z0-9_\-./?=&%]*$/.test(s) ? s : '/';
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    return res.end('Method Not Allowed');
  }
  if (!googleConfigured(req)) {
    return redirect(res, '/?auth_error=' + encodeURIComponent('Connexion Google non configurée. Ajoute GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET et GOOGLE_REDIRECT_URI dans Vercel.'), 302);
  }
  try {
    const u = new URL(req.url || '/', 'https://local.invalid');
    const returnTo = safeReturnTo(u.searchParams.get('returnTo') || '/');
    return redirect(res, buildAuthUrl(req, returnTo));
  } catch (e) {
    return redirect(res, '/?auth_error=' + encodeURIComponent('Impossible de démarrer la connexion Google.'), 302);
  }
}

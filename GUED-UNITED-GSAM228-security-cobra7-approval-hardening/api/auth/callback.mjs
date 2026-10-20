// GET /api/auth/callback — termine OAuth Google, pose le cookie HttpOnly,
// puis redirige vers l'application. Aucun popup/postMessage n'est nécessaire.
import { completeLogin } from '../_google.mjs';
import { setSessionCookie } from '../_lib.mjs';

function redirect(res, location, status = 302) {
  if (typeof res.redirect === 'function') return res.redirect(status, location);
  res.statusCode = status;
  res.setHeader('Location', location);
  return res.end();
}

export default async function handler(req, res) {
  let result;
  try {
    result = await completeLogin(req, req.query || {});
  } catch (e) {
    result = { error: String(e.message || e) };
  }

  const returnTo = result?.returnTo || '/';
  if (!result.error && result.session) {
    setSessionCookie(res, result.session);
    const sep = returnTo.includes('?') ? '&' : '?';
    return redirect(res, `${returnTo}${sep}auth=google`, 302);
  }

  const target = `/?auth_error=${encodeURIComponent(result?.error || 'Connexion Google échouée.')}`;
  return redirect(res, target, 302);
}

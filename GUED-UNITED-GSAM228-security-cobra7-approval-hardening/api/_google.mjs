// GUED-UNITED GSAM228 — OAuth 2.0 Google (production, flux authorization code + PKCE)
// Aucune bibliothèque externe : fetch natif + crypto Node. Secrets côté serveur uniquement.
// Config requise (Vercel → Settings → Environment Variables) :
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
import { createHmac, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { signSession } from "./_lib.mjs";

const STATE_TTL = 10 * 60; // 10 minutes pour compléter la redirection

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function googleConfigured(req) {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GUED_SESSION_SECRET && googleRedirectUri(req));
}
function stateSig(payload) {
  const secret = process.env.GUED_SESSION_SECRET || 'local-development-only-change-me';
  return b64url(createHmac('sha256', secret).update(payload).digest());
}
// State signé côté serveur (anti-CSRF) : payload b64url | signature | nonce aléatoire
function makeState(verifier, returnTo = '/') {
  const safeReturnTo = /^\/[A-Za-z0-9_\-./?=&%]*$/.test(returnTo) ? returnTo : '/';
  const payload = b64url(JSON.stringify({ v: verifier, e: Date.now() + STATE_TTL * 1000, n: b64url(randomBytes(12)), r: safeReturnTo }));
  return `${payload}.${stateSig(payload)}`;
}
function checkState(st) {
  if (typeof st !== 'string') return null;
  const parts = st.split('.');
  if (parts.length !== 2) return null;
  try {
    const expected = Buffer.from(stateSig(parts[0]));
    const got = Buffer.from(parts[1]);
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
    const obj = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!obj.v || Number(obj.e) < Date.now()) return null;
    return { verifier: obj.v, returnTo: /^\/[A-Za-z0-9_\-./?=&%]*$/.test(obj.r || '/') ? obj.r : '/' };
  } catch { return null; }
}

// URI de redirection : variable explicite sinon dérivée automatiquement de la requête
// (compatible preview/prod Vercel — il suffit d'ajouter le domaine racine *.vercel.app côté Google)
export function googleRedirectUri(req) {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const host = req?.headers?.host || process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!host) return null;
  return `https://${host}/api/auth/callback`;
}

// Étape 1 : le frontend appelle GET /api/auth/google → renvoie l'URL de consentement Google
export function buildAuthUrl(req, returnTo = '/') {
  const verifier = b64url(randomBytes(32)); // PKCE S256
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = makeState(verifier, returnTo);
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID);
  u.searchParams.set('redirect_uri', googleRedirectUri(req));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'openid email profile');
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('prompt', 'select_account');
  return String(u);
}
// Étape 2 : callback Google → échange code+verifier contre id_token, vérification, session GSAM228
export async function completeLogin(req, query) {
  const code = String(query.code || '');
  const state = String(query.state || '');
  const err = String(query.error || '');
  if (err) return { error: `Google a refusé la connexion (${err})` };
  const redirectUri = googleRedirectUri(req);
  if (!googleConfigured(req)) return { error: 'OAuth Google non configuré sur ce serveur (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET manquants)', unconfigured: true };
  if (!code || !state) return { error: 'paramètres "code" et "state" requis' };
  const stateData = checkState(state);
  if (!stateData) return { error: 'État OAuth invalide ou expiré — recommencez la connexion' };
  const verifier = stateData.verifier;

  // Échange du code (PKCE) auprès du token endpoint Google
  const tokRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri, grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(10000),
  });
  const tok = await tokRes.json().catch(() => ({}));
  if (!tokRes.ok || !tok.id_token) return { error: `échange de code échoué : ${tok.error_description || tok.error || 'HTTP ' + tokRes.status}` };

  // Vérification stricte du jeton d'identité : signature via JWKS Google (RS256, node:crypto natif)
  const claims = await verifyIdToken(tok.id_token);
  if (!claims) return { error: 'jeton Google invalide (signature ou audience rejetée)' };
  const email = String(claims.email || '').trim().toLowerCase();
  if (!email || claims.email_verified !== true) return { error: 'adresse email non vérifiée par Google' };

  return {
    user: email,
    name: String(claims.name || email.split('@')[0]).slice(0, 80),
    picture: typeof claims.picture === 'string' ? claims.picture.slice(0, 500) : '',
    session: signSession({ user: `google:${email}`, exp: Date.now() + 30 * 24 * 3600 * 1000 }),
    provider: 'google',
    returnTo: stateData.returnTo,
  };
}

// Validation JWT RS256 sans dépendance : cache des clés publiques Google (JWKS)
let jwksCache = { at: 0, keys: [] };
async function getJwks() {
  if (jwksCache.keys.length && Date.now() - jwksCache.at < 3600_000) return jwksCache.keys;
  const r = await fetch('https://www.googleapis.com/oauth2/v3/certs', { signal: AbortSignal.timeout(8000) });
  const { createPublicKey } = await import('node:crypto');
  const jwks = await r.json();
  jwksCache = {
    at: Date.now(),
    keys: (jwks.keys || []).map((k) => ({ kid: k.kid, key: createPublicKey({ key: k, format: 'jwk' }) })),
  };
  return jwksCache.keys;
}
async function verifyIdToken(idToken) {
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  let header, payload;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url'));
    payload = JSON.parse(Buffer.from(parts[1], 'base64url'));
  } catch { return null; }
  if (header.alg !== 'RS256' || !header.kid) return null;
  const keys = await getJwks();
  const entry = keys.find((k) => k.kid === header.kid);
  if (!entry) return null;
  const { createVerify } = await import('node:crypto');
  const v = createVerify('RSA-SHA256');
  v.update(`${parts[0]}.${parts[1]}`);
  if (!v.verify(entry.key, Buffer.from(parts[2], 'base64url'))) return null;
  // Assertions standard OpenID Connect
  const audOk = payload.aud === process.env.GOOGLE_CLIENT_ID;
  const issOk = payload.iss === 'https://accounts.google.com' || payload.iss === 'accounts.google.com';
  const now = Math.floor(Date.now() / 1000);
  if (!audOk || !issOk || Number(payload.exp) < now || Number(payload.iat) > now + 60) return null;
  return payload;
}

export { googleConfigured };

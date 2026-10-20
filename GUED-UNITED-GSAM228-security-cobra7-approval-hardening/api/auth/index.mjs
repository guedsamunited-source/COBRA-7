// POST/GET /api/auth → inscription, connexion, session, déconnexion (email + mot de passe)
import { authHandler } from '../_lib.mjs';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return;
  return authHandler(req, res);
}

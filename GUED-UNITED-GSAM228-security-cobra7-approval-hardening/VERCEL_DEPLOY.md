# GSAM228 v6 — déploiement Vercel

## 1. GitHub

Le code applicatif est conservé dans le dossier `GUED-UNITED-GSAM228-security-cobra7-approval-hardening/` à la racine du dépôt `COBRA-7`. Ne pas envoyer le ZIP et ne pas déplacer les fichiers au hasard.

## 2. Vercel

Relier le projet au dépôt GitHub `guedsamunited-source/COBRA-7` et configurer exactement :

- Framework Preset: Other / détection automatique (pas FastAPI)
- Root Directory: `GUED-UNITED-GSAM228-security-cobra7-approval-hardening`
- Build Command: vide / détection automatique
- Output Directory: vide / détection automatique
- Node.js: `24.x` ou une version prise en charge

Vercel doit détecter `api/**/*.mjs` comme fonctions Node.js serverless. Le répertoire racine doit contenir `index.html`, `package.json`, `vercel.json`, `assets/` et `api/`.

Vercel détecte `api/**/*.mjs` comme fonctions serverless.

## 3. Variables indispensables

Créer dans Vercel → Settings → Environment Variables:

- `GUED_SESSION_SECRET` : secret aléatoire long (32 caractères minimum, idéalement 64+)
- `BLOB_READ_WRITE_TOKEN` : token du Vercel Blob Store

Sans ces deux variables, l'authentification/persistance ne doit pas être considérée comme production-ready.

## 4. IA (au choix)

Ajouter au moins une clé :

- `GEMINI_API_KEY`
- `NVIDIA_API_KEY`
- `GROQ_API_KEY`
- `OPENROUTER_API_KEY`
- `HF_TOKEN`

Pollinations et le cerveau autonome restent des replis, mais leur disponibilité dépend du fournisseur externe.

## 5. Google OAuth (optionnel)

Ajouter :

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI=https://VOTRE-DOMAINE/api/auth/callback`
- `GUED_SESSION_SECRET`

Dans Google Cloud, enregistrer exactement la même URI de redirection.

## 6. Vidéo (optionnel)

Pour une génération vidéo réelle et persistante :

- `VIDEO_API_URL`
- `VIDEO_API_KEY`

Si aucun fournisseur vidéo n'est configuré, GSAM228 ne simule plus un job : il renvoie honnêtement un poster cinématique.

## 7. Tests locaux

```bash
npm install
npm test
```

Le test final distingue les fonctions locales des intégrations Internet. Une panne DNS externe ne doit pas être confondue avec un bug du projet.

## 8. Sécurité

- authentification POST uniquement
- session HttpOnly/Secure en production
- pas de token de session dans localStorage
- rate limiting local (à compléter par un rate limiter distribué si très forte charge)
- CSP et headers de sécurité
- pas d'exécution arbitraire de shell
- pas de job vidéo conservé dans une `Map()` comme source de vérité
- mémoire et comptes via stockage persistant lorsqu'il est configuré

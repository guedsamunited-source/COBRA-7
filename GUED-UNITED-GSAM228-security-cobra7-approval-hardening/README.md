# GUED-UNITED — GSAM228 v6

GSAM228 est un agent IA serverless conçu pour Vercel. Cette version privilégie la robustesse, la sécurité et l'honnêteté des capacités : aucune donnée critique ne dépend d'une instance Vercel et aucune vidéo n'est simulée comme un job durable.

## Capacités

- chat multi-cerveaux avec fallback
- recherche Web et actualités
- météo géolocalisée
- MLB / NBA
- finance / crypto
- Wikipédia
- génération d'images
- vision
- agent vocal
- mémoire conversationnelle
- base de connaissances épisodique
- authentification email/mot de passe
- OAuth Google optionnel
- média vidéo via fournisseur externe optionnel

## Architecture

- `index.html` — interface
- `assets/` — JS/CSS frontend
- `api/ai.mjs` — orchestrateur agent
- `api/_lib.mjs` — outils, cerveaux, sessions
- `api/_storage.mjs` — persistance serverless
- `api/_knowledge.mjs` — mémoire et connaissances
- `api/auth/` — authentification
- `api/vision.mjs` — vision
- `api/voice.mjs` — voix
- `api/media.mjs` — média

## Installation

```bash
npm install
npm test
```

## Vercel

Lire `VERCEL_DEPLOY.md` avant le premier déploiement.

Variables indispensables en production :

- `GUED_SESSION_SECRET`
- `BLOB_READ_WRITE_TOKEN`

Au moins un fournisseur IA est recommandé : `GEMINI_API_KEY`, `NVIDIA_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY` ou `HF_TOKEN`.

## Sécurité

Les sessions utilisent un cookie `HttpOnly` en production. Aucun token de session n'est stocké dans `localStorage`. Les fonctions sensibles exigent une session en production. Les secrets ne doivent jamais être placés dans le frontend.

## Limites assumées

La recherche, les modèles IA, l'image et la vidéo dépendent de services externes et peuvent être indisponibles. Un fallback est utilisé lorsqu'il est possible, mais GSAM228 ne prétend pas qu'un service est disponible lorsqu'il ne l'est pas.

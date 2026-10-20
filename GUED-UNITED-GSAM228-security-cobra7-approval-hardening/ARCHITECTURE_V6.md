# GSAM228 v6 — architecture renforcée

## Principes

1. Serverless-first: aucune donnée critique ne dépend d'une instance Vercel.
2. Fail-closed pour l'authentification en production.
3. Fallback honnête: ne jamais annoncer une vidéo ou une mémoire persistante qui n'existe pas.
4. Les secrets restent côté serveur.
5. Les intégrations externes sont traitées comme non fiables et peuvent tomber en panne.

## Couches

- UI: `index.html`, `assets/app.js`, `assets/styles.css`
- Agent: `api/ai.mjs`
- Cerveaux et outils: `api/_lib.mjs`
- Mémoire/connaissance: `api/_knowledge.mjs`
- Persistance: `api/_storage.mjs`
- Auth: `api/auth/*`
- Vision: `api/vision.mjs`
- Voix: `api/voice.mjs`
- Média: `api/media.mjs`

## Limites connues

- La génération vidéo dépend d'un fournisseur externe optionnel.
- La recherche Web dépend de fournisseurs externes.
- Pour une charge importante, le rate limiting doit être déplacé vers Redis/Upstash ou un équivalent distribué.
- Pour une base de comptes très volumineuse, remplacer le stockage Blob JSON par PostgreSQL.
- Aucun exécuteur de code arbitraire n'est activé: c'est volontaire pour éviter une surface RCE dangereuse.

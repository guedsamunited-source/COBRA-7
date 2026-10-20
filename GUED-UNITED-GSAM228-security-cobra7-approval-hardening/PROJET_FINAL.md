# GUED-UNITED — GSAM228 v6 — audit, correction et durcissement

## Corrections majeures

1. Authentification email/mot de passe migrée de GET vers POST.
2. Sessions déplacées vers cookie HttpOnly/Secure en production : plus de token d'auth dans `localStorage`.
3. `GUED_SESSION_SECRET` obligatoire en production.
4. Comptes et mémoire branchés sur un adaptateur de persistance Vercel Blob lorsqu'il est configuré.
5. OAuth Google PKCE rendu stateless : le verifier n'est plus conservé dans une `Map()` d'instance.
6. Jobs vidéo en mémoire supprimés : aucun endpoint ne promet désormais qu'une `Map()` survivra à un changement d'instance Vercel.
7. Génération vidéo rendue honnête : fournisseur réel optionnel, sinon poster cinématique explicite.
8. Fallback météo corrigé : géocodage de la ville avant Open-Meteo, plus aucun fallback arbitraire vers Paris.
9. Validation des clés IA simplifiée : une clé configurée est marquée disponible ; le vrai appel décide ensuite de sa validité, évitant des appels de santé inutiles.
10. Tests E2E restructurés : les intégrations Internet sont séparées des tests locaux et une panne DNS externe ne transforme plus un environnement sans réseau en faux bug applicatif.
11. Artifacts Android `build/` et `.gradle/` supprimés de la distribution.
12. `package-lock.json` supprimé car la reconstruction ajoute `@vercel/blob`; Vercel/GitHub doit utiliser `npm install` plutôt que `npm ci` sans lockfile.
13. Headers CSP, HSTS, Permissions-Policy, X-Frame-Options, nosniff et Referrer-Policy renforcés.
14. Aucune exécution shell arbitraire détectée dans les fichiers applicatifs.
15. Documentation Vercel et architecture ajoutées.

## Validation effectuée

`npm test` : **12 tests réussis, 0 échec, 1 intégration externe ignorée** au moment de l'audit. L'intégration Wikipédia a été ignorée parce que l'environnement d'audit ne pouvait pas joindre ce service ; ce n'est pas considéré comme un échec du code local.

## Malware / virus

Une analyse statique ciblée des fichiers applicatifs n'a trouvé aucun `eval`, `new Function`, `child_process`, `spawn`, commande shell ou URL `javascript:` suspecte. Cette analyse ne constitue pas une certification antivirus absolue.

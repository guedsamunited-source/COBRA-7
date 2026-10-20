# Déployer Q-G / COBRA-7 sur Vercel

## Configuration du projet

Pour déployer **l'API Python Q-G seule** depuis le dépôt `GUED-UNITED-GSAM228` :

- **Root Directory** : `Q-G` (cocher l'option d'inclusion des fichiers hors du dossier racine uniquement si Vercel la demande et si le build en a réellement besoin).
- **Framework Preset** : FastAPI si proposé, sinon Other / détection automatique.
- **Build Command** : laisser vide.
- **Output Directory** : laisser vide.
- **Install Command** : laisser la détection automatique.
- **Entrypoint FastAPI** : défini dans `pyproject.toml` comme `qg.vercel_app:app`.

Ne sélectionne pas `qg/main.py` comme un fichier à téléverser isolément. Le déploiement a besoin de tout le dossier `Q-G`, y compris `qg/`, `requirements.txt` et `pyproject.toml`.

## Variables d'environnement

Configurer au minimum `COBRA7_AGENT_KEY` comme secret aléatoire long. Pour autoriser les approbations, définir une valeur différente et indépendante pour `COBRA7_APPROVAL_KEY`. Les autres intégrations (GUED-LLM, recherche, API, voix) doivent être configurées uniquement si elles sont utilisées.

Laisser les fonctions facultatives désactivées tant que leurs variables ne sont pas correctement configurées. Ne jamais mettre de clés réelles dans Git ou dans ce fichier.

## Limites importantes de l'environnement serverless

Le point d'entrée Vercel redirige par défaut SQLite et le bac à fichiers vers `/tmp`, car le dossier de déploiement n'est pas un stockage persistant. Les données sous `/tmp` peuvent disparaître entre les instances et les redémarrages. Pour conserver durablement RAG, tâches, fichiers et journaux, connecter une base de données / un stockage externe avant un usage de production. Le worker de tâches en arrière-plan n'est pas garanti en environnement serverless.

## Vérification après déploiement Preview

1. Ouvrir `/health` et vérifier que la réponse JSON indique `status: ok`.
2. Vérifier que `/docs` est désactivé par conception ; les routes protégées nécessitent `X-COBRA7-KEY`.
3. Tester les routes authentifiées avec une clé de test stockée dans les variables Vercel.
4. Vérifier les logs d'exécution avant de promouvoir une version.

Le succès du build ne prouve pas à lui seul que les intégrations GUED-LLM, RAG, tâches, API ou voix sont opérationnelles.

# Tests automatisés

Après `pnpm install` et `pnpm exec playwright install chromium` (une fois), avec Node 24, Python 3 et Docker démarré :

```sh
pnpm test
```

C’est la vérification de référence, identique en local et dans GitHub Actions.
Elle échoue dès qu’un contrôle échoue, affiche l’étape et les derniers logs,
puis nettoie ses ressources. Aucune configuration de test ni clé externe à fournir.
Le premier lancement peut télécharger PostgreSQL et compiler Next.js.

## Ce que vérifie la commande

| Niveau | Contrôles |
| --- | --- |
| Domaine | Montants, transitions et valeurs des commandes, références |
| Application | Commande et paiement complets en mémoire, idempotence, notifications et rollback |
| Architecture | Imports du domaine et des cas d’usage vers l’intérieur ; routes sans accès direct à l’ORM/Stripe |
| React, sans navigateur | Suivi de commande, paiement simulé et nouvelle tentative, lien privé, suggestions d’adresses |
| PostgreSQL réel | Migrations (base vide migrée identique au schéma attendu, aucune migration en attente), premier compte, deux administrateurs, permissions, traductions, médias, transactions concurrentes, commandes admin et outbox |
| HTTP réel | Pages FR/EN et admin sur build de production ; pages légales, 404, `robots.txt`, en-têtes ; accès signé, suivi et paiement simulé d’une commande de démonstration sur serveur local ; protection des fichiers privés et des cookies |
| Navigateur (Chromium, Playwright) | Audit axe WCAG 2.1 AA de l’accueil, de l’accès et du suivi de commande, des pages légales et de la 404 en FR/EN ; absence de débordement à 390 px ; parcours : lien privé, paiement simulé, suivi payé, administration de la commande. Les suggestions d’adresse sont interceptées, aucun service externe n’est appelé |
| Performance (Lighthouse, Chromium) | Budget des pages clés (`/fr`, `/fr/mentions-legales`) sur le build de production, voir ci-dessous |
| Qualité | Génération Payload, TypeScript, ESLint, build sans base disponible et tests unitaires des scripts de déploiement |

Les composants sont montés avec React Testing Library et jsdom, à partir du
moteur `node:test` déjà utilisé. Les assertions portent sur leurs comportements
visibles et les échanges HTTP attendus.

## Budget de performance

```sh
pnpm test --group=performance
```

Lighthouse (`lighthouse`, version exacte dans `package.json`) mesure les pages clés sur le
build de production servi par `next start`, avec le Chromium de Playwright, dans son émulation
mobile par défaut (Moto G Power, 4G lente simulée). Chaque page est mesurée trois fois et la
médiane est comparée au budget de `tests/support/performance-budget.ts` :

| Mesure | Budget |
| --- | --- |
| Performance | ≥ 90 |
| Accessibilité, bonnes pratiques | ≥ 95 |
| SEO | ≥ 90 |
| Largest Contentful Paint | ≤ 2,5 s |
| Cumulative Layout Shift | ≤ 0,1 |
| Poids total de la page | ≤ 1 500 ko |

Le site est mesuré tel qu’il sera une fois ouvert : maintenance décochée
(`tests/performance.setup.ts`), indexation activée (`PUBLIC_INDEXING=true`), contenus de
démonstration (`src/scripts/seed.ts`). Une page hors budget fait échouer le groupe ; la table des
médianes s’affiche dans le terminal, dans le résumé du job CI `lighthouse` (`performance.yml`, chaque
nuit si `main` a changé, ou lancé à la main depuis l'onglet Actions ; jamais à chaque push), et les
audits qui coûtent des points sont listés. Ne pas baisser le budget pour faire passer une page :
corriger la cause, ou ajouter une exception motivée (`exceptions` dans la liste des pages).
`PERFORMANCE_RUNS=1` accélère une mesure exploratoire. Les pages mesurées se règlent dans la
même liste ; chaque page ajoute environ 20 s.

## Isolation et nettoyage

Le lanceur `tests/run.mjs` crée un conteneur PostgreSQL éphémère, sans volume
persistant, sur un port aléatoire lié uniquement à `127.0.0.1`. Il applique les
migrations puis utilise des bases distinctes pour chaque scénario. Les mots de
passe sont aléatoires, les données fictives, les fichiers dans un dossier temporaire.
Il remplace la connexion BDD et désactive les fournisseurs externes et jobs automatiques.

Les serveurs Next utilisent leurs propres ports, cache et configuration TypeScript
temporaires. Le serveur de développement habituel et sa base ne sont pas utilisés.
La simulation de paiement reste interdite en production : le test HTTP de paiement
utilise donc un serveur de développement isolé, tandis que le rendu public est
vérifié sur le build de production.

Le nettoyage s’exécute aussi après un échec ou Ctrl+C : arrêt des processus créés,
suppression du seul conteneur créé et des fichiers temporaires. En cas d’arrêt forcé
du système, un conteneur `<slug>-tests-*` (slug de `site.config.json`) peut rester : le retirer par son nom exact.
Ne jamais utiliser un nettoyage global Docker.

## Boucle rapide et CI

```sh
pnpm test:unit
```

Cette variante ne nécessite ni Docker ni serveur. Elle couvre domaine, application,
adaptateurs ciblés, architecture et composants React. Elle sert pendant le travail ;
`pnpm test` valide le changement complet.

La CI lance `pnpm test`, vérifie que les fichiers générés sont à jour et conserve
son job séparé de validation de l’image Docker, du déploiement et de la persistance.
Un changement applicatif validé par cette suite ne demande pas de nouvelle série
de contrôles manuels sans risque précis identifié.

## Différé

Les tests navigateur (rendu visuel, responsive et compatibilité), le paiement sur
le véritable compte sandbox Stripe, les emails réels et la restauration d’une
sauvegarde restent des vérifications distinctes. La suite ne dépend d’aucun de
ces services. Le test de chiffrement des sauvegardes est ignoré si GPG n’est pas
installé localement ; il est exécuté sur le runner CI équipé de GPG.

Les suggestions d’adresses sont couvertes sans réseau externe : réponses IGN et
Photon simulées, filtrage par pays, cache et fréquence, protection HTTP, frappe
temporisée, sélection remplissant les trois champs, modification manuelle,
indisponibilité du fournisseur et réponse obsolète ignorée. Les tests utilisent
les vrais composants shadcn/Base UI, sans simuler le Combobox.

# Validation obligatoire avant commit et push

- Ne jamais créer de commit sans validation explicite de l’utilisateur pour cette action.
- Ne jamais pousser vers un dépôt distant sans validation explicite de l’utilisateur pour cette action.
- Une demande d’implémentation, un « go » ou une autorisation générale de travailler ne vaut pas autorisation de committer ou de pousser.
- Préparer les modifications et les vérifications, puis demander la validation avant tout commit ou push. Une validation de commit ne vaut pas validation de push.
- Cette règle s’applique à tous les agents travaillant sur ce dépôt, sans exception.

# Tests pendant le travail : la boucle rapide

- Pendant le développement, lancer seulement `pnpm test:unit` et les groupes concernés par la modification (`pnpm test --group=<groupe>`, voir `TESTING.md`) : environ une minute.
- La suite complète `pnpm test` ne tourne qu'une fois, juste avant de demander l'autorisation de committer ou de pousser, et pas après chaque correction.
- Le budget Lighthouse (`--group=performance`) n'est lancé en local que si la modification touche l'apparence ou le poids des pages ; le CI le mesure chaque nuit (`performance.yml`).

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Infrastructure de production : uniquement par CI

- Ne jamais modifier manuellement le VPS, ses fichiers, conteneurs, volumes, réseaux ou services, même pour un test.
- Toute configuration et toute opération de déploiement sur le VPS doivent être définies dans ce dépôt et exécutées par GitHub Actions.
- Exception explicite : le DNS est géré manuellement par l’utilisateur chez son fournisseur. Aucun jeton API DNS ni modification automatique de zone dans la CI.
- Effectuer les tests en local ou en CI ; les éventuels audits du VPS restent strictement en lecture seule.
- Préserver les services existants (les autres sites du VPS) et les données persistantes. Ne jamais supprimer les volumes de production dans un script de déploiement.
- L’autorisation de développer une étape ne vaut pas autorisation de commit, de push ou de lancer un déploiement.

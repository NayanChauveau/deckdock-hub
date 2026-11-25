# Types et lint

La commande de validation reste **`pnpm test`**, en local comme en CI.
Elle inclut TypeScript et ESLint ; aucune étape manuelle supplémentaire.
`pnpm lint:fix` applique les corrections automatiques pendant le développement.

## TypeScript

`strict` active notamment les contrôles de nullabilité, paramètres, fonctions et
variables non typées. Le projet ajoute :

- `noUncheckedIndexedAccess` : un accès à un tableau ou dictionnaire peut être absent ;
- `exactOptionalPropertyTypes` : omettre une propriété diffère de lui donner `undefined` ;
- `noPropertyAccessFromIndexSignature` : les propriétés connues et les clés dynamiques restent distinctes ;
- `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noImplicitOverride` ;
- `noUnusedLocals`, `noUnusedParameters`, `forceConsistentCasingInFileNames` ;
- `verbatimModuleSyntax` : les dépendances de types utilisent `import type`.

Les tests suivent le même tsconfig que le code applicatif. Les types générés Payload
restent contrôlés par TypeScript et sont régénérés dans la suite. `skipLibCheck`
conserve le contrôle sur notre code tout en évitant de revérifier les déclarations
internes des dépendances. `allowJs` permet notamment les fichiers d’intégration
Next/Payload en JavaScript ; les règles avec analyse des types portent sur TS/TSX.

## ESLint

Les presets Next (Core Web Vitals et TypeScript) sont complétés par
`strictTypeChecked` et `stylisticTypeChecked` de typescript-eslint. La version de
ce dernier est fixée exactement, car ces presets peuvent évoluer hors version majeure.
Le service de projet lit le même tsconfig que TypeScript et l’éditeur.

Les règles interdisent notamment `any` explicite et ses usages non sûrs, les promesses
non traitées, les assertions de présence `!`, les conversions inutiles et les fonctions
asynchrones inutiles. Les imports/exports de types sont explicites, les `switch` sur
unions doivent être exhaustifs. **Zéro avertissement toléré**, y compris les directives
ESLint de désactivation devenues inutiles.

Exceptions ciblées :

- les fichiers générés (`payload-types.ts`, import map et `next-env.d.ts`) et les caches
  ne sont pas lintés ; les migrations restent lintées et compilées ;
- les doubles de test peuvent être `async` sans `await`, pour respecter les ports
  asynchrones en mémoire ; les autres règles restent actives dans les tests ;
- les nombres sont autorisés dans les interpolations, sans autoriser les objets ou
  valeurs absentes ;
- `||` reste autorisé pour les chaînes : un texte éditorial vide ou une variable
  d’environnement vide doit parfois déclencher sa valeur de repli. Les nombres et
  objets utilisent `??` quand l’absence est le critère.

## Aux frontières

Une réponse JSON est `unknown` avant validation par les schémas Zod de
`src/modules/*/contracts.ts` (par exemple `src/modules/orders/contracts.ts`). Le type d’une réponse est déduit de son schéma, sans deuxième
définition manuelle. Les hooks de collections utilisent les types générés correspondants
plutôt que le type générique implicite `any` de Payload.

Dans le domaine et les cas d’usage, conserver l’inférence quand elle est précise,
utiliser des unions pour les états et valider les invariants aux points d’entrée.
Ne pas contourner une erreur avec `as any`, `!`, `@ts-ignore` ou en affaiblissant le
contrat d’un port. Dans les tests, une donnée obligatoire s’obtient par une assertion
réelle (`assert.ok` ou le helper `present`) afin qu’une fixture absente fasse échouer
le test à cet endroit.

Références : [presets typescript-eslint](https://typescript-eslint.io/users/configs/),
[options TypeScript](https://www.typescriptlang.org/tsconfig/),
[propriétés optionnelles exactes](https://www.typescriptlang.org/tsconfig/exactOptionalPropertyTypes.html).

## Mise en forme avec Prettier

Prettier est intégré à ESLint via `eslint-plugin-prettier/recommended`, placé en
fin de configuration. `prettier/prettier` signale les écarts comme des **erreurs** ;
`eslint-config-prettier` désactive les règles de style qui entreraient en conflit.
Les contrôles de types, de promesses, de sécurité des types et de structure des
imports restent actifs.

La configuration partagée est `.prettierrc.json` : cible de 100 colonnes,
indentation de deux espaces, quotes simples, pas de points-virgules superflus et
fins de ligne LF. Prettier répartit les objets, appels et JSX sur plusieurs lignes.
`printWidth` est une cible de présentation, pas une limite absolue : une URL, une
expression régulière ou une chaîne indivisible peut dépasser cette largeur.

- `pnpm format` : reformater le code et les configurations pris en charge.
- `pnpm format:check` : vérifier sans modifier les fichiers.
- `pnpm lint` : inclut les erreurs Prettier sur les fichiers JS/TS lintés.
- `pnpm lint:fix` : corriger les écarts ESLint et Prettier corrigeables.
- `pnpm test` : conserve tous les contrôles existants et ajoute `format:check` ;
  la CI utilise cette même commande.

`.prettierignore` exclut les fichiers générés (types Payload, import map, snapshots
JSON de migrations, lockfile), les dépendances, les secrets, les médias et les
sorties de build/test. Les migrations TypeScript restent vérifiées. Les documents
Markdown et les ressources publiques sont laissés intacts.

**Installation en deux temps le 8 novembre 2026 :** configuration et commandes
préparées d’abord sans toucher au code, puis formatage global appliqué après la
validation explicite de Nayan. Les nouveaux contrôles de mise en forme sont actifs
sur le code et les configurations, en local comme en CI.

### Formatage à l’enregistrement

`.vscode/settings.json` active Prettier à chaque sauvegarde pour JS/TS/JSX/TSX,
JSON/JSONC, CSS et YAML, dans VS Code et les éditeurs compatibles comme Cursor.
Chaque langage dispose de son propre bloc de configuration. Le fichier entier
est formaté avec la version locale et `.prettierrc.json` ; `.prettierignore` reste
respecté. Les autres langages conservent leur configuration d’éditeur.

L’extension `esbenp.prettier-vscode` est nécessaire. Elle est recommandée avec
ESLint dans `.vscode/extensions.json`. L’ajout de ces réglages ne lance aucun
formatage global : seuls les fichiers enregistrés seront reformatés par l’éditeur.

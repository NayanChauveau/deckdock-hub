# Design system

Le site public utilise **shadcn/ui**, Tailwind CSS 4 et React 19, avec le preset
`radix-nova` et les primitives Radix. Les composants sont copiés depuis le registre
avec la CLI officielle, puis versionnés dans le projet. Ils restent adaptables et
soumis aux mêmes règles TypeScript/ESLint que le reste du code.

## Organisation

```text
components.json                  configuration du registre et des chemins
src/styles/
  globals.css                    point d’entrée, imports et sources Tailwind
  theme.css                      tokens sémantiques et correspondances Tailwind
  base.css                       styles HTML de base, focus et mouvement réduit
  site.css                       mise en page éditoriale existante
  commerce.css                   mise en page du parcours de commande
src/core/ui/                     primitives shadcn, sans logique métier (socle)
  utils.ts                       point d’entrée partagé de cn
  forms/TextField.tsx            label, champ, aide et erreur accessibles
  feedback/Notice.tsx            information ou erreur, rôles status/alert
src/core/admin/components/       extensions du thème natif Payload (socle)
src/modules/<module>/ui/         interface d’un module (commande, adresses…)
src/modules/<module>/admin/      composants d’administration d’un module
```

Les styles publics sont importés uniquement dans le layout public localisé.
L’admin Payload conserve son thème et ses contrôles natifs ; ses styles ne sont
pas remplacés par le reset ou les tokens du site public.

## Ajouter un composant : toujours par la CLI

Installation effectuée pour cette passe :

```sh
pnpm dlx shadcn@latest init --preset nova --base radix --yes --no-monorepo --no-reinstall --no-rtl
pnpm exec shadcn add button input label native-select field alert card --yes
```

Le registre a aussi installé `separator`, dépendance de `field`. La CLI est
maintenant verrouillée à `4.22.1`, dans les dépendances de développement.
Pour les prochains composants :

```sh
pnpm ui:add button
pnpm ui:add dialog
pnpm ui:add select
```

Installer seulement les composants nécessaires. Si le fichier existe déjà,
examiner les modifications proposées ; ne pas utiliser `--overwrite` sans revue.
Ne pas recréer à la main une copie d’un composant disponible dans le registre.
Conserver le diff et les adaptations locales lors d’une mise à jour.

Les sources téléchargées ont reçu les corrections demandées par notre lint strict
(imports de types et égalité stricte), utilisent `@/lib/utils` pour `cn`, et des
hauteurs adaptées aux formulaires : Input/SelectTrigger 44 px, Button 40 px par défaut
et 44 px en `lg`. Leurs variantes restent définies dans leurs recettes `cva`.

## Tokens et styles

Les couleurs se définissent dans `theme.css`, avec des rôles : `background`,
`foreground`, `primary`, `secondary`, `muted`, `destructive`, `border`, `input`,
`ring`. `brand` conserve l’accent éditorial et les tokens `art-*` concernent
uniquement le visuel de présentation existant.

Les polices, rayons et ombres sont également centralisés. Les espacements des
primitives utilisent l’échelle Tailwind ; les dimensions et grilles propres aux
pages restent dans leurs fichiers de mise en page. Le thème public est **clair** ;
aucun sélecteur ni promesse de mode sombre n’est ajouté.

Utiliser les classes sémantiques (`bg-primary`, `text-muted-foreground`,
`border-input`, etc.) plutôt que des couleurs recopiées dans les pages. Les styles
de pages vivent dans `@layer components` pour que les utilitaires et variantes
puissent les surcharger sans une course à la spécificité. Les anciens styles
qui redessinaient tous les `input`, `select` et boutons ont été supprimés.

## Compositions

Un lien reste un lien, même avec l’apparence d’un bouton :

```tsx
<Button asChild size="lg">
  <Link href="/fr/commande">Commander</Link>
</Button>
```

Une action indique explicitement son type (`button` ou `submit`). Réutiliser
`TextField` pour les champs avec libellé ; fournir un identifiant unique, le nom
natif du champ et les contraintes HTML. Il associe les textes d’aide et d’erreur
via `aria-describedby`, et transmet `aria-invalid`, `required`, `disabled` et les refs.
Les champs de Checkout utilisent `useId` pour éviter les doublons d’identifiants.

Les menus format/pays utilisent désormais le `Select` Radix du registre, téléchargé
avec `pnpm ui:add select --yes` : menu personnalisé, navigation clavier et contrôle
natif masqué pour la sérialisation FormData. Les déclencheurs et options ont un curseur
pointer, un survol et un focus visibles. Le bouton de fichier utilise également
un fond et un curseur explicites ; les contrôles désactivés gardent leur état dédié. Les groupes
utilisent `FieldSet`/`FieldLegend`. Les messages passent par `Notice` ; les erreurs
ne sont pas distinguées uniquement par la couleur.

Éviter les wrappers qui ne font que renommer un composant. Créer une composition
lorsqu’elle porte une règle réutilisable, comme l’association label/aide/erreur.
Le format monétaire, les requêtes réseau et les règles de commande restent dans
les composants métier ou leurs couches dédiées.

## Garde-fous et validation

ESLint empêche les contrôles bruts (`button`, `input`, `select`, `label`, `textarea`)
dans les pages et composants publics concernés, et réserve les imports directs
de Radix/CVA aux primitives. Les composants UI, formulaires et messages ne doivent
pas importer le domaine, les collections, Payload ni Stripe.

```sh
pnpm test
```

La suite couvre les états désactivés, les liens de bouton, les associations
accessibles, les erreurs, les fusions de classes, le parcours client FR/EN, les
échanges HTTP et le build Tailwind/Next réel. Les primitives sont lintées, sans
exclusion des fichiers téléchargés. Les contrôles visuels et les tests navigateur
restent différés, conformément à la stratégie de tests du projet.

Références officielles : [installation Next.js](https://ui.shadcn.com/docs/installation/next),
[CLI](https://ui.shadcn.com/docs/cli), [Tailwind v4](https://ui.shadcn.com/docs/tailwind-v4).

## Validation des formulaires

Le configurateur de commande utilise React Hook Form et `@hookform/resolvers/zod`.
Les règles d’interface sont dans `src/modules/commerce/ui/checkout-schema.ts`, avec un
type déduit du schéma et des messages traduits. Le domaine garde ses propres
validations indépendantes de Zod ; les contrôles client ne remplacent pas ceux du serveur.

- Les champs texte utilisent `register` avec le `TextField` partagé et sa ref.
- Les Select shadcn et le champ fichier utilisent `Controller`.
- Le formulaire porte `noValidate` et désactive la validation native de RHF : aucune
  bulle HTML ; les attributs `required` restent présents pour la sémantique.
- Validation au premier blur, puis pendant la correction ; après soumission, les
  erreurs sont affichées sous les champs et le premier champ invalide reçoit le focus
  dans l’ordre visuel (les champs `Controller` et `register` ne se montent pas dans cet ordre).
- Le code postal dépend du pays et est revalidé au changement de celui-ci.
- Les erreurs serveur identifiables sont rattachées aux champs ; indisponibilité,
  quota et changement de devis utilisent le message global. La saisie est conservée.
- Le multipart est construit à partir des valeurs validées, avec le fichier choisi.
  La protection contre les doubles soumissions et le contrôle du devis sont conservés.

### Adresse avec suggestions

`pnpm ui:add combobox --yes` a installé le Combobox officiel et ses dépendances
`input-group` et `textarea`. Le registre shadcn utilise ici Base UI, même avec le
preset Radix ; cet import reste limité à `src/core/ui`. Les composants Button
et Input déjà adaptés n’ont pas été écrasés. `addresses/ui/AddressField` compose ces
primitives avec le chargement des suggestions, les messages FR/EN et les erreurs
du formulaire. La navigation clavier et les rôles ARIA sont fournis par Combobox.

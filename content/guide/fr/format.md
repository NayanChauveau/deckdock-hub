# Le format en détail

Cette page décrit les fichiers d’un deck créé depuis le [modèle](https://github.com/NayanChauveau/deckdock-template) : `deckdock.yaml`, les notes, les médias, puis ce qui se passe à chaque version. La référence technique complète est la [spécification deckdock/1](https://github.com/NayanChauveau/deckdock/blob/main/spec/deckdock-1.md).

## Le fichier deckdock.yaml

C’est la carte d’identité du deck, à la racine du dépôt.

```yaml
id: capitales-europe
name:
  fr: Capitales d’Europe
  en: European capitals
icon: 🏛️
description:
  fr: Les capitales des pays d’Europe, avec leur carte.
  en: The capitals of European countries, with their map.
editions: [fr, en]
license: CC-BY-4.0
homepage: https://github.com/votre-nom/deck-capitales
options:
  new_per_day: 20
  reviews_per_day: 200
```

| Clé | Obligatoire | Rôle |
| --- | --- | --- |
| `id` | oui | L’identifiant du deck : lettres minuscules, chiffres et tirets simples (`capitales-europe`). C’est aussi l’identifiant à donner en créant le deck sur ce site. **Définitif une fois publié.** |
| `name` | oui | Le nom du deck : un seul texte, ou un texte par édition (`fr:`, `en:`…), qui doit alors couvrir toutes les éditions. |
| `editions` | oui | La liste des éditions publiées, par exemple `[fr, en]`. **Définitive une fois publiée.** |
| `description` | non | Un court texte (Markdown), affiché sur la page du deck. Un seul texte, ou un par édition. |
| `icon` | non | Un seul emoji, affiché à côté du deck dans le catalogue et sur sa page. Un drapeau ou un emoji composé compte pour un. Sans icône, le site affiche l’initiale du nom. |
| `license` | non | La licence du contenu, par exemple `CC-BY-4.0` ou `CC0-1.0`. Affichée sur la page du deck. |
| `homepage` | non | L’adresse de la source du deck. Si vous ne l’écrivez pas, la CI de GitHub met l’adresse de votre dépôt. Le site l’affiche comme lien **Source** sur la page du deck, si elle commence par `https://`. |
| `options` | non | Les réglages d’étude proposés : `new_per_day` (nouvelles notes par jour) et `reviews_per_day` (révisions par jour), des nombres entiers. |

> **Note**
> Les dépôts créés avec une ancienne version du modèle n’ont rien à changer : `icon` et `homepage` sont facultatifs.

## Les éditions

Une édition est une version du deck dans une langue (ou une variante) : chacune a sa propre adresse, que l’apprenant colle dans Anki, et ses propres versions. Dans le modèle, le code d’édition est un **code de langue** : `fr`, `en`, `pt-br`… L’édition `fr` est compilée dans `dist/fr/deck.json`.

Le texte d’une note s’écrit soit directement sur la note (le même dans toutes les éditions), soit dans un bloc par édition (`fr:`, `en:`). Une note sans bloc pour une édition est absente de cette édition.

## Les types de notes

Chaque note a un `id` (unique dans tout le deck, **définitif une fois publié**) et un `type`. Clés facultatives communes : `deck` (un sous-deck, comme `Europe::Ouest`), `tags` (une liste d’étiquettes) et `status` (`draft` pour un brouillon, laissé hors du deck).

**`basic`** : une question, une réponse.

```yaml
- id: capitale-australie
  type: basic
  tags: [oceanie]
  front: Quelle est la capitale de l’Australie ?
  back: Canberra
```

**`reversed`** : comme `basic`, mais Anki crée aussi la carte dans l’autre sens.

```yaml
- id: canberra
  type: reversed
  front: Canberra
  back: Capitale de l’Australie
```

**`cloze`** : un texte à trous. Chaque `{{c1::…}}` est un trou ; les numéros (`c1`, `c2`…) regroupent les trous en cartes. `extra` est affiché au verso.

```yaml
- id: mitochondrie
  type: cloze
  text: "Les {{c1::mitochondries}} produisent l’essentiel de l’{{c2::ATP}} de la cellule."
  extra: "Source : cours de biologie, semaine 3."
```

**`mcq`** : un choix multiple, avec au moins deux choix dont exactement un correct. `explanation` est affiché au verso.

```yaml
- id: fleuve-paris
  type: mcq
  question: Quel fleuve traverse Paris ?
  choices:
    - {text: Seine, correct: true}
    - {text: Loire}
    - {text: Rhône}
  explanation: La Loire et le Rhône sont d’autres grands fleuves français.
```

Les textes acceptent le Markdown : `**gras**`, `*italique*`, listes, liens.

## Les médias

Les images et les sons vont dans le dossier `media/` du dépôt et s’utilisent avec le chemin `media/<nom>` :

```markdown
![Carte de l’Australie](media/australie.png)
```

- Aucun autre emplacement n’est accepté : uniquement `media/<nom>`.
- Décrivez l’image dans le texte entre crochets : c’est ce que lisent ceux qui ne la voient pas.
- Limites : 10 Mio par fichier, 500 Mio de médias par édition, et 50 000 notes par édition.

## Les versions

Chaque publication crée une **version** de chaque édition. La CI du modèle lui donne pour nom la date et l’heure du commit (en temps universel) suivies de son identifiant court, par exemple `2026-11-26T10:00:00Z+a1b2c3d`.

- Le site range les versions dans leur ordre d’arrivée : la dernière reçue est celle que reçoivent les apprenants.
- Relancer la CI sur le même commit renvoie la même version avec les mêmes fichiers : le site répond `already_published`, rien ne change.
- Une même version avec des fichiers différents est refusée : faites un nouveau commit, qui donnera une nouvelle version.
- Un deck compilé sur votre ordinateur sans version porte la version `"dev"`, que le site refuse : publiez depuis la CI, ou donnez une version (voir [Publier sans GitHub](/fr/guide/publier-sans-github)).

## Ce qui casse la compatibilité

Les apprenants ont déjà vos notes et leurs types dans leur collection Anki, avec leur progression. Certaines modifications passent sans souci, d’autres non :

| Modification | Effet chez les apprenants |
| --- | --- |
| Texte des notes, étiquettes, ajout ou retrait de notes, mise en page et style des cartes | Appliqué normalement, progression conservée. |
| Ajout d’un champ **à la fin** d’un type de note | Accepté avec un avertissement : les apprenants devront faire une synchronisation complète avec AnkiWeb. À éviter si possible. |
| Retrait, renommage ou réordonnancement des champs, ajout ou retrait d’une face, passage de `basic` à `cloze` | **Refusé** par le site, pour protéger les apprenants. Créez plutôt un nouveau type de note pour les nouvelles notes. |
| Changement de l’`id` du deck, d’un code d’édition ou de l’`id` d’une note | À ne jamais faire : Anki y verrait de nouvelles notes, et les apprenants perdraient la progression des anciennes. |

> **Attention**
> Ne renommez jamais un `id` déjà publié, même pour corriger une faute de frappe. Pour retirer une note, supprimez-la ; pour la remplacer, créez-en une nouvelle avec un nouvel `id`.

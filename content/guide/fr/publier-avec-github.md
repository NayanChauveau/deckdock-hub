# Publier avec GitHub

Ce guide vous emmène de zéro à un deck en ligne, sans rien installer sur votre ordinateur et sans savoir coder. Comptez une demi-heure la première fois. Il vous faut une adresse e-mail et un navigateur.

## 1. GitHub, en deux mots

[GitHub](https://github.com) est un site gratuit qui héberge des projets sous forme de dossiers de fichiers, appelés **dépôts**. Pour un deck, il apporte trois choses :

- il **garde l’historique** de chaque modification (qui a changé quoi, et quand) ;
- il permet à d’autres de **proposer des corrections** ;
- il sait **lancer des tâches automatiques** à chaque modification, dans un onglet appelé **Actions**. C’est ce qui vérifie votre deck et l’envoie sur ce site.

Un peu de vocabulaire, que vous croiserez sur GitHub :

| Mot | Ce que c’est |
| --- | --- |
| Dépôt (*repository*) | Le dossier en ligne qui contient votre deck. |
| Commit | Une modification enregistrée, avec un petit message qui la décrit. |
| `main` | La version principale du dépôt. Chaque commit sur `main` publie une nouvelle version du deck. |
| Workflow | La liste des tâches automatiques lancées à chaque commit. |

## 2. Créer un compte GitHub

1. Ouvrez [github.com/signup](https://github.com/signup).
2. Saisissez votre adresse e-mail, un mot de passe et un nom d’utilisateur, puis suivez les étapes (GitHub envoie un code par e-mail pour vérifier l’adresse).
3. Choisissez l’offre gratuite (*Free*) si on vous le demande : elle suffit largement.

## 3. Créer votre deck à partir du modèle

Plutôt que de partir d’une page blanche, vous copiez un modèle (*template*) qui contient déjà tout le nécessaire : la structure des fichiers, des notes d’exemple et la vérification automatique.

1. Ouvrez le modèle : [github.com/NayanChauveau/deckdock-template](https://github.com/NayanChauveau/deckdock-template).
2. Cliquez sur le bouton vert **Use this template**, puis sur **Create a new repository**.
3. Donnez un nom à votre dépôt, par exemple `deck-capitales`. Laissez-le **Public** : tout le monde pourra lire votre deck et proposer des corrections.
4. Cliquez sur **Create repository**.

<!-- capture: le bouton vert « Use this template » sur la page du modèle, menu ouvert sur « Create a new repository » -->

Vous avez maintenant votre propre dépôt, avec ces dossiers et fichiers :

| Élément | Rôle |
| --- | --- |
| `deckdock.yaml` | La carte d’identité du deck : identifiant, nom, description, icône, éditions. |
| `cards/` | Vos notes, dans un ou plusieurs fichiers. |
| `media/` | Les images et les sons utilisés par vos notes. |
| Le reste | Les outils qui fabriquent et vérifient le deck. Vous n’avez pas à y toucher. |

## 4. Modifier un fichier sur le site de GitHub

Tout se modifie directement dans le navigateur :

1. Dans votre dépôt, cliquez sur le fichier à modifier (par exemple `deckdock.yaml`).
2. Cliquez sur l’icône en forme de crayon (**Edit this file**), en haut à droite du contenu.
3. Faites vos changements dans l’éditeur.
4. Cliquez sur le bouton vert **Commit changes…**, écrivez un court message (par exemple « Nom du deck »), laissez cochée l’option qui enregistre sur `main`, puis confirmez avec **Commit changes**.

<!-- capture: l’icône crayon « Edit this file » et le bouton vert « Commit changes… » sur un fichier ouvert -->

Pour créer un fichier, utilisez **Add file › Create new file** ; pour ajouter une image, **Add file › Upload files**.

À chaque commit, le workflow vérifie le deck (vous le verrez à l’étape 8). Tant que le deck n’est pas relié à ce site, il ne publie rien : vous pouvez faire autant d’essais que vous voulez.

### Les fichiers YAML

Les fichiers du deck sont écrits en **YAML**, un format texte fait pour être lu par des humains. Les règles à connaître :

- chaque ligne est de la forme `clé: valeur` ;
- **les espaces en début de ligne comptent** : ils indiquent ce qui est rangé sous quoi. Utilisez des espaces, jamais de tabulations, et gardez le même décalage pour les éléments d’un même niveau ;
- une ligne qui commence par `- ` est un élément d’une liste ;
- une ligne qui commence par `#` est un commentaire, ignoré ;
- si un texte contient `:` ou commence par un caractère spécial, mettez-le entre guillemets : `"Question : pourquoi ?"`.

## 5. Donner son identité au deck

Ouvrez `deckdock.yaml` et modifiez-le comme à l’étape 4 :

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
```

- `id` est l’identifiant du deck : lettres minuscules, chiffres et tirets. Vous le donnerez aussi au site à l’étape 7.
- `editions` liste les langues que vous publiez. Une seule langue ? Écrivez `editions: [fr]`, et un nom simple : `name: Capitales d’Europe`.
- `icon` est facultatif : un seul emoji, affiché à côté du deck dans le catalogue.

> **Attention**
> Choisissez `id` et les codes d’`editions` avec soin : une fois le deck publié, ils ne doivent plus changer. Les modifier ferait perdre leur progression à tous les apprenants. Le nom, la description et l’icône, eux, peuvent changer à tout moment.

## 6. Écrire vos notes

Ouvrez `cards/hello.yaml` pour voir des exemples. Le modèle appelle les notes `cards` : chaque note est un bloc qui commence par `- id:`.

```yaml
cards:
  - id: capitale-france
    type: basic
    fr:
      front: Quelle est la capitale de la France ?
      back: Paris
    en:
      front: What is the capital of France?
      back: Paris
```

- `id` identifie la note, de façon unique dans tout le deck. **Ne le changez plus une fois publié.**
- `type` donne la sorte de note : `basic` (question et réponse), `reversed` (dans les deux sens), `cloze` (texte à trous) ou `mcq` (choix multiple). Exemples dans [Le format en détail](/fr/guide/format).
- Un bloc `fr:` et un bloc `en:` donnent le texte de chaque édition. Une note sans bloc pour une édition n’y figure pas.

Pour démarrer, remplacez les notes d’exemple `hello-…` par les vôtres. Vous pouvez répartir vos notes dans plusieurs fichiers du dossier `cards/`, par thème : **Add file › Create new file**, puis tapez par exemple `cards/europe.yaml` comme nom.

Pour une image : déposez le fichier dans `media/` (**Add file › Upload files**), puis écrivez dans le texte de la note `![Description de l’image](media/carte-france.png)`.

## 7. Créer le deck sur ce site

1. **Connectez-vous** avec le bouton **Connexion** en haut de la page : saisissez votre adresse e-mail et ouvrez le lien reçu. Il n’y a pas de mot de passe ; le lien sert une fois et expire au bout de 15 minutes.
2. **Choisissez votre pseudo** dans **Mes decks**. Il apparaît dans l’adresse de tous vos decks et **ne peut plus être changé ensuite** : de 3 à 30 caractères, lettres minuscules, chiffres et tirets.
3. Cliquez sur **+ Nouveau deck** et saisissez l’identifiant du deck : exactement la valeur de `id` dans votre `deckdock.yaml`. Validez avec **Créer le deck**.
4. Le site affiche le **jeton de publication**, une longue suite de caractères qui commence par `ddk_`. **Copiez-le tout de suite** : il n’est montré qu’une fois.

> **Attention**
> Le jeton permet de publier à votre place : ne le collez jamais dans un fichier du dépôt, il serait visible de tous. Il va uniquement dans un *secret*, à l’étape suivante. Jeton perdu ou divulgué ? Sur la page du deck, **Régénérer le jeton** en crée un nouveau et désactive l’ancien.

## 8. Relier le dépôt à ce site

Le workflow a besoin de deux informations : le jeton (un **secret**, que GitHub garde caché) et l’adresse de ce site (une **variable**, visible).

1. Dans votre dépôt, ouvrez l’onglet **Settings** (en haut, à droite des autres onglets).
2. Dans le menu de gauche, ouvrez **Secrets and variables**, puis **Actions**.
3. Onglet **Secrets** : cliquez sur **New repository secret**. Nom : `DECKDOCK_TOKEN`. Valeur : le jeton copié à l’étape 7. Validez avec **Add secret**.
4. Onglet **Variables** : cliquez sur **New repository variable**. Nom : `DECKDOCK_HUB_URL`. Valeur : l’adresse de ce site, telle que l’affiche la page de votre deck dans votre espace auteur. Validez avec **Add variable**.

<!-- capture: la page « Secrets and variables › Actions » avec le bouton « New repository secret » -->

<!-- capture: le formulaire « New repository variable » rempli avec DECKDOCK_HUB_URL -->

Recopiez les noms exactement, en majuscules : `DECKDOCK_TOKEN` et `DECKDOCK_HUB_URL`.

## 9. Publier et suivre la publication

Ajouter le secret et la variable ne lance rien : la publication part au **prochain commit sur `main`**. Faites une petite modification (corrigez une note, par exemple) et enregistrez-la.

Ouvrez ensuite l’onglet **Actions** de votre dépôt. Chaque commit y lance une exécution du workflow **Deck** :

- un rond jaune : en cours ;
- une coche verte : tout s’est bien passé ;
- une croix rouge : une étape a échoué (voir l’étape 10).

<!-- capture: l’onglet Actions avec une exécution réussie (coche verte) et une exécution en échec (croix rouge) -->

En cliquant sur une exécution, puis sur **build**, vous voyez les étapes une à une : les tests, la compilation du deck (*Compile the deck*), sa vérification, puis l’envoi (*Publish to DeckDock hub*), une fois par édition.

Après la première publication :

- le deck est **en attente de validation** : un administrateur le relira avant qu’il apparaisse dans le catalogue ;
- vous pouvez déjà le **tester** : la page du deck, dans votre espace auteur, affiche l’adresse de chaque édition avec un bouton pour la copier. Collez-la dans Anki, dans **Outils › DeckDock › Ajouter**.

Ensuite, chaque commit sur `main` publie une nouvelle version, qui arrive chez les apprenants. Relancer une exécution déjà réussie ne crée pas de doublon : le site répond que cette version est déjà publiée.

## 10. Corriger une erreur de vérification

Une croix rouge n’a rien de grave : rien n’a été publié, la version précédente reste en ligne. Pour trouver la cause :

1. ouvrez l’exécution en échec dans l’onglet **Actions**, puis **build** ;
2. dépliez l’étape marquée d’une croix rouge et lisez les dernières lignes : le message dit ce qui ne va pas, et souvent où.

Les messages sont en anglais. Une erreur dans vos fichiers ressemble à ceci, avec le fichier et le numéro de ligne :

```text
cards/europe.yaml:12: ...
```

Ouvrez ce fichier, allez à la ligne indiquée (les numéros sont affichés à gauche dans l’éditeur de GitHub), corrigez, puis faites un commit : une nouvelle exécution démarre.

Les causes les plus fréquentes :

| Ce que vous voyez | Que faire |
| --- | --- |
| Une erreur YAML près d’une ligne | Vérifiez les espaces en début de ligne et mettez entre guillemets les textes qui contiennent `:`. |
| Un identifiant refusé | Uniquement des lettres minuscules, des chiffres et des tirets simples, sans espace ni accent. |
| Un identifiant en double | Chaque note doit avoir un `id` différent dans tout le deck. |
| Un fichier introuvable dans `media/` | Vérifiez l’orthographe exacte du nom, majuscules et extension comprises. |
| Un choix multiple refusé | Une note `mcq` a au moins deux choix, dont exactement un avec `correct: true`. |
| `Invalid or revoked publish token` | Le secret `DECKDOCK_TOKEN` est faux ou le jeton a été régénéré : copiez un nouveau jeton dans le secret. |
| `deck.id … does not match the deck of this token` | L’`id` de `deckdock.yaml` diffère de l’identifiant du deck créé sur ce site : ils doivent être identiques. |
| `This deck awaits approval and already has 3 versions` | Un deck en attente reçoit au plus 3 versions : attendez la validation, puis publiez à nouveau. |
| `Too many publish requests` | Patientez quelques minutes, puis relancez l’exécution avec **Re-run jobs**. |

Une erreur à l’étape *Publish to DeckDock hub* vient de ce site ; le tableau des réponses possibles est dans [Publier sans GitHub](/fr/guide/publier-sans-github#les-reponses-du-hub).

> **Note**
> Une modification de la structure d’un type de note déjà publié (retirer, renommer ou réordonner ses champs) est refusée, pour protéger la progression des apprenants. Cela ne concerne que ceux qui modifient les types de notes du compilateur (`compiler/notetypes.py`) : écrire vos notes ou changer leur `type` ne touche pas à cette structure. Voir [Le format en détail](/fr/guide/format#ce-qui-casse-la-compatibilite).

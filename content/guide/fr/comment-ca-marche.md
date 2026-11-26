# Comment ça marche

DeckDock permet de partager un deck Anki qui se met à jour tout seul chez ceux qui l’étudient : vous corrigez une note ou en ajoutez dix, et chaque apprenant reçoit la nouvelle version sans perdre sa progression.

## Un deck DeckDock, c’est quoi ?

C’est un deck Anki ordinaire du point de vue de l’apprenant : des notes, des révisions, des statistiques. La différence est dans la façon dont il est écrit et distribué.

- **Le contenu est écrit dans des fichiers texte**, un peu comme une liste : une question, une réponse, quelques étiquettes. Pas besoin d’Anki pour écrire.
- **Ces fichiers vivent dans un dépôt GitHub**, un dossier en ligne qui garde l’historique de chaque modification.
- **À chaque modification, une vérification automatique** contrôle les fichiers, fabrique le deck et l’envoie sur ce site.

Un deck peut exister en plusieurs **éditions** : souvent une par langue (`fr`, `en`…). Chaque édition a sa propre adresse et ses propres versions.

> **Note**
> Dans Anki, une *note* est ce que vous écrivez (une question et sa réponse) ; Anki en tire une ou plusieurs *cartes* à réviser. Ce site compte des notes.

## Pourquoi un dépôt plutôt qu’un fichier .apkg ?

Un fichier `.apkg` est une photo figée : si vous corrigez une erreur, il faut renvoyer le fichier à tout le monde, et chacun doit le réimporter. Avec un dépôt :

- **les mises à jour arrivent seules** chez les apprenants, sans rien réimporter ;
- **l’historique est complet** : on voit ce qui a changé, quand, et on peut revenir en arrière ;
- **d’autres peuvent proposer des corrections**, que vous acceptez ou non (sur GitHub, cela s’appelle une *pull request*) ;
- **rien à installer** : tout se fait dans le navigateur, sur le site de GitHub.

## Ce que reçoivent les apprenants

L’apprenant installe une fois le [plugin DeckDock](https://github.com/NayanChauveau/anki-deck-manager) dans Anki. Ensuite :

1. il trouve votre deck dans le catalogue de ce site et copie l’adresse de l’édition qui l’intéresse ;
2. dans Anki, il ouvre **Outils › DeckDock**, clique sur **Ajouter** et colle l’adresse ;
3. le deck s’installe ; quand vous publiez une nouvelle version, le plugin la propose et l’applique.

Ses révisions sont conservées d’une version à l’autre : une note corrigée reste la même note pour Anki, avec son historique. C’est pour cela que certains éléments (l’identifiant du deck, les codes d’édition, les identifiants des notes) ne doivent jamais changer une fois le deck publié. Le détail est dans [Le format en détail](/fr/guide/format).

## La validation par un administrateur

Pour garder un catalogue fiable, **la première version d’un nouveau deck est relue par un administrateur** avant d’apparaître dans le catalogue.

- En attendant, le deck est déjà en ligne : vous pouvez le tester dans Anki avec son adresse, affichée dans votre espace auteur. Il n’est simplement pas encore listé.
- Une fois validé, le deck apparaît dans le catalogue avec sa page (description, éditions, aperçu de quelques notes).
- **Les versions suivantes sont publiées directement**, sans nouvelle relecture.

Un administrateur peut aussi masquer un deck, avec une raison affichée sur sa page. Pour retirer un de vos decks du site, écrivez à l’administrateur du hub : ses coordonnées figurent dans les mentions légales.

## Deux façons de publier

- **[Publier avec GitHub, pas à pas](/fr/guide/publier-avec-github)** : la voie conseillée, même si vous n’avez jamais codé. Vous partez d’un modèle prêt à l’emploi et tout se fait sur le site de GitHub.
- **[Publier sans GitHub](/fr/guide/publier-sans-github)** : pour ceux qui fabriquent déjà leur deck avec leurs propres outils et veulent l’envoyer avec une commande ou une simple requête.

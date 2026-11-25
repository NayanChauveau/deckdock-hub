# Commandes et paiements — modules génériques

Le starter fournit la commande générique sans rien à vendre : le module qui vend (un catalogue,
une œuvre sur mesure…) s’ajoute comme un module qui étend `orders` (voir
[ARCHITECTURE.md](ARCHITECTURE.md), « Le point d’extension des commandes »). Livraison en France
ou Belgique, en EUR, sans compte client.

## Essayer en local

```sh
pnpm db:migrate
pnpm commerce:demo
pnpm dev
```

Dans `.env.local`, utiliser `COMMERCE_PAYMENT_MODE=simulated` et `EMAIL_MODE=simulated`.
`commerce:demo` (base locale `_dev` ou `_test` uniquement, refusé en production) ouvre les
commandes pour la France et la Belgique, sort le site de la maintenance et crée une commande de
démonstration en attente de paiement. Son lien privé s’affiche : il ouvre le suivi, où le bouton
de simulation locale confirme le paiement. Ce bouton n’est jamais disponible en production.

Les emails simulés apparaissent dans **Technique → Emails de commande** avec leur sujet et leur
texte. Aucun email n’est envoyé. Le traitement automatique Payload tourne toutes les 5 minutes
avec `pnpm dev`/`pnpm start` ; exécution immédiate en local : `pnpm commerce:maintenance`.

## CGV et pages légales

Une commande exige l’acceptation des CGV (`terms`) ; le serveur enregistre la date
d’acceptation et la **version des CGV** saisie dans **Pages légales** : changer cette version à
chaque modification des CGV. Les pages légales (`/fr/mentions-legales`,
`/fr/conditions-generales-de-vente`, `/fr/confidentialite` et leurs équivalents anglais) sont
administrables en texte riche ; `pnpm db:seed` y charge des textes d’exemple à remplacer et à
faire valider. La **mention fiscale des prix** se règle dans **Informations publiques**.

## Administration

- **Réglages des commandes** : ouverture des commandes, pays livrés et email interne prévenu à
  chaque commande payée.
- **Commandes** : coordonnées, montants figés, historique, paiement, réalisation, commentaire du
  client (lecture seule), note interne et numéro de suivi.
- **Photos clients privées** (module `customer-uploads`) : lecture réservée aux administrateurs.

La réalisation suit `queued → in_progress → ready → shipped`, avec annulation possible avant
expédition. Un paiement confirmé est requis. Le statut de paiement et les prix ne sont pas
modifiables manuellement. Une annulation ne rembourse pas implicitement : effectuer le
remboursement dans Stripe. Les webhooks synchronisent les remboursements complets/partiels. Un
paiement reçu après annulation est signalé pour remboursement manuel.

## Stripe test et live

Pour tester le vrai Checkout hébergé, remplacer la simulation locale par :

```dotenv
COMMERCE_PAYMENT_MODE=stripe
STRIPE_MODE=test
STRIPE_TEST_SECRET_KEY=sk_test_...
STRIPE_TEST_WEBHOOK_SECRET=whsec_...
# À remplir uniquement pour préparer le mode réel :
STRIPE_LIVE_SECRET_KEY=
STRIPE_LIVE_WEBHOOK_SECRET=
EMAIL_MODE=simulated
```

Configurer le webhook `/api/commerce/webhook` pour :

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `charge.refunded`

En local, utiliser Stripe CLI pour transférer les événements à
`http://localhost:3300/api/commerce/webhook` et récupérer son secret de signature.
Le corps brut est vérifié avant traitement. Le retour du navigateur ne confirme
jamais un paiement. La session Stripe est relue côté serveur et son montant,
sa devise et ses identifiants sont contrôlés. Les événements dont `livemode` ne
correspond pas au mode actif sont refusés.

En production, ajouter les secrets nommés `STRIPE_TEST_*` et/ou `STRIPE_LIVE_*`
dans l’environnement GitHub `production`, puis sélectionner `STRIPE_MODE=test`
ou `live`. La paire du mode actif est obligatoire dès qu’une clé est renseignée ;
le mode live est toujours explicite. Les secrets sont transmis par la CI et conservés dans
la configuration privée du serveur. La simulation locale est désactivée par le
code de production. Sans clés test, le site reste consultable et le paiement
reste indisponible. Activer les commandes dans l’administration après avoir choisi
les paramètres.

## Paiements et confidentialité

Le prix et les frais sont figés à la commande. Les reprises de création de session utilisent une
clé d’idempotence. Les événements Stripe sont dédupliqués en BDD ; un événement tardif ne fait
pas régresser un paiement confirmé. La maintenance réconcilie les sessions payées dont le webhook
a été retardé.

Le suivi exige un cookie HttpOnly signé ou le lien personnel présent dans l’email. Le jeton du
lien reste dans le fragment du navigateur, est effacé puis échangé par POST ; il ne transite pas
dans les URLs HTTP des journaux d’accès. Connaître la référence seule n’accorde aucun accès. Les
données de commande ne sont pas exposées par les API publiques Payload. Les requêtes ont une
limite de taille, un contrôle d’origine et des quotas persistants par adresse réseau.

Les photos clients (module `customer-uploads`) sont validées selon leurs octets, décodées puis
normalisées en JPEG sans métadonnées, avec un nom aléatoire, une limite de 10 Mo et 20 millions
de pixels, rangées dans `MEDIA_DIR/private`.

## Emails et tâches automatiques

La file d’emails et ses reprises sont persistées dans PostgreSQL. Une clé unique
évite la création répétée d’une même notification. Payload utilise sa file de
jobs intégrée pour la maintenance : aucun nouveau service VPS, worker Python
ou workflow de déploiement supplémentaire. Seul le web active les tâches
automatiques ; les conteneurs de migrations restent sans ordonnanceur.

SMTP reste facultatif : `EMAIL_MODE=smtp`, `SMTP_URL` et `EMAIL_FROM`. Le secret
SMTP est transmis uniquement côté serveur. Les erreurs restent génériques et
les coordonnées, fichiers et jetons ne sont pas écrits dans les logs métier.
Un identifiant de message stable accompagne les reprises. SMTP ne garantit pas
une livraison exactement une fois si un arrêt survient juste après l’envoi.
L’adaptateur email d’authentification Payload reste indépendant de ces emails de
commande.

## Vérifications

`pnpm test` automatise les tests métier, React, PostgreSQL, HTTP et navigateur, avec bases et
serveurs isolés puis nettoyage. Voir [TESTING.md](TESTING.md).

Références : [sessions Stripe](https://docs.stripe.com/api/checkout/sessions),
[webhooks Stripe](https://docs.stripe.com/events/manage-webhook-endpoints),
[transactions Payload](https://payloadcms.com/docs/database/transactions),
[file de jobs Payload](https://payloadcms.com/docs/jobs-queue/overview).

## Suggestions d’adresses

Le champ adresse propose des résultats après trois caractères et 400 ms sans frappe. La sélection remplit la rue, le code postal et la ville ; chaque champ reste modifiable. Le pays choisi limite les suggestions : IGN/Géoplateforme (BAN) en France, Photon/OpenStreetMap en Belgique. Aucune clé API n’est nécessaire.

Les requêtes passent par `POST /api/addresses` (origine vérifiée, corps borné, réponse sans cache HTTP), sans enregistrer les recherches dans les journaux applicatifs. Les caractères saisis sont transmis au fournisseur du pays choisi. Une temporisation, une limite de fréquence par fournisseur et un cache mémoire borné de 60 secondes réduisent les appels. Cette limite est propre au processus, adaptée au déploiement actuel à une instance. Les fournisseurs publics n’offrent pas de garantie de disponibilité : en cas d’échec ou de limitation, la saisie manuelle reste disponible et la commande reste possible. Les états de recherche sont annoncés aux lecteurs d’écran, sans ligne d’aide visible sous le champ.

Le module `addresses` isole le cas d’usage, le port de recherche et les adaptateurs externes. Les composants Combobox, InputGroup et Textarea proviennent de la CLI shadcn ; un formulaire de commande l’utilise avec React Hook Form et sa validation Zod.

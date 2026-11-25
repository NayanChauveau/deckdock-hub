#!/usr/bin/env bash
# GitHub secrets and deploy key of a new site, in one command. Run it yourself, in your own
# terminal, from the site's root (after scripts/init-site.mjs):
#   bash scripts/github-secrets.sh [--vps <address>] [--repo <owner/name>] [--ssh-user root]
#                                  [--ssh-port 22] [--replace <SECRET>]...
# - repository: NayanChauveau/<slug of site.config.json> unless --repo;
# - VPS address: --vps, or the GitHub variable VPS_IPV4 of the repository;
# - deploy key ~/.ssh/github-actions-<slug>, generated once, authorised on the VPS as a `restrict`
#   line (authorized_keys backed up first); SSH_KNOWN_HOSTS is the VPS key this computer already
#   trusts (ssh-keygen -F), never a fresh scan;
# - POSTGRES_PASSWORD, PAYLOAD_SECRET and BETTER_AUTH_SECRET generated; first administrator and Stripe test values
#   typed (hidden); Stripe skipped when deploy.payments is false.
# Only the secrets listed in github.secrets of site.config.json are set. A secret already present
# is kept (run it again safely); --replace NAME asks for or generates that one again.
# No secret value is ever printed; the deploy key fingerprint (for sites.json) is.
set -euo pipefail

fail() {
  printf 'Refusé : %s\n' "$1" >&2
  exit 1
}

repo="" vps="" ssh_user="root" ssh_port="22" replace=" "
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) repo="${2:?--repo <owner/name>}"; shift 2 ;;
    --vps) vps="${2:?--vps <adresse>}"; shift 2 ;;
    --ssh-user) ssh_user="${2:?--ssh-user <utilisateur>}"; shift 2 ;;
    --ssh-port) ssh_port="${2:?--ssh-port <port>}"; shift 2 ;;
    --replace) replace+="${2:?--replace <SECRET>} "; shift 2 ;;
    *) fail "argument inconnu : $1 (voir l’en-tête du script)" ;;
  esac
done

[ -f site.config.json ] || fail "site.config.json absent : lancer ce script depuis la racine du site."
config="$(node -e '
const c = JSON.parse(require("fs").readFileSync("site.config.json", "utf8"))
console.log([c.slug, c.identity.displayName, c.deploy.payments === false ? "false" : "true", c.github.secrets.join(",")].join("\n"))
')" || fail "site.config.json illisible."
{ read -r slug; read -r display_name; read -r payments; read -r listed; } <<< "$config"
[[ "$slug" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || fail "slug invalide dans site.config.json."
[ "$slug" != "example" ] || fail "starter non initialisé (slug example) : lancer d’abord node scripts/init-site.mjs."
case "$replace" in *" POSTGRES_PASSWORD "*)
  fail "POSTGRES_PASSWORD ne se remplace pas ici : la base existante garde l’ancien mot de passe." ;;
esac
[[ "$ssh_user" =~ ^[a-z_][a-z0-9_-]*$ ]] || fail "utilisateur SSH invalide."
[[ "$ssh_port" =~ ^[0-9]+$ ]] || fail "port SSH invalide."
repo="${repo:-NayanChauveau/$slug}"
key="$HOME/.ssh/github-actions-$slug"

wanted() { [[ ",$listed," == *",$1,"* ]]; }

gh repo view "$repo" > /dev/null || fail "dépôt $repo introuvable ou gh non connecté (gh auth login)."
vps="${vps:-$(gh variable get VPS_IPV4 -R "$repo" 2> /dev/null || true)}"
[ -n "$vps" ] || fail "adresse du VPS inconnue : --vps <adresse>, ou la variable VPS_IPV4 du dépôt."
[[ "$vps" =~ ^[A-Za-z0-9.:-]+$ ]] || fail "adresse du VPS invalide."
known_name="$vps"
[ "$ssh_port" = 22 ] || known_name="[$vps]:$ssh_port"
known_hosts="$(ssh-keygen -F "$known_name" | grep -v '^#' | grep . || true)"
[ -n "$known_hosts" ] ||
  fail "$known_name absent de ~/.ssh/known_hosts : se connecter une fois au VPS et vérifier son empreinte."

existing=" $(gh secret list -R "$repo" | cut -f1 | tr '\n' ' ')"
# A secret to write: listed in site.config.json, and absent or named by --replace.
needed() { wanted "$1" && { [[ "$existing" != *" $1 "* ]] || [[ "$replace" == *" $1 "* ]]; }; }
tty_newline() { [ -t 0 ] && echo >&2 || true; }

# ---- typed values first, checked before anything is written ----------------------------------
admin_email="" admin_name="" admin_pw="" stripe_key="" stripe_webhook=""
if needed BOOTSTRAP_ADMIN_EMAIL; then
  read -r -p "Premier administrateur, email : " admin_email || true
  [[ "$admin_email" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || fail "email invalide."
fi
if needed BOOTSTRAP_ADMIN_NAME; then
  read -r -p "Premier administrateur, nom [$display_name] : " admin_name || true
  admin_name="${admin_name:-$display_name}"
fi
if needed BOOTSTRAP_ADMIN_PASSWORD; then
  read -r -s -p "Premier administrateur, mot de passe (12 caractères au moins, non affiché) : " admin_pw || true
  tty_newline
  read -r -s -p "Confirmer le mot de passe : " confirmation || true
  tty_newline
  [ "${#admin_pw}" -ge 12 ] && [ "$admin_pw" = "$confirmation" ] ||
    fail "mot de passe trop court ou confirmation différente ; rien n’a été écrit."
  unset confirmation
fi
if [ "$payments" = true ]; then
  if needed STRIPE_TEST_SECRET_KEY; then
    read -r -s -p "Stripe, clé secrète de test sk_test_… (non affichée, vide pour plus tard) : " stripe_key || true
    tty_newline
  fi
  if needed STRIPE_TEST_WEBHOOK_SECRET; then
    read -r -s -p "Stripe, secret du webhook de test whsec_… (non affiché, vide pour plus tard) : " stripe_webhook || true
    tty_newline
  fi
fi

# ---- deploy key and SSH connection ------------------------------------------------------------
echo "Clé de déploiement $key"
mkdir -p "$HOME/.ssh"
[ -f "$key" ] || ssh-keygen -q -t ed25519 -N "" -C "github-actions-$slug" -f "$key"
pub="$(cut -d' ' -f1,2 "$key.pub")"
[[ "$pub" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+$ ]] || fail "clé publique inattendue dans $key.pub."
# Appended once, after a dated backup; nothing else of authorized_keys changes.
ssh -p "$ssh_port" "$ssh_user@$vps" "set -e; f=\$HOME/.ssh/authorized_keys; if ! grep -qF '$pub' \"\$f\"; then cp \"\$f\" \"\$f.bak-\$(date -u +%Y%m%dT%H%M%SZ)\"; printf 'restrict %s github-actions-%s\n' '$pub' '$slug' >> \"\$f\"; echo '   ajoutée à authorized_keys (copie de sauvegarde faite)'; else echo '   déjà autorisée sur le VPS'; fi"

set_secret() { # name, value on stdin
  gh secret set "$1" -R "$repo" > /dev/null
  echo "   $1"
}
echo "Secrets écrits dans $repo :"
wanted SSH_KEY && set_secret SSH_KEY < "$key"
wanted SSH_HOST && printf '%s' "$vps" | set_secret SSH_HOST
wanted SSH_USER && printf '%s' "$ssh_user" | set_secret SSH_USER
wanted SSH_PORT && printf '%s' "$ssh_port" | set_secret SSH_PORT
wanted SSH_KNOWN_HOSTS && printf '%s\n' "$known_hosts" | set_secret SSH_KNOWN_HOSTS

# ---- generated and typed secrets --------------------------------------------------------------
for name in POSTGRES_PASSWORD PAYLOAD_SECRET BETTER_AUTH_SECRET; do
  needed "$name" && openssl rand -hex 32 | tr -d '\n' | set_secret "$name"
done
[ -n "$admin_email" ] && printf '%s' "$admin_email" | set_secret BOOTSTRAP_ADMIN_EMAIL
[ -n "$admin_name" ] && printf '%s' "$admin_name" | set_secret BOOTSTRAP_ADMIN_NAME
[ -n "$admin_pw" ] && printf '%s' "$admin_pw" | set_secret BOOTSTRAP_ADMIN_PASSWORD
[ -n "$stripe_key" ] && printf '%s' "$stripe_key" | set_secret STRIPE_TEST_SECRET_KEY
[ -n "$stripe_webhook" ] && printf '%s' "$stripe_webhook" | set_secret STRIPE_TEST_WEBHOOK_SECRET
unset admin_pw stripe_key stripe_webhook

echo "Empreinte de la clé (deployKeyFingerprint de sites.json) : $(ssh-keygen -lf "$key.pub" | cut -d' ' -f2)"
missing="$(comm -23 <(tr ',' '\n' <<< "$listed" | sort) <(gh secret list -R "$repo" | cut -f1 | sort) | tr '\n' ' ')"
[ -z "${missing// /}" ] || echo "Secrets encore absents (à créer au besoin, voir STARTER.md) : $missing"

# Guide utilisateur — SPRUNK Bot

Ce guide s'adresse au staff et aux membres du serveur : comment utiliser les tickets, lancer une mission, et régler les options courantes dans `config.json`. Pour l'installation du bot ou son architecture interne, voir `README.md` et `docs/DEVELOPER_GUIDE.md`.

## 1. Le panel de support (tickets)

### Publier le panel

Un administrateur publie le panel dans un salon avec :

- la commande `/template`, ou
- le message `!setup` (équivalent historique, réservé aux administrateurs)

Le bot poste un message avec un bouton **« Ouvrir un ticket »**.

### Ouvrir un ticket (côté membre)

1. Cliquer sur **Ouvrir un ticket**.
2. Choisir une catégorie dans le menu déroulant qui apparaît (visible seulement par le membre).
3. Le bot crée un salon privé, visible uniquement par le membre, le rôle staff de la catégorie et le bot.

Catégories disponibles par défaut (modifiables sans toucher au code, voir §4) :

| Catégorie | Ce qu'elle déclenche |
|---|---|
| 🥤 Contacter la direction | Salon direct avec la direction |
| 🤝 Commander un distributeur | Salon pour organiser l'installation d'un distributeur |
| 💼 Postuler au Sprunk | Salon de candidature |
| 🍋 Réservation | Salon de demande de réservation |
| 🔨 Architecture | Ouvre d'abord un petit formulaire (type de projet, date de l'événement, nombre de partenaires) avant de créer le salon |

### Gérer un ticket ouvert (côté staff)

Dans le salon, cinq boutons sont disponibles :

- **Fermer** — génère un transcript du salon, l'archive, l'envoie dans le salon de logs de fermeture (si configuré), puis supprime le salon après quelques secondes.
- **Réassigner** — déplace le ticket vers une autre catégorie/équipe (change le salon Discord parent et les permissions).
- **Renommer** — change le nom du salon.
- **➕ Ajouter** — ajoute jusqu'à 5 membres supplémentaires au salon.
- **➖ Retirer** — retire des membres du salon (le propriétaire du ticket et le bot ne peuvent pas être retirés).

Ces actions sont réservées aux **administrateurs** et aux membres ayant le rôle défini par `bot.reassignRoleId` dans `config.json`.

### Assigner un ticket Architecture à un architecte

Les tickets **🔨 Architecture** (et toute catégorie qui déclare un bloc `assignment`, voir §4) ont une seconde rangée de boutons, **📐 Assigner** et **🏷️ Statut**. Le suivi se lit directement dans le nom du salon :

- **l'emoji de l'architecte en tête** du nom : qui s'occupe du ticket ;
- **l'emoji de statut en fin** du nom : où en est le ticket.

Exemple : `ticket-bob-architecture-⚪` (nouveau, en attente) → assigné à l'architecte 🦊 → `🦊-ticket-bob-architecture-🟠`.

| Statut | Emoji par défaut | Quand |
|---|---|---|
| En attente | ⚪ | Posé automatiquement à la création du ticket |
| En cours | 🟠 | Posé automatiquement à l'assignation |
| Payé | 💰 | Via le bouton Statut |
| Terminé | ✅ | Via le bouton Statut |

- **📐 Assigner** — un membre du staff (administrateur ou rôle `reassignRoleId`) choisit l'architecte dans un menu ; un architecte (membre du rôle `staffRoleId` de la catégorie) qui clique s'assigne directement lui-même. L'architecte est mentionné dans le ticket. Réassigner remplace l'emoji de tête ; un ticket en attente passe « En cours », un ticket déjà Payé ou Terminé garde son statut.
- **`/assigner`** — même chose en commande, à lancer dans le ticket : sans option, vous vous assignez vous-même ; `/assigner architecte:@membre` est réservé au staff.
- **🏷️ Statut** — choisir le nouveau statut ; seul l'emoji de fin change. Accessible au staff et aux architectes.
- **Renommer** conserve les emojis d'architecte et de statut sur ces tickets.

Seuls les membres du rôle architecte **ayant un emoji dans `assignment.architects`** peuvent être assignés. Comme pour `/statut`, Discord n'autorise que **2 renommages d'un même salon par tranche de 10 minutes** (assignation, statut et « Renommer » confondus) : au-delà, le bot indique dans combien de minutes réessayer et ne modifie rien.

### Transformer un salon existant en ticket (`/acquire`)

Si un salon a été créé autrement que par le panel — manuellement, par un autre bot, ou avant l'installation de SPRUNK — il n'est pas reconnu comme un ticket : aucun des boutons ci-dessus ne fonctionne dessus. `/acquire` permet de le rattacher :

1. Se placer dans le salon à convertir.
2. Lancer `/acquire` — l'option `proprietaire` indique le membre considéré comme propriétaire du ticket ; **si elle est omise, c'est vous** (la personne qui tape la commande), ou le propriétaire actuel si le salon est déjà un ticket.
3. Choisir la catégorie dans le menu qui apparaît (les mêmes catégories que dans le panel).

Le bot réinitialise alors les permissions du salon comme un ticket normal (propriétaire, rôle staff, bot), enregistre le sujet du salon pour que **Fermer / Réassigner / Renommer / Ajouter / Retirer** fonctionnent, poste le message de ticket avec ses boutons, et journalise l'acquisition dans le salon de logs.

#### Rafraîchir un ticket déjà géré

Lancée dans un salon **déjà géré par le bot**, `/acquire` ne refuse plus : elle met le ticket à jour. C'est la façon de récupérer un ticket dont le message a été supprimé, dont l'embed est resté sur d'anciennes informations, ou dont la catégorie a changé dans `config.json` :

- l'embed et les boutons du message de ticket sont **réécrits** avec le titre, la description et les boutons actuels de la catégorie ;
- le propriétaire et la catégorie par défaut sont **ceux du ticket en cours** — ne renseignez `proprietaire` ou ne changez de catégorie que si vous voulez justement les modifier ;
- les permissions du propriétaire, du rôle staff et du bot sont réappliquées, **sans éjecter** les membres ajoutés au ticket via ➕ Ajouter (contrairement à une première acquisition, qui remet les permissions du salon à zéro) ;
- l'opération est journalisée sous le titre **♻️ TICKET MIS À JOUR**.

Si aucun message à boutons du bot n'existe plus dans le salon, un nouveau est posté et le bot le signale.

#### Mode silencieux (`silencieux:true`)

`/acquire silencieux:true` acquiert le salon **sans aucune question** :

- le propriétaire est la personne qui a tapé la commande (sauf si `proprietaire` est renseigné, ou si le salon est déjà un ticket : c'est alors son propriétaire actuel) ;
- **aucun menu de catégorie** : la catégorie du ticket est celle du ticket en cours s'il y en a un, sinon elle est déduite de la catégorie Discord dans laquelle se trouve déjà le salon (le `categoryId` d'une des catégories de `config.json`). Le salon n'est pas déplacé ;
- le message de ticket est posté **sans mentionner** le propriétaire ni le rôle staff, et sans notification.

Si la catégorie Discord du salon ne correspond à aucune catégorie de `config.json`, le bot le signale et affiche le menu pour la choisir ; le reste du mode silencieux (pas de mention, pas de notification) reste appliqué. Les permissions sont réinitialisées et l'acquisition est journalisée comme pour une acquisition normale.

#### Un seul message à boutons par salon

Si le bot a déjà posté un message à boutons dans le salon (acquisition précédente, ticket rattaché puis détaché…), il **met à jour ce message** au lieu d'en poster un second — c'est le plus ancien du salon qui est réutilisé, donc celui situé le plus haut dans l'historique. S'il n'y en a aucun, un nouveau message est posté normalement.

`/acquire` est réservée aux administrateurs et au rôle `reassignRoleId`.

## 2. Missions

### Créer une mission

`/mission` (réservé aux administrateurs / rôle `reassignRoleId`) demande :

- **titre**, **description**, **lieu**
- **date** au format `JJ/MM/AAAA HH:mm` (heure de Paris), ex. `15/04/2027 21:00`
- **max** (optionnel) — nombre de places ; laisser vide pour un nombre illimité

Le bot publie une annonce dans le salon configuré (`bot.missionChannelId`, ou le salon courant si non configuré), avec deux réactions automatiques :

- ✅ **Participer**
- 🟡 **Réserve**

### Comment ça se comporte

- Réagir avec ✅ retire automatiquement la réaction 🟡 si elle était posée (et inversement) — un membre est soit participant, soit en réserve, jamais les deux.
- Si un nombre maximal de places est fixé et atteint, la réaction ✅ est refusée et le membre reçoit un message privé l'informant que c'est complet.
- Le bot envoie un message temporaire (auto-supprimé après quelques secondes) pour confirmer chaque inscription.

### Rappels automatiques

Le bot mentionne tous les participants et réservistes :

- 15 minutes avant l'heure de la mission,
- 5 minutes avant,
- au moment exact du lancement.

Les rappels sont automatiquement nettoyés (messages supprimés) quelques minutes après le lancement.

## 3. Autres commandes

| Commande | Effet | Qui peut l'utiliser |
|---|---|---|
| `/distributeur` | Publie l'annonce standard d'installation d'un distributeur Sprunk dans le salon courant | Rôle `distributorRoleId`, administrateurs, ou rôle `reassignRoleId` |
| `/acquire` | Transforme le salon courant en ticket géré par le bot, ou met à jour l'embed et les permissions d'un ticket existant ; `silencieux:true` acquiert sans menu ni mention (voir §1) | Administrateurs ou rôle `reassignRoleId` |
| `/assigner` | Assigne le ticket courant à un architecte (voir §1) | Administrateurs ou rôle `reassignRoleId` pour n'importe quel architecte ; un architecte pour lui-même |
| `/statut` | Indique si le Sprunk est ouvert ou fermé : renomme le salon de statut et met à jour son message (voir ci-dessous) | Administrateurs ou rôle `reassignRoleId` |
| `/reglement` | Publie le règlement dans le salon courant, avec un bouton qui donne le rôle membre (voir ci-dessous) | Administrateurs |
| `/troll` | Envoie une courte rafale de messages privés à une cible, avec un cooldown | Administrateurs ou rôle `reassignRoleId` — **et seulement si activée dans `config.json`** |

`/troll` est **désactivée par défaut**. Voir §4 pour l'activer.

### Le salon de statut (`/statut`)

Un salon dédié sert de panneau « ouvert / fermé » : son nom dans la liste des salons et son dernier message indiquent l'état du Sprunk.

- `/statut etat:Ouvert` ou `/statut etat:Fermé` renomme le salon et publie le panneau de cet état : mention du rôle configuré, message et image prédéfinis (section `status` de `config.json`, voir §4) — encadré vert pour « Ouvert », rouge pour « Fermé ».
- Option `message` : remplace le message prédéfini, pour cette fois uniquement (ex. « Ouvert jusqu'à 23h ce soir ! »). Une option de commande slash ne peut pas contenir de retour à la ligne : pour un message sur plusieurs lignes, écrivez-le dans `config.json` avec `\n`.
- Option `nom` : remplace le nom de salon prédéfini, pour cette fois uniquement.
- Option `ping` : mettre `Non` pour publier sans mentionner le rôle — utile pour corriger une faute sans notifier tout le monde une seconde fois.

À chaque changement, le bot **publie un nouveau message**, puis supprime le panneau précédent qu'il avait lui-même posté : le salon ne garde donc qu'un seul panneau, tout en notifiant les membres à chaque fois. C'est voulu — modifier un message existant ne déclenche aucune notification chez personne. Un message posté par quelqu'un d'autre n'est jamais supprimé. Pour garder un panneau propre, laissez ce salon en lecture seule pour les membres. Chaque changement est journalisé dans le salon de logs.

**Limite Discord** : un même salon ne peut être renommé que 2 fois par tranche de 10 minutes. Au-delà, le bot refuse la commande et indique dans combien de minutes réessayer — ni le nom ni le message ne sont modifiés, pour que le panneau ne se contredise jamais. Changer seulement le message sans changer le nom du salon n'est pas concerné par cette limite.

### Le règlement (`/reglement`)

Lancée dans un salon, la commande y publie le règlement : un encadré numéroté suivi d'un bouton vert **« Lu et Approuvé »**.

- Un membre qui clique reçoit le rôle défini par `rules.memberRoleId` et une confirmation visible de lui seul. C'est ainsi qu'on ouvre l'accès au reste du serveur après acceptation.
- Cliquer une deuxième fois ne fait rien de plus : le bot répond que le règlement est déjà accepté.
- Le bouton reste actif tant que le message existe — republier le règlement crée un second message, supprimez l'ancien si vous ne le voulez plus.
- Le texte, le titre, l'avertissement et le libellé du bouton se modifient dans `config.json` (voir §4), sans toucher au code.

Pour que le bouton fonctionne, le rôle du bot doit être **au-dessus** du rôle membre dans la liste des rôles du serveur et avoir la permission « Gérer les rôles ». Sinon, le membre reçoit un message d'erreur explicite au clic.

## 4. Réglages courants dans `config.json`

Ce fichier peut être modifié sans redémarrer le bot — un changement valide est repris automatiquement en quelques secondes (« ✅ config.json rechargé » s'affiche dans les logs du bot). Une modification invalide est ignorée et l'ancienne configuration reste active.

### Section `bot`

| Champ | Rôle |
|---|---|
| `guildId` | ID du serveur Discord où le bot opère |
| `logsChannelId` | Salon où sont publiés les logs (ouverture/fermeture/renommage de ticket) |
| `missionChannelId` | Salon par défaut des annonces de mission |
| `reassignRoleId` | Rôle staff autorisé à gérer les tickets, créer des missions, utiliser `/troll` |
| `distributorRoleId` | Rôle autorisé à utiliser `/distributeur` |
| `color` | Couleur des embeds (code hexadécimal, ex. `#00ff11`) |
| `footerText` | Texte affiché en pied des embeds |
| `clearGlobalCommandsOnStartup` | Mettre à `true` une seule fois pour nettoyer d'anciennes commandes globales, puis remettre à `false` |

### Section `tickets`

Un tableau, une entrée par catégorie de ticket. Chaque entrée a besoin au minimum de `id`, `label`, `title`, `description` ; `categoryId` (catégorie Discord où créer le salon) et `staffRoleId` (rôle qui aura accès) sont fortement recommandés. `{user}` dans `description` est remplacé par une mention du membre. Ajouter ou retirer une catégorie ne demande aucune modification de code — sauf pour la catégorie `architecture`, qui a un comportement spécial câblé par son `id`.

**Assignation (`assignment`)** — facultatif, par catégorie. Sa présence active les boutons Assigner / Statut et la commande `/assigner` pour cette catégorie (voir §1) :

```json
"assignment": {
  "architects": { "123456789012345678": "🦊" },
  "statuses": {
    "pending":    { "label": "En attente", "emoji": "⚪" },
    "inProgress": { "label": "En cours",   "emoji": "🟠" },
    "paid":       { "label": "Payé",       "emoji": "💰" },
    "done":       { "label": "Terminé",    "emoji": "✅" }
  }
}
```

- `architects` — ID Discord de chaque architecte → son emoji. Les architectes doivent aussi avoir le `staffRoleId` de la catégorie.
- `statuses` — facultatif ; seules ces quatre clés sont acceptées, et un label ou un emoji absent reprend la valeur par défaut ci-dessus.

### Section `missions`

- `checkIntervalMs` — fréquence à laquelle le bot vérifie s'il doit envoyer un rappel (30 000 ms par défaut).
- `retentionHours` — durée pendant laquelle une mission passée reste suivie avant d'être oubliée.
- `transientMessageDurationMs` — durée d'affichage des messages de confirmation temporaires.

### Section `ticketsSettings`

- `transcriptMessageLimit` — nombre max de messages inclus dans le transcript à la fermeture.
- `deleteDelayMs` — délai avant suppression du salon après fermeture.
- `closeLogsChannelId` — salon recevant le transcript complet des tickets fermés.

### Section `troll`

```json
"troll": {
  "enabled": true,
  "messageCount": 15,
  "delayMs": 800,
  "cooldownMs": 600000,
  "gifs": []
}
```

`enabled: false` désactive complètement la commande. Le bot impose toujours un maximum de 15 messages, un délai minimal de 800 ms entre deux messages, et un cooldown minimal d'une minute par cible, quels que soient les chiffres indiqués ici.

### Section `status`

```json
"status": {
  "channelId": "000000000000000000",
  "notificationRoleId": "000000000000000000",
  "open": {
    "channelName": "🟢-ouvert",
    "message": "Le Sprunk est **ouvert** ! Passez nous voir.",
    "image": "assets/statut-ouvert.png"
  },
  "closed": {
    "channelName": "🔴-fermé",
    "message": "Le Sprunk est actuellement **fermé**. À bientôt !",
    "image": "assets/statut-ferme.png"
  }
}
```

- `channelId` — le salon qui sert de panneau pour `/statut`. Obligatoire pour utiliser la commande. Le bot doit pouvoir y **gérer le salon** (renommage), envoyer des messages et lire l'historique.
- `notificationRoleId` — rôle mentionné en tête du panneau à chaque changement. Laisser vide (ou retirer le champ) pour ne mentionner personne.
- `open` / `closed` — nom du salon, message et image affichés pour chaque état. `\n` dans `message` crée un retour à la ligne. Discord met les noms de salon en minuscules et remplace les espaces par des tirets ; les emojis et les accents sont conservés.
- `image` — soit un fichier du dépôt (`assets/statut-ouvert.png` et `assets/statut-ferme.png` sont fournis : remplacez-les pour changer les visuels), soit une adresse `https://…`. Champ facultatif : sans lui, le panneau est publié sans image. Si le fichier est introuvable, le panneau est publié quand même et la commande vous le signale.
- Si `open` ou `closed` est absent, `/statut` fonctionne quand même à condition de renseigner les options `nom` et `message` à chaque fois.

### Section `rules`

```json
"rules": {
  "memberRoleId": "000000000000000000",
  "title": "📜 RÈGLEMENT",
  "warning": "⚠️ **PRÉNOM ET NOM OBLIGATOIRE** ⚠️",
  "items": ["Respectez les autres membres du serveur.", "Pas de contenu offensant…"],
  "note": "Les règles peuvent être modifiées à tout moment sans préavis.",
  "buttonLabel": "Lu et Approuvé"
}
```

- `memberRoleId` — rôle attribué par le bouton. Sans lui, le bouton répond qu'il n'est pas configuré et n'attribue rien.
- `items` — la liste des règles, numérotées automatiquement (1️⃣, 2️⃣…) dans l'ordre du tableau. Ajouter ou retirer une règle ne demande aucune modification de code.
- `title`, `warning`, `note`, `buttonLabel` — les textes autour de la liste. Mettre `""` pour `warning` ou `note` les retire.
- Section absente : le règlement par défaut (celui livré avec le bot) est publié, mais le bouton ne pourra pas attribuer de rôle tant que `memberRoleId` n'est pas renseigné.
- L'ensemble du règlement doit tenir dans les 4096 caractères d'un encadré Discord ; au-delà, la commande refuse de publier.

## 5. Problèmes courants

- **Les commandes slash n'apparaissent pas** — elles sont enregistrées sur le serveur défini par `bot.guildId` à chaque démarrage du bot ; vérifiez que le bot est bien connecté et que `guildId` est correct. Un redémarrage du bot force un nouvel enregistrement.
- **« Non autorisé »** sur une commande — vérifiez que le membre a le rôle attendu (`reassignRoleId` ou `distributorRoleId` selon la commande) ou est administrateur.
- **Un ticket ne se ferme pas** — le bouton Fermer est bloqué si une fermeture est déjà en cours sur ce salon (message « ⏳ Ce ticket est déjà en cours de fermeture »). Attendre la fin de la suppression du salon.
- **Un rôle staff « mal configuré »** — le `staffRoleId` de la catégorie dans `config.json` n'est pas un ID Discord valide ; corrigez-le dans `config.json`.
- **`/acquire` refuse d'agir** — la catégorie choisie a un `staffRoleId` invalide dans `config.json`. (Un salon déjà reconnu comme ticket n'est plus un refus : la commande le met à jour, voir §1.)
- **`/acquire silencieux:true` affiche quand même le menu** — le salon n'est pas rangé dans une catégorie Discord déclarée comme `categoryId` d'une catégorie de tickets ; déplacez le salon dans la bonne catégorie, ou choisissez simplement la catégorie dans le menu.
- **« Aucun emoji configuré » à l'assignation** — l'architecte a bien le rôle mais n'a pas d'entrée dans `assignment.architects` ; ajoutez son ID et son emoji dans `config.json` (rechargé à chaud).
- **Assigner / Statut / Renommer répond « ⏳ … réessayez dans X min »** — le ticket a déjà été renommé 2 fois dans les 10 dernières minutes (limite Discord). Attendre le délai indiqué.
- **`/statut` répond « ⏳ … réessayez dans X min »** — le salon de statut a déjà été renommé 2 fois dans les 10 dernières minutes (limite Discord). Attendre le délai indiqué.
- **Le bouton « Lu et Approuvé » n'attribue pas le rôle** — soit `rules.memberRoleId` n'est pas renseigné dans `config.json`, soit le rôle du bot est placé sous le rôle membre (ou il lui manque « Gérer les rôles »). Le message affiché au clic indique lequel des deux.
- **`/statut` reste longtemps sur « réfléchit… »** — le salon a été renommé récemment en dehors du bot (à la main, ou juste avant un redémarrage du bot) : Discord fait patienter le renommage jusqu'à 10 minutes, puis la commande aboutit d'elle-même.

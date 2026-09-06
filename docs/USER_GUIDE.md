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

### Transformer un salon existant en ticket (`/acquire`)

Si un salon a été créé autrement que par le panel — manuellement, par un autre bot, ou avant l'installation de SPRUNK — il n'est pas reconnu comme un ticket : aucun des boutons ci-dessus ne fonctionne dessus. `/acquire` permet de le rattacher :

1. Se placer dans le salon à convertir.
2. Lancer `/acquire proprietaire:@membre`, en indiquant le membre qui doit être considéré comme le propriétaire du ticket.
3. Choisir la catégorie dans le menu qui apparaît (les mêmes catégories que dans le panel).

Le bot réinitialise alors les permissions du salon comme un ticket normal (propriétaire, rôle staff, bot), enregistre le sujet du salon pour que **Fermer / Réassigner / Renommer / Ajouter / Retirer** fonctionnent, poste le message de ticket avec ses boutons, et journalise l'acquisition dans le salon de logs.

`/acquire` est réservée aux administrateurs et au rôle `reassignRoleId`, et refuse d'agir si le salon est déjà un ticket géré par le bot.

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
| `/acquire` | Transforme le salon courant en ticket géré par le bot (voir §1) | Administrateurs ou rôle `reassignRoleId` |
| `/troll` | Envoie une courte rafale de messages privés à une cible, avec un cooldown | Administrateurs ou rôle `reassignRoleId` — **et seulement si activée dans `config.json`** |

`/troll` est **désactivée par défaut**. Voir §4 pour l'activer.

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

## 5. Problèmes courants

- **Les commandes slash n'apparaissent pas** — elles sont enregistrées sur le serveur défini par `bot.guildId` à chaque démarrage du bot ; vérifiez que le bot est bien connecté et que `guildId` est correct. Un redémarrage du bot force un nouvel enregistrement.
- **« Non autorisé »** sur une commande — vérifiez que le membre a le rôle attendu (`reassignRoleId` ou `distributorRoleId` selon la commande) ou est administrateur.
- **Un ticket ne se ferme pas** — le bouton Fermer est bloqué si une fermeture est déjà en cours sur ce salon (message « ⏳ Ce ticket est déjà en cours de fermeture »). Attendre la fin de la suppression du salon.
- **Un rôle staff « mal configuré »** — le `staffRoleId` de la catégorie dans `config.json` n'est pas un ID Discord valide ; corrigez-le dans `config.json`.
- **`/acquire` refuse d'agir** — soit le salon est déjà reconnu comme un ticket (topic déjà rattaché), soit la catégorie choisie a un `staffRoleId` invalide dans `config.json`.

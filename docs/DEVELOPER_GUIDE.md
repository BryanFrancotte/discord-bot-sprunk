# Guide développeur — SPRUNK Bot

Ce document explique comment le bot est câblé et comment y travailler sans tout redécouvrir depuis zéro. Le `README.md` reste la référence pour l'installation ; ce guide est pour la suite : ajouter une commande, un service, un type de ticket, écrire des tests.

> Ce fichier documente le code. Quand une PR change le comportement décrit ici (nouvelle commande, nouveau service, nouvelle règle métier), mettez cette page à jour dans la même PR — voir [CLAUDE.md](../CLAUDE.md).

## 1. Vue d'ensemble

```
src/
├── index.js         Point d'entrée : charge .env, acquiert le verrou, démarre le client
├── core/             SprunkClient (le client Discord), ConfigService, InstanceLock
├── events/           Un fichier par événement Discord, chacun délègue à un service
├── commands/         Un fichier par commande slash, auto-découverts au démarrage
├── services/         Toute la logique métier (tickets, missions, rappels, logs, stockage)
└── utils/            Fonctions pures sans état (dates, permissions, texte, réponses d'erreur)
```

Règle de dépendance à retenir : **`events/` et `commands/` ne contiennent quasiment aucune logique.** Ils lisent l'interaction, vérifient parfois une permission, puis appellent une méthode de `client.services.*`. Toute la logique (créer un salon, construire un transcript, calculer un rappel) vit dans `services/`. Si vous ajoutez plus de 5-10 lignes de logique dans un event ou une commande, c'est probablement mal placé — déplacez-la dans un service.

## 2. Cycle de vie au démarrage

1. `src/index.js` charge `.env`, force le fuseau `Europe/Paris`, puis :
   - `InstanceLock.acquire()` — écrit `.bot.lock` avec le PID courant ; si un lock existant pointe vers un process vivant, le démarrage échoue (empêche deux instances de s'enregistrer en double auprès de Discord).
   - `ConfigService.load()` — lit et valide `config.json` (voir §5).
   - `new SprunkClient({ configService, token, dataDirectory })` puis `client.start()`.
2. `SprunkClient.start()` appelle `initialize()` puis `login(token)`.
3. `initialize()` :
   - crée les deux `JsonStore` (`data/missions.json`, `data/ticket-logs.json`) ;
   - instancie tous les services dans `this.services = { ... }` (voir §3) ;
   - appelle `registerEvents(this)` — attache les listeners Discord ;
   - démarre la surveillance à chaud de `config.json`.
4. Une fois connecté, `events/ready.js` enregistre les commandes slash sur le serveur (`bot.guildId`) et démarre `ReminderService`.

`SprunkClient` fait office de petit conteneur d'injection de dépendances : tout service reçoit `client` (donc `client.config`, `client.services.*`) plutôt que d'aller chercher un singleton global. Gardez ce style pour tout nouveau service.

## 3. Les services

| Service | Rôle | Fichier |
|---|---|---|
| `commandRegistry` | Enregistre les slash commands via l'API REST Discord | `services/CommandRegistry.js` |
| `discordLogs` | Envoie un embed dans le salon de logs (`bot.logsChannelId`) | `services/DiscordLogService.js` |
| `ticketLogs` | Persiste l'historique des tickets fermés (JSON, 500 max) | `services/TicketLogService.js` |
| `tickets` | Tout le cycle de vie d'un ticket : panel, création, fermeture, transcript, réassignation | `services/TicketService.js` |
| `missions` | Création de missions, gestion des réactions ✅/🟡 | `services/MissionService.js` |
| `reminders` | Boucle périodique qui envoie les rappels 15 min / 5 min / maintenant | `services/ReminderService.js` |
| `troll` | Envoi de messages privés limités, avec cooldown | `services/TrollService.js` |
| `rules` | Publication du règlement et attribution du rôle membre via le bouton `rules:accept` | `services/RulesService.js` |
| `assignment` | Assignation d'un ticket à un architecte et statut du ticket, portés par les emojis de tête/fin du nom du salon (boutons `ticket:assign` / `ticket:status`, commande `/assigner`) | `services/TicketAssignmentService.js` |
| `status` | Panneau ouvert/fermé : renomme le salon `status.channelId`, publie le panneau (mention de rôle + image) et supprime le précédent | `services/StatusService.js` |

Un service ne connaît que `client` et, si besoin, un `JsonStore` ou un autre service injecté au constructeur (voir `TicketService(client, ticketLogService, discordLogService)`). Il n'importe jamais directement `events/` ni `commands/`.

## 4. Ajouter une fonctionnalité

### Ajouter une commande slash

1. Créez `src/commands/ma-commande.js` :

   ```js
   'use strict';

   const { SlashCommandBuilder, MessageFlags } = require('discord.js');
   const { canManageBot } = require('../utils/permissions');

   module.exports = {
       data: new SlashCommandBuilder()
           .setName('ma-commande')
           .setDescription('Ce que ça fait'),

       async execute(client, interaction) {
           if (!canManageBot(interaction.member, client.config)) {
               return interaction.reply({ content: '❌ Non autorisé.', flags: MessageFlags.Ephemeral });
           }
           // logique déléguée à un service : client.services.xyz.faireLaChose(...)
       }
   };
   ```

2. C'est tout — `src/commands/index.js` charge automatiquement tout fichier `.js` du dossier (sauf `index.js`). Rien à enregistrer à la main.
3. Ajoutez le nom de la commande à l'assertion de `test/commands.test.js` (`names.sort()`), sinon le test échouera volontairement — c'est un garde-fou pour repérer les doublons de nom.

### Ajouter une catégorie de ticket

Aucune modification de code n'est nécessaire pour une catégorie « simple » : ajoutez une entrée dans le tableau `tickets` de `config.json` (id, label, emoji, categoryId, staffRoleId, title, description, details, waitMessage). `ConfigService.validate()` vérifie que chaque entrée a bien `id`, `label`, `title`, `description` et que les `id` sont uniques ; le rechargement à chaud reprend cette validation.

Si la catégorie a besoin d'un comportement spécial (comme le questionnaire modal d'« architecture »), suivez le patron de `TicketService.needsArchitectureQuestionnaire` / `showArchitectureQuestionnaire` / `createArchitectureTicket` : détectez la catégorie par son `id`, montrez un `ModalBuilder`, puis appelez les mêmes helpers partagés que le flux standard (`createTicketChannel`, `sendTicketChannelMessage`) pour éviter de dupliquer la création de salon.

### Assignation et statut d'un ticket

Une catégorie active l'assignation en déclarant un bloc `assignment` (pas de câblage par `id`). La logique pure vit dans `utils/ticketAssignment.js` et est testée sans Discord (`test/ticketAssignment.test.js`) :

- `getAssignmentConfig(ticketConfig)` — `null` si la catégorie n'a pas d'assignation, sinon `{ architects, statuses }` avec les statuts par défaut complétés (`pending`, `inProgress`, `paid`, `done`, clés fixes validées par `ConfigService.validateAssignment`).
- `splitChannelName` / `buildChannelName` — le **nom du salon est la seule source de vérité** : emoji en tête = architecte, emoji en fin = statut. C'est sûr parce que la base passe toujours par `sanitizeChannelName`, qui ne produit jamais d'emoji. Aucun état n'est stocké ailleurs (ni topic, ni JSON).
- `resolveAssignee` / `canChangeStatus` — règles de permission (staff : tout architecte ; architecte : lui-même ; statut : staff ou `staffRoleId`).

`TicketService` pose l'emoji « En attente » à la création, ajoute la rangée de boutons via `buildTicketComponents` (la rangée principale est déjà à 5 boutons, le maximum Discord), et conserve les emojis dans `renameTicket`. Tout renommage de ticket passe par `TicketService.renameChannel`, qui applique le `RenameLimiter` partagé (`utils/renameLimiter.js`, aussi utilisé par `StatusService`).

### Faire persister un choix entre deux interactions

Une commande slash et le composant qu'elle affiche (menu, bouton) sont deux interactions Discord séparées — on ne peut pas garder une variable en mémoire entre les deux. Le patron du projet est d'encoder l'information dans le `customId` du composant plutôt que dans un état serveur.

Exemple : `/acquire` (`commands/acquire.js`) capture le propriétaire choisi, puis `TicketService.showAcquireCategoryMenu` construit un menu dont le `customId` est `ticket:acquire-confirm:<ownerId>`. Quand le menu est utilisé, `interactionCreate.js` retrouve l'ID avec `customId.slice('ticket:acquire-confirm:'.length)` et le repasse à `TicketService.acquireChannel`. Même logique que le topic d'un ticket (`sprunk-ticket|owner=...|category=...`, §9) : plutôt qu'une session en mémoire qui ne survivrait pas à un redémarrage, l'état nécessaire est toujours ré-encodé dans ce que Discord retransmet (`customId`, `topic`).

Si vous ajoutez un nouveau menu/bouton qui a besoin d'un contexte (un ID, une catégorie…), suivez ce patron plutôt que d'introduire une `Map` en mémoire côté service — sauf si l'état doit justement survivre à l'interaction (voir `TicketService.closingTickets` pour un cas où une `Map` en mémoire est le bon choix, parce qu'elle ne fait que dédupliquer des clics rapprochés, pas porter une donnée métier).

### Ajouter un nouveau service

1. Créez `src/services/MonService.js`, classe simple avec un constructeur `(client, ...dépendances)`.
2. Instanciez-le dans `SprunkClient.initialize()` et exposez-le via `this.services.monService = ...`.
3. Appelez-le depuis un event ou une commande — jamais l'inverse.

### Persister des données

Utilisez `JsonStore` (`services/JsonStore.js`) plutôt que d'écrire un fichier à la main :

```js
const store = new JsonStore(path.join(dataDirectory, 'mon-fichier.json'), { items: [] });
await store.initialize();
await store.update(data => { data.items.push(nouvelItem); });
```

`JsonStore.update()` sérialise chaque lecture/écriture derrière une file de promesses (`this.queue`) : deux appels concurrents ne se marchent jamais dessus et n'écrasent jamais le fichier à moitié écrit. Ne réimplémentez pas une file d'attente maison ailleurs — si un autre service a besoin du même genre de sérialisation par clé (voir `MissionService.enqueueReaction`), inspirez-vous de ce patron plutôt que de partager l'état entre requêtes concurrentes sans verrou.

## 5. Configuration (`config.json`)

`ConfigService` charge le fichier, le valide (`bot.guildId` doit être un ID Discord, `tickets` doit être un tableau non vide de 25 entrées max avec des `id` uniques), puis expose `client.config`. Un `fs.watchFile` (intervalle 1s) recharge automatiquement une modification valide et **ignore silencieusement** (avec un message d'erreur en console) une modification invalide — l'ancienne config reste active. N'ajoutez jamais de valeur par défaut « magique » dans le code pour compenser un champ manquant : si un champ devient obligatoire, ajoutez la vérification dans `ConfigService.validate()` pour que l'échec soit clair au chargement plutôt qu'une exception plus tard dans un handler d'interaction.

**Écrire la configuration** : passez toujours par `ConfigService.save(nextConfig)`, jamais par un `fs.writeFile` direct sur `config.json`. `save()` valide **avant** d'écrire (une config invalide n'atteint donc jamais le disque), écrit dans `config.json.tmp` puis fait un `rename()` — un lecteur concurrent ne peut pas tomber sur un JSON tronqué —, et met à jour la copie en mémoire dans la foulée. `load()` et `save()` mémorisent le contenu brut dans `loadedRaw` : le watcher compare ce contenu avant de recharger, ce qui évite de re-parser (et de logguer « config.json rechargé ») après nos propres écritures.

**Cycle de vie du fichier** : `config.json` est propre à chaque installation, donc ignoré par Git et exclu du `rsync --delete` de `.github/workflows/deploy.yml` — sans quoi chaque déploiement écraserait la configuration de production. Le dépôt ne versionne que le modèle `config.example.json` ; l'étape « Seed configuration on first deploy » le copie sur la machine cible uniquement si `config.json` est absent. **Conséquence** : un nouveau champ de configuration doit être ajouté à `config.example.json` *et* documenté, car il n'arrivera pas tout seul sur les installations existantes — prévoyez qu'il puisse être absent (`ConfigService.validate()` pour un champ obligatoire, lecture défensive sinon).

## 6. Conventions de code

- **Pas de commentaires** sauf pour une contrainte non évidente (voir `JsonStore.initialize` ou `parseParisDate` pour des exemples de ce qui mérite un commentaire).
- **Gestion d'erreur centralisée** : `interactionCreate.js` encapsule tout dans un `try/catch` qui appelle `replyWithError(interaction)` (`utils/async.js`). Les services n'ont pas besoin de re-catcher une erreur juste pour logguer puis la relancer — laissez-la remonter.
- **Permissions** : toujours passer par `utils/permissions.js` (`isAdministrator`, `hasRole`, `canManageBot`) plutôt que de re-tester `interaction.member.permissions` à la main.
- **IDs Discord** : validez avec `isDiscordId()` (`utils/config.js`) avant d'utiliser un ID venant de `config.json` — beaucoup de champs sont optionnels et peuvent être vides ou mal renseignés par un admin.
- **Ephemeral** : toute réponse qui ne concerne que l'utilisateur courant (erreurs, menus de choix) utilise `flags: MessageFlags.Ephemeral`.

## 7. Tests

```powershell
npm run check   # vérifie la syntaxe de tous les fichiers .js (scripts/check-syntax.js)
npm test        # exécute la suite node:test (test/*.test.js)
```

Le projet utilise `node:test` natif, sans framework de mock — les services sont testés en les instanciant avec des objets `client`/`interaction` minimalistes faits à la main (voir `test/commands.test.js` et `test/missionService.test.js` pour le style attendu). Pas de base de données ni de vrai client Discord dans les tests : `TicketService.buildTranscript`, `buildTicketControlsRow`, `buildTicketPermissionOverwrites` sont volontairement des méthodes pures/faciles à isoler pour ça — si vous ajoutez de la logique similaire, gardez-la extractible de la même façon plutôt que noyée dans une méthode qui appelle directement l'API Discord.

Quand vous touchez à un service, ajoutez au minimum un test qui couvre la nouvelle branche logique — la suite actuelle n'appelle jamais l'API Discord réelle, donc chaque test doit rester rapide et déterministe.

## 8. Dette technique connue (assumée, pas oubliée)

- **Persistance en fichiers JSON plats** (`data/*.json`) plutôt qu'une base de données. Choix délibéré tant que le bot tourne sur un seul serveur avec un volume modeste de tickets/missions. À revisiter si le bot doit gérer plusieurs serveurs ou un fort volume — voir la discussion dans l'historique du projet avant de migrer vers SQLite ou autre.
- **État en mémoire non persisté** (`TicketService.closingTickets`, `TrollService.cooldowns`, les `RenameLimiter` de `StatusService` et `TicketService`) : réinitialisé à chaque redémarrage. C'est voulu — un redémarrage signifie qu'aucune fermeture n'est réellement « en cours », donc repartir à zéro est correct.
- **`RenameLimiter` (`utils/renameLimiter.js`) ne voit que les renommages faits par le bot depuis son démarrage.** Discord limite le renommage d'un salon à 2 par tranche de 10 minutes, et discord.js met alors la requête en file d'attente au lieu d'échouer : le compteur sert à refuser proprement avant d'atteindre cette attente. Un renommage manuel, ou antérieur à un redémarrage, n'est pas compté ; dans ce cas la commande attend simplement. C'est pourquoi `updateStatus` (et de même l'assignation, le statut et le renommage de ticket) fait son `deferReply` avant tout appel à Discord (l'interaction reste valide 15 minutes) et renomme **avant** de toucher au message, pour qu'un refus ou une erreur ne laisse jamais un panneau à moitié mis à jour.
- **`ReminderService`/`MissionService` refont un fetch complet du salon/message à chaque tick** plutôt que de mettre en cache. Acceptable au volume actuel de missions ; à revoir seulement si ça devient un goulot d'étranglement mesuré.

## 9. Où trouver quoi

- Comportement d'une commande → `src/commands/<nom>.js`, puis le service qu'elle appelle.
- Format du topic d'un salon ticket (`sprunk-ticket|owner=...|category=...`) → `TicketService.buildTopic` / `parseTopic`.
- Calcul des dates Paris (heure d'été/hiver) → `utils/date.js`, testé dans `test/date.test.js`.
- Qui a le droit de faire quoi → `utils/permissions.js` + les champs `reassignRoleId` / `distributorRoleId` de `config.json`.
- Visuels du panneau de statut → `assets/`, référencés par `status.<état>.image` dans `config.json` (chemin relatif à la racine du dépôt, ou URL `https://`). `StatusService.resolveImage` joint le fichier local (`attachment://`) ou passe l'URL telle quelle ; un fichier absent n'empêche pas la publication. Ces images sont versionnées et déployées avec le code, contrairement à `config.json`.
- Pourquoi le panneau est republié au lieu d'être modifié → une modification de message ne déclenche aucune notification Discord ; `StatusService.updateStatus` republie donc le panneau (avec la mention de rôle) puis supprime l'ancien, qu'il n'identifie comme sien que s'il en est l'auteur **et** que le message porte un embed.

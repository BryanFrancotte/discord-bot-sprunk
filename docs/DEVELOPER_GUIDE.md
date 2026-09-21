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

### Acquérir un salon existant (`/acquire`)

`TicketService.acquireChannel(interaction, categoryId, ownerId, options)` sert deux appelants avec la même méthode :

- depuis le menu de catégorie (interaction de composant) — l'appelant ne passe rien, la méthode fait elle-même le `deferUpdate()` ;
- depuis `/acquire silencieux:true` (interaction de commande, déjà `deferReply`) — l'appelant passe `{ deferred: true }`.

Dans les deux cas la réponse finale passe par `interaction.editReply({ content, components: [] })`, ce qui retire le menu s'il y en avait un. Le mode silencieux (`{ silent: true }`) ne change que deux choses : la catégorie est déduite du salon au lieu d'être demandée, et le message de ticket est posté sans mention (`allowedMentions: { parse: [] }`) et sans notification (`MessageFlags.SuppressNotifications`). La journalisation reste identique à une acquisition normale.

**`applyTicketPermissions` ne retire jamais l'accès d'un membre, et aligne les rôles sur la catégorie** — règle valable pour les deux cas d'`acquireChannel` (première acquisition comme mise à jour) **et pour `reassignTicket`**, qui l'appelle avec la catégorie cible et le propriétaire du topic. Trois conséquences dans le code, à ne pas « simplifier » :

- **jamais `permissionOverwrites.set`**, toujours un `edit` par entrée. `set` remplace la liste entière côté API (il ne fusionne pas) et supprimerait tout overwrite absent des entrées du ticket : l'ouvreur du salon et les membres ajoutés via ➕ Ajouter en premier. C'est le bug décrit dans `docs/BUGFIX_ACQUIRE_PERMISSIONS.md` ;
- **l'entrée `@everyone` de `buildTicketPermissionOverwrites` est filtrée** (`overwrite.id !== interaction.guild.id`), et l'overwrite `@everyone` existant est conservé : y toucher changerait la visibilité du salon. Un salon rangé dans la catégorie Discord du ticket hérite de toute façon déjà du refus de sa catégorie ;
- **les overwrites de rôles en trop sont supprimés un par un** (`permissionOverwrites.delete`), **après** les trois `edit` (propriétaire, `staffRoleId` de la catégorie, bot) pour que le staff et le bot ne perdent jamais l'accès en cours de route. La liste vient de `findObsoleteRoleOverwriteIds(cache, [guild.id, staffRoleId])` (`utils/ticketPermissions.js`), qui ne retourne **que** des overwrites `OverwriteType.Role` : c'est ce filtre de type, et non une liste de membres à protéger, qui garantit qu'aucun membre n'est touché.

La méthode retourne `{ removedRoleIds }`, qu'`acquireChannel` affiche dans la réponse éphémère et dans le log, et `reassignTicket` dans sa confirmation éphémère. `buildTicketPermissionOverwrites` sert à tous les chemins — tel quel à `guild.channels.create` (ouverture par le panel, où le salon est neuf et le refus `@everyone` indispensable), filtré à l'acquisition et à la réassignation.

Tout nouveau code qui doit « remettre d'aplomb » les permissions d'un ticket existant passe par `applyTicketPermissions` plutôt que par des `edit`/`delete` écrits à la main : l'ancienne boucle de `reassignTicket` supprimait l'ancienne équipe **avant** de donner les nouveaux accès, et un `edit` sans `type` qui plantait laissait le salon sans personne dedans (`docs/BUGFIX_REASSIGN_PERMISSIONS.md`).

Sur un salon **déjà géré** (`parseTopic(channel.topic)` non nul), `acquireChannel` ne refuse pas : `isUpdate` bascule la méthode en mise à jour, ce qui permet de réécrire l'embed d'un ticket existant. Deux différences seulement :

- `setTopic` n'est appelé que si le topic change réellement (il est soumis à la même limite Discord que le renommage) ;
- libellés du log, de l'embed et de la réponse éphémère (`♻️ TICKET MIS À JOUR` / « mis à jour »).

`commands/acquire.js` relit le topic pour en tirer les valeurs par défaut : propriétaire actuel et catégorie actuelle, cette dernière prioritaire sur `findTicketConfigByChannelCategory` en mode silencieux.

Le propriétaire est choisi par `TicketService.resolveAcquireOwner(interaction, chosenOwnerId, metadata)`, qui retourne `{ ownerId, note }`. Priorité : option `proprietaire` → propriétaire du topic → ouvreur déduit → auteur de la commande. La déduction passe par `findProbableOwnerId(overwrites, excludedIds)` (`utils/ticketPermissions.js`) : le seul overwrite `OverwriteType.Member` autorisant `ViewChannel`, hors bot, auteur de la commande et bots présents dans `client.users.cache` ; aucun ou plusieurs candidats ⇒ `null`, on ne devine pas. Dans les deux derniers cas `note` explique le choix au staff ; elle est transmise en option `ownerNote` à `showAcquireCategoryMenu` (au-dessus du menu) ou à `acquireChannel` (mode silencieux, en fin de réponse). Elle ne passe pas par le `customId` : en mode menu, le staff l'a déjà lue au moment de choisir la catégorie.

`buildTicketPermissionOverwrites` déclare un `type` explicite (`OverwriteType.Role` / `OverwriteType.Member`) sur chaque entrée, et `applyTicketPermissions` le repasse à `edit` ; partout ailleurs où le code appelle `permissionOverwrites.edit` (aujourd'hui `addUsersToTicket`), le `type` doit être passé de la même façon. Sans lui, discord.js résout l'ID via son cache local (`guild.roles.cache` puis `client.users.cache`) et lève `InvalidType` sur un propriétaire relu du topic que le bot n'a pas vu récemment — c'est la cause racine décrite dans `docs/BUGFIX_REASSIGN_PERMISSIONS.md`, corrigée pour `reassignTicket` en le faisant passer par `applyTicketPermissions`.

Les deux helpers purs correspondants sont dans `utils/ticketMessages.js` (testés dans `test/ticketAcquire.test.js`) :

- `findTicketConfigByChannelCategory(tickets, parentId)` — déduit la catégorie du ticket de la catégorie Discord qui contient le salon, en comparant à `categoryId`. `null` ⇒ `/acquire` retombe sur le menu.
- `findTicketControlsMessage(messages, botId)` / `isTicketControlsMessage` — retrouvent le message à boutons déjà posté par le bot dans le salon. Le marqueur est le bouton `ticket:close`, présent sur toutes les variantes de `buildTicketComponents` ; en cas de doublons c'est le **plus ancien** qui est retenu (le plus haut dans l'historique).

`sendTicketChannelMessage(..., { silent, reuseExisting })` centralise l'envoi et retourne `{ message, reused }`. Avec `reuseExisting: true` (seul `acquireChannel` l'active), il édite le message existant au lieu d'en poster un second — Discord ne permettant pas d'insérer un message ailleurs qu'à la fin d'un salon, c'est la seule façon de garder un message à boutons unique et haut placé. Les créations de ticket ne l'activent pas : le salon vient d'être créé, la requête d'historique serait un appel API inutile.

### Faire persister un choix entre deux interactions

Une commande slash et le composant qu'elle affiche (menu, bouton) sont deux interactions Discord séparées — on ne peut pas garder une variable en mémoire entre les deux. Le patron du projet est d'encoder l'information dans le `customId` du composant plutôt que dans un état serveur.

Exemple : `/acquire` (`commands/acquire.js`) capture le propriétaire choisi et le mode silencieux, puis `TicketService.showAcquireCategoryMenu` construit un menu dont le `customId` est produit par `buildAcquireCustomId` (`ticket:acquire-confirm:<ownerId>`, suffixé `:silent` en mode silencieux). Quand le menu est utilisé, `interactionCreate.js` relit les deux informations avec `TicketService.parseAcquireCustomId` et les repasse à `TicketService.acquireChannel`. Même logique que le topic d'un ticket (`sprunk-ticket|owner=...|category=...`, §9) : plutôt qu'une session en mémoire qui ne survivrait pas à un redémarrage, l'état nécessaire est toujours ré-encodé dans ce que Discord retransmet (`customId`, `topic`).

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
- **`/acquire` ne rend pas privé le salon qu'il acquiert** (voir §4) : l'overwrite `@everyone` n'est jamais touché. Un salon public acquis reste donc public tant qu'il n'est pas rangé dans la catégorie Discord du ticket. Assumé ; si le cas devient gênant, la bonne réponse est de le signaler dans la réponse éphémère de `/acquire`, pas de reposer le refus en douce.
- **La déduction de l'ouvreur (`findProbableOwnerId`) ne reconnaît les autres bots que s'ils sont dans `client.users.cache`.** Un bot tiers absent du cache et ayant un accès individuel au salon compte comme candidat : on tombe alors sur « plusieurs candidats » et l'auteur de la commande devient propriétaire, avec la note qui le signale. Jamais de mauvais propriétaire silencieux, donc acceptable ; un `guild.members.fetch` des candidats lèverait l'ambiguïté au prix d'un appel API.
- **`ReminderService`/`MissionService` refont un fetch complet du salon/message à chaque tick** plutôt que de mettre en cache. Acceptable au volume actuel de missions ; à revoir seulement si ça devient un goulot d'étranglement mesuré.

## 9. Où trouver quoi

- Comportement d'une commande → `src/commands/<nom>.js`, puis le service qu'elle appelle.
- Format du topic d'un salon ticket (`sprunk-ticket|owner=...|category=...`) → `TicketService.buildTopic` / `parseTopic`.
- Retrouver/déduire les éléments d'une acquisition (catégorie déduite du salon, message à boutons existant) → `utils/ticketMessages.js` ; rôles à retirer et ouvreur probable du salon → `utils/ticketPermissions.js`.
- Calcul des dates Paris (heure d'été/hiver) → `utils/date.js`, testé dans `test/date.test.js`.
- Qui a le droit de faire quoi → `utils/permissions.js` + les champs `reassignRoleId` / `distributorRoleId` de `config.json`.
- Visuels du panneau de statut → `assets/`, référencés par `status.<état>.image` dans `config.json` (chemin relatif à la racine du dépôt, ou URL `https://`). `StatusService.resolveImage` joint le fichier local (`attachment://`) ou passe l'URL telle quelle ; un fichier absent n'empêche pas la publication. Ces images sont versionnées et déployées avec le code, contrairement à `config.json`.
- Pourquoi le panneau est republié au lieu d'être modifié → une modification de message ne déclenche aucune notification Discord ; `StatusService.updateStatus` republie donc le panneau (avec la mention de rôle) puis supprime l'ancien, qu'il n'identifie comme sien que s'il en est l'auteur **et** que le message porte un embed.

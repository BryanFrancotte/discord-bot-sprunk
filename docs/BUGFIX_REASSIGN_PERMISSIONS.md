# Bug : `/réassigner` vide le ticket de tout accès

> **Statut : corrigé.** `reassignTicket` passe désormais par `TicketService.applyTicketPermissions`,
> la même méthode que `/acquire` : `type` explicite sur chaque `edit`, accès donnés **avant** tout
> retrait, aucun membre éjecté, rôles alignés sur la nouvelle catégorie, `@everyone` intouché.
> Voir « Correctif retenu » en fin de document ; la section « Correctif » ci-dessous est l'analyse
> initiale, qui ne traitait que le `type`.

## Symptôme

Après avoir cliqué sur **Réassigner** puis choisi une catégorie, le salon de ticket se retrouve sans accès pour personne (ni le propriétaire, ni l'ancienne équipe, ni la nouvelle) — seul le bot garde l'accès. Une erreur générique (« ❌ Une erreur inattendue est survenue. ») apparaît côté staff.

## Cause racine

`TicketService.reassignTicket` (`src/services/TicketService.js`, autour des lignes 493-508) :

```js
await interaction.channel.permissionOverwrites.edit(metadata.ownerId, { ... });   // ligne 493
await interaction.channel.permissionOverwrites.edit(target.staffRoleId, { ... }); // ligne 500
await interaction.channel.setTopic(...);                                          // ligne 508
```

`metadata.ownerId` est un ID brut extrait du **topic** du salon (écrit à la création du ticket, parfois des jours avant). Pour exécuter `.edit(id, ...)`, discord.js doit d'abord deviner si cet ID est un rôle ou un membre — et il le fait en cherchant dans son **cache local** (`guild.roles.cache` puis `client.users.cache`), jamais via l'API Discord. Les rôles sont toujours en cache, mais un utilisateur ne l'est que si le bot l'a « vu » récemment (message, réaction, interaction...). Discord.js purge aussi régulièrement les utilisateurs inactifs du cache par défaut.

Si le propriétaire du ticket n'a rien fait récemment (ou que le bot a redémarré depuis), son objet `User` n'est plus en cache. `permissionOverwrites.edit()` lève alors :

```
DiscordjsTypeError [InvalidType]: Supplied parameter is not a User nor a Role.
```

(voir `PermissionOverwriteManager#upsert` dans `node_modules/discord.js/src/managers/PermissionOverwriteManager.js`)

Cette erreur n'est pas rattrapée dans `reassignTicket` : elle remonte jusqu'au `try/catch` générique de `interactionCreate.js`, qui affiche juste un message d'erreur vague. Le problème, c'est l'état dans lequel le salon est laissé au moment du crash :

1. Le salon a déjà été déplacé vers la nouvelle catégorie (OK).
2. La boucle juste avant a déjà **supprimé l'overwrite de l'ancienne équipe** (OK, voulu).
3. Le crash empêche de réatteindre la ligne qui redonne l'accès au propriétaire (jamais exécutée).
4. Et donc aussi la ligne qui donne l'accès à la nouvelle équipe (jamais exécutée).

Résultat : plus personne n'a d'overwrite d'accès sur le salon à part le bot — ce qui ressemble exactement à « tout le monde est éjecté ». Ça se reproduit de façon fiable dès que le propriétaire du ticket n'a pas interagi récemment avec le bot — donc typiquement pour un ticket qui traîne un peu avant d'être réassigné.

## Correctif

`PermissionOverwriteManager#edit()` accepte un 3ᵉ argument qui permet d'indiquer le type directement, sans passer par le cache (c'est documenté dans le code source comme échappatoire prévue pour ce cas précis).

`OverwriteType` est exporté par `discord.js` (`OverwriteType.Role === 0`, `OverwriteType.Member === 1`).

```js
const { OverwriteType /* + le reste des imports existants */ } = require('discord.js');

// ...

await interaction.channel.permissionOverwrites.edit(metadata.ownerId, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    AttachFiles: true,
    EmbedLinks: true
}, { type: OverwriteType.Member, reason: `Ticket réassigné par ${interaction.user.tag}` });

await interaction.channel.permissionOverwrites.edit(target.staffRoleId, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    AttachFiles: true,
    EmbedLinks: true,
    ManageMessages: true
}, { type: OverwriteType.Role, reason: `Ticket réassigné par ${interaction.user.tag}` });
```

Avec `type` fourni explicitement, `upsert()` saute la résolution `guild.roles.resolve(...) ?? client.users.resolve(...)` et envoie directement la requête à l'API Discord, qui n'a pas besoin que l'utilisateur soit en cache côté bot.

## À vérifier par la même occasion

Le même risque (ID brut + pas de `type` explicite = dépendant du cache) existe partout ailleurs où le code appelle `permissionOverwrites.edit/create/set` avec un ID qui n'est pas garanti fraîchement en cache :

- `TicketService.addUsersToTicket` / `removeUsersFromTicket` — risque plus faible, les ID viennent d'un `UserSelectMenu` résolu dans la même interaction.
- `buildTicketPermissionOverwrites` (ouverture d'un ticket par le panel via `guild.channels.create`, puis acquisition et réassignation via `applyTicketPermissions`) : chaque entrée porte désormais un `type` explicite, repassé à `edit` — le besoin de cache est levé sur ce chemin. Le `set` global de l'acquisition a disparu (voir `docs/BUGFIX_ACQUIRE_PERMISSIONS.md`).

## Correctif retenu

Au-delà du `type` manquant, l'analyse ci-dessus montre un second défaut, d'ordre : l'ancienne boucle **supprimait l'ancienne équipe avant** de donner l'accès au propriétaire et à la nouvelle équipe. N'importe quelle erreur entre les deux laissait le salon vide.

Plutôt que de rapiécer les deux `edit`, `reassignTicket` appelle maintenant `applyTicketPermissions(channel, interaction, target, metadata.ownerId, reason)`, qui règle les deux défauts d'un coup :

1. trois `edit` avec `type` explicite (propriétaire, `staffRoleId` de la catégorie cible, bot) ;
2. **puis** suppression des overwrites de rôles autres que `@everyone` et la nouvelle équipe — l'ancienne équipe en fait partie, comme avant, mais aussi tout rôle ajouté à la main ;
3. aucun overwrite de membre n'est jamais supprimé : les membres ajoutés via ➕ Ajouter restent dans le ticket.

Les rôles retirés sont listés dans la confirmation éphémère. Tests : `test/ticketReassign.test.js`, dont un qui simule l'échec de l'`edit` du propriétaire et vérifie que l'ancienne équipe a gardé son accès.

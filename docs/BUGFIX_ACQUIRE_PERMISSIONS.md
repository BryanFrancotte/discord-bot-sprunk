# Bug : `/acquire` éjecte les membres ajoutés et l'ouvreur du salon

> **Statut : corrigé.** `/acquire` ne retire plus jamais l'accès d'un membre, aligne les rôles
> sur la catégorie du ticket, et déduit l'ouvreur du salon comme propriétaire par défaut.
> Voir « Correctifs retenus ».

## Symptôme

Après `/acquire` sur un salon existant, les personnes qui avaient accès au salon avant l'acquisition n'y ont plus accès : celles qui avaient été ajoutées manuellement (ou via ➕ Ajouter d'un autre ticket) **et** la personne qui avait ouvert le salon. Seuls le propriétaire passé à la commande, le rôle staff de la catégorie et le bot restent dedans.

## Reproduction

1. Un salon existe avec plusieurs membres ayant un accès individuel (créé à la main, par un autre bot, ou ticket d'une ancienne version).
2. Un membre du staff lance `/acquire` dans ce salon (sans l'option `proprietaire`).
3. Tous les membres disparaissent du salon, sauf le staff de la catégorie choisie et l'auteur de la commande.

## Cause racine

Deux causes qui se cumulaient.

### 1. `permissionOverwrites.set()` remplace **toute** la liste

`TicketService.applyTicketPermissions` faisait, pour une première acquisition :

```js
await channel.permissionOverwrites.set(overwrites, reason);
```

Dans discord.js 14.27.0 (`node_modules/discord.js/src/managers/PermissionOverwriteManager.js`) :

```js
async set(overwrites, reason) {
  // ...
  return this.channel.edit({ permissionOverwrites: overwrites, reason });
}
```

`channel.edit({ permissionOverwrites })` envoie la liste complète des overwrites du salon à l'API Discord : **ce n'est pas une fusion, c'est un remplacement**. Tout overwrite absent du tableau est supprimé.

Or `buildTicketPermissionOverwrites` ne retourne que 4 entrées : `@everyone` (deny), le propriétaire, le `staffRoleId` de la catégorie, le bot. Toute personne ayant un accès individuel au salon et ne figurant pas dans ces 4 entrées perdait son overwrite — donc l'accès, puisque `@everyone` est en deny.

C'est exactement le même mécanisme que `removeUsersFromTicket`, sauf qu'ici personne ne l'avait demandé.

### 2. Le propriétaire par défaut était l'auteur de la commande

`src/commands/acquire.js` :

```js
const ownerId = chosenOwner?.id ?? metadata?.ownerId ?? interaction.user.id;
```

Sur un salon qui n'est pas encore un ticket, `metadata` est `null` : sans l'option `proprietaire`, le propriétaire devenait **le membre du staff qui tape la commande**. L'ouvreur réel du salon n'était donc dans aucune des 4 entrées — et la cause n°1 le supprimait.

C'est ce qui rendait le symptôme trompeur : le staff voyait le salon fonctionner normalement (il y a accès, lui), et ne constatait la perte que quand l'ouvreur se plaignait.

## Correctifs retenus

### Permissions : membres intouchables, rôles alignés

Règle, valable pour la première acquisition comme pour la mise à jour (même code) : **aucun overwrite de membre n'est jamais supprimé ; les overwrites de rôles sont alignés sur un ticket créé par le panel ; `@everyone` n'est pas touché.**

`TicketService.applyTicketPermissions` :

```js
    async applyTicketPermissions(channel, interaction, ticketConfig, ownerId, reason) {
        const overwrites = this.buildTicketPermissionOverwrites(interaction, ticketConfig, ownerId)
            .filter(overwrite => overwrite.id !== interaction.guild.id);

        for (const overwrite of overwrites) {
            await channel.permissionOverwrites.edit(overwrite.id, toPermissionOptions(overwrite), {
                type: overwrite.type,
                reason
            });
        }

        const removedRoleIds = findObsoleteRoleOverwriteIds(channel.permissionOverwrites.cache, [
            interaction.guild.id,
            ticketConfig.staffRoleId
        ]);
        for (const roleId of removedRoleIds) {
            await channel.permissionOverwrites.delete(roleId, reason);
        }
        return { removedRoleIds };
    }
```

- **Plus de `set`** : un `edit` par entrée (propriétaire, `staffRoleId` de la catégorie, bot), qui ne réécrit que la ligne de l'ID visé et fusionne avec l'overwrite existant de cet ID. Le `type` explicite est repassé à chaque `edit`.
- **Plus d'entrée `@everyone`** : filtrée, et l'overwrite `@everyone` existant est conservé. Un salon visible par tout le monde le reste ; un salon rangé dans la catégorie Discord du ticket est déjà privé par héritage.
- **Nettoyage des rôles, après les ajouts** : `findObsoleteRoleOverwriteIds` (`src/utils/ticketPermissions.js`) retourne tous les overwrites `OverwriteType.Role` hors `@everyone` et rôle staff de la catégorie. C'est **le filtre de type** qui protège les membres : un overwrite de membre n'est jamais candidat, qu'il s'agisse de l'ouvreur, d'un membre ajouté via ➕ Ajouter ou de n'importe qui d'autre. Les suppressions viennent après les `edit` pour que le staff et le bot ne perdent jamais l'accès en cours de route.
- Les rôles retirés sont annoncés dans la réponse éphémère (« 🧹 Accès retirés aux rôles : … ») et dans le log de l'acquisition.

`buildTicketPermissionOverwrites` n'a pas changé : utilisée telle quelle à la création d'un ticket par le panel (`guild.channels.create`, salon neuf, le refus `@everyone` y est indispensable), et filtrée à l'acquisition.

### Propriétaire par défaut : l'ouvreur déduit, et annoncé

`TicketService.resolveAcquireOwner(interaction, chosenOwnerId, metadata)` retourne `{ ownerId, note }`, par priorité :

1. l'option `proprietaire` ;
2. le propriétaire du topic, si le salon est déjà un ticket ;
3. l'ouvreur déduit par `findProbableOwnerId` (`src/utils/ticketPermissions.js`) : **le seul** overwrite de membre autorisant `ViewChannel`, hors bot, hors auteur de la commande et hors bots connus de `client.users.cache` ;
4. à défaut (aucun ou plusieurs candidats), l'auteur de la commande — on ne devine pas.

Dans les cas 3 et 4, `note` l'annonce au staff (« Propriétaire déduit des accès du salon : @… » / « Impossible de déduire l'ouvreur… ») avec la marche à suivre pour corriger : `/acquire proprietaire:@membre`. La note s'affiche au-dessus du menu de catégorie, ou dans la réponse finale en mode silencieux.

C'est l'option « déduire des overwrites existants » de l'analyse initiale. L'alternative — un `UserSelectMenu` de propriétaire en plus du menu de catégorie — reste possible si la déduction se révèle insuffisante, au prix d'un aller-retour d'interaction.

### Tests

Dans `test/ticketAcquire.test.js` :

- `une acquisition n ajoute que les acces du proprietaire, du staff et du bot` et `la mise a jour d un ticket n enleve aucune permission du salon` — pas de `set`, exactement trois `edit`, aucune valeur `false` ;
- `l acquisition retire les roles en trop mais jamais les membres ni @everyone` — salon avec ouvreur, membre ajouté, ancien rôle staff, rôle quelconque, rôle staff visé et `@everyone` : seuls les deux rôles en trop sont supprimés ;
- `seuls les overwrites de roles hors liste de conservation sont a supprimer`, `l ouvreur probable est le seul membre ayant un acces individuel au salon` — helpers purs ;
- quatre tests sur `resolveAcquireOwner` et la note (priorités, déduction, cas ambigu, note dans la réponse finale).

### Effets de bord à assumer

- Un salon public acquis **reste public** tant qu'il n'est pas rangé dans la catégorie Discord du ticket.
- Un rôle qui avait volontairement accès au salon (rôle de direction ajouté à la main, par exemple) **perd cet accès**. C'est le but du nettoyage ; il est annoncé, et les administrateurs voient tous les salons de toute façon.
- Un bot tiers absent de `client.users.cache` et ayant un accès individuel compte comme candidat ouvreur : on tombe alors sur « plusieurs candidats », l'auteur devient propriétaire et la note le signale.

## Reste à faire

- **`addUsersToTicket`** (`src/services/TicketService.js`) appelle `permissionOverwrites.edit(userId, …)` **sans `type`** : discord.js doit alors résoudre l'ID via son cache local et lève `InvalidType` si l'utilisateur n'y est pas. Risque faible ici (l'ID vient d'un `UserSelectMenu` résolu dans la même interaction), mais la correction est triviale : `{ type: OverwriteType.Member }`.
- **`reassignTicket`** a le même manque avec un ID relu du topic — risque réel, décrit en détail dans `docs/BUGFIX_REASSIGN_PERMISSIONS.md`, toujours non corrigé.

## Vérification manuelle

1. Dans un salon de test, donner un accès individuel à un compte « ouvreur », et une permission à un rôle quelconque et au rôle staff d'une **autre** catégorie.
2. `/acquire` sans option depuis un compte staff : la réponse doit annoncer « Propriétaire déduit des accès du salon : @ouvreur », puis, après choix de la catégorie, « 🧹 Accès retirés aux rôles : … » avec les deux rôles.
3. Ouvrir **Paramètres du salon → Permissions** : l'ouvreur, le rôle staff de la catégorie et le bot y figurent ; les deux autres rôles n'y sont plus ; `@everyone` est dans le même état qu'avant la commande.
4. Ajouter un membre via ➕ Ajouter, puis relancer `/acquire` (mode mise à jour) : l'ouvreur et le membre ajouté doivent toujours y figurer, et plus aucun rôle n'est retiré.
5. Recommencer depuis l'étape 1 avec **deux** comptes à accès individuel : la réponse doit annoncer « Impossible de déduire l'ouvreur » et enregistrer l'auteur de la commande.
6. Vérifier que les boutons du ticket (Fermer, Renommer) fonctionnent.

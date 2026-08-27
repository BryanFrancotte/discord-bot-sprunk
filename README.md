# Bot Discord SPRUNK

Base de bot Discord modulaire en JavaScript avec discord.js. Elle reprend les tickets, les missions, les rappels, les réactions, les transcripts, le panel de support, le message distributeur et la commande troll du code d’origine.

## Prérequis

- Node.js 24.17.0 ou plus récent, requis par discord.js 14.27.
- Une application et un bot créés dans le portail Discord Developer.
- Les intents **Server Members Intent** et **Message Content Intent** activés dans le portail Discord.

## Installation

1. Installez Node.js, puis ouvrez un terminal dans ce dossier.
2. Installez les dépendances :

   ```powershell
   npm install
   ```

3. Copiez `.env.example` vers `.env`, puis placez le token dans `.env` :

   ```env
   BOT_TOKEN=VOTRE_TOKEN
   ```

4. Remplacez tous les identifiants d’exemple dans `config.json`.
5. Démarrez le bot :

   ```powershell
   npm start
   ```

Les commandes slash sont enregistrées sur le serveur défini par `bot.guildId` à chaque démarrage. Elles apparaissent normalement immédiatement, car elles sont propres au serveur.

## Permissions Discord nécessaires

Lors de l’invitation du bot, prévoyez au minimum :

- Voir les salons et envoyer des messages ;
- Gérer les salons et leurs permissions ;
- Gérer et lire l’historique des messages ;
- Ajouter et gérer les réactions ;
- Intégrer des liens et joindre des fichiers.

Le rôle du bot doit être placé au-dessus des rôles qu’il doit mentionner ou administrer.

## Commandes

- `/template` : publie le panel de tickets, réservé aux administrateurs.
- `!setup` : variante historique de `/template`, réservée aux administrateurs.
- `/mission` : crée une mission et programme les rappels à 15 minutes, 5 minutes et au démarrage.
- `/distributeur` : publie anonymement le message d’information configuré dans le code.
- `/troll` : envoie une série limitée de messages privés ; désactivée par défaut.

Les commandes de mission, réassignation, renommage et troll sont accessibles aux administrateurs ou au rôle `reassignRoleId`. `/distributeur` accepte également `distributorRoleId`.

## Configuration de `/troll`

Cette fonctionnalité peut être intrusive. Elle est donc désactivée par défaut et comporte un cooldown par cible. Pour l’activer :

```json
"troll": {
  "enabled": true,
  "messageCount": 15,
  "delayMs": 800,
  "cooldownMs": 600000,
  "gifs": []
}
```

Le service impose toujours un maximum de 15 messages, un délai minimal de 800 ms et un cooldown minimal d’une minute.

## Organisation

```text
src/
├── commands/       Commandes slash indépendantes
├── core/           Client Discord, configuration et verrou d’instance
├── events/         Routage des événements Discord
├── services/       Tickets, missions, rappels, logs et stockage
├── utils/          Dates, permissions, textes et réponses
└── index.js        Point d’entrée et arrêt propre
```

Les données sont créées automatiquement dans `data/missions.json` et `data/ticket-logs.json`. Elles sont exclues de Git. La configuration est rechargée à chaud lorsqu’un `config.json` valide est sauvegardé.

## Tickets

Chaque catégorie de `config.json` définit son nom, sa catégorie Discord et son rôle staff. L’ID du propriétaire et la catégorie logique sont inscrits dans le topic du salon. Cela permet de préserver l’accès du créateur pendant une réassignation.

À la fermeture :

1. jusqu’à `ticketsSettings.transcriptMessageLimit` messages sont récupérés ;
2. le transcript et les métadonnées sont sauvegardés dans le JSON ;
3. le transcript texte est envoyé dans le salon de logs si celui-ci est configuré ;
4. le salon est ensuite supprimé.

## Vérifications

```powershell
npm run check
npm test
```

`npm run check` vérifie la syntaxe de tous les fichiers JavaScript. Les tests couvrent notamment les conversions Europe/Paris et les dates impossibles lors des changements d’heure.

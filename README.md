# Bot Discord SPRUNK

Base de bot Discord modulaire en JavaScript avec discord.js. Elle reprend les tickets, les missions, les rappels, les réactions, les transcripts, le panel de support, le message distributeur et la commande troll du code d’origine.

Ce README couvre l'installation. Pour aller plus loin :

- [`docs/DEVELOPER_GUIDE.md`](docs/DEVELOPER_GUIDE.md) — architecture, conventions, comment ajouter une commande ou un service.
- [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) — utilisation des tickets, des missions et des commandes côté staff/membres.

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

4. Copiez `config.example.json` vers `config.json`, puis remplacez tous les identifiants d’exemple :

   ```powershell
   Copy-Item config.example.json config.json
   ```
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
- Intégrer des liens et joindre des fichiers ;
- Gérer les rôles, pour attribuer le rôle membre depuis le bouton de `/reglement`.

Le rôle du bot doit être placé au-dessus des rôles qu’il doit mentionner ou administrer.

## Commandes

- `/template` : publie le panel de tickets, réservé aux administrateurs.
- `!setup` : variante historique de `/template`, réservée aux administrateurs.
- `/mission` : crée une mission et programme les rappels à 15 minutes, 5 minutes et au démarrage.
- `/distributeur` : publie anonymement le message d’information configuré dans le code.
- `/reglement` : publie le règlement dans le salon courant, avec un bouton « Lu et Approuvé » qui attribue le rôle membre (`rules.memberRoleId`). Réservé aux administrateurs.
- `/troll` : envoie une série limitée de messages privés ; désactivée par défaut.
- `/acquire` : transforme le salon courant (non créé par le bot) en ticket géré, avec toutes les actions d’un ticket normal — et, sur un salon déjà géré, met à jour l’embed, les boutons et les accès du ticket. **Aucun membre n’est éjecté** (ouvreur, membres ajoutés) ; le propriétaire, le rôle staff et le bot reçoivent l’accès, les autres rôles perdent le leur pour correspondre à la catégorie, et `@everyone` n’est pas touché. Sans option `proprietaire`, le propriétaire est le propriétaire actuel sur un ticket existant, sinon l’ouvreur du salon s’il peut être déduit (seul membre avec un accès individuel), sinon l’auteur de la commande — la déduction est toujours annoncée ; `silencieux:true` déduit la catégorie du ticket de celle du ticket en cours, sinon de la catégorie Discord du salon (aucun menu), et poste le message de ticket sans mention ni notification.
- `/assigner` : dans un ticket Architecture, assigne le ticket à un architecte (emoji de l'architecte en tête du nom du salon, emoji de statut en fin). Sans option, l'architecte s'assigne lui-même ; choisir un autre architecte est réservé au staff. Les boutons « Assigner » et « Statut » du ticket font la même chose.
- `/statut` : indique si le Sprunk est ouvert ou fermé en renommant le salon de statut (`status.channelId`) et en y publiant le panneau correspondant (mention de rôle, message et image). Le bot doit pouvoir gérer ce salon. Les visuels par défaut sont dans `assets/`.

Les commandes de mission, réassignation, renommage, acquisition, statut et troll sont accessibles aux administrateurs ou au rôle `reassignRoleId`. `/distributeur` accepte également `distributorRoleId`.

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

`config.json` est lui aussi exclu de Git : c’est un fichier propre à chaque installation, modifiable à chaud (et à terme depuis une interface d’administration). Seul le modèle `config.example.json` est versionné. Le déploiement GitHub Actions ne l’écrase donc jamais — il le crée depuis le modèle uniquement s’il est absent de la machine cible.

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

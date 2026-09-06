# SPRUNK Bot — instructions pour Claude Code

Bot Discord modulaire (Node.js + discord.js 14). Voir `README.md` pour l'installation, `docs/DEVELOPER_GUIDE.md` pour l'architecture et les conventions, `docs/USER_GUIDE.md` pour l'usage côté staff/membres.

## Documentation à maintenir à jour

Ce projet a trois documents qui doivent rester synchronisés avec le code. Quand une modification touche l'un des sujets suivants, mettez à jour le document correspondant **dans la même tâche** :

- **`README.md`** — installation, prérequis, permissions Discord, liste des commandes.
- **`docs/DEVELOPER_GUIDE.md`** — architecture (`src/core`, `src/events`, `src/commands`, `src/services`, `src/utils`), comment ajouter une commande/service/catégorie de ticket, conventions de code, dette technique connue.
- **`docs/USER_GUIDE.md`** — comportement visible pour le staff/les membres (tickets, missions, commandes slash, champs de `config.json`).

Concrètement :
- Nouvelle commande slash, nouveau service, nouveau champ de `config.json`, nouvelle règle de permission → mettre à jour `docs/DEVELOPER_GUIDE.md` et/ou `docs/USER_GUIDE.md` selon le public concerné.
- Changement de comportement d'une fonctionnalité existante (tickets, missions, troll, distributeur) → mettre à jour `docs/USER_GUIDE.md`.
- Changement d'architecture, de convention, ou de dette technique résolue/introduite → mettre à jour `docs/DEVELOPER_GUIDE.md`.
- Ne pas dupliquer le contenu entre les deux guides : `DEVELOPER_GUIDE.md` explique le *comment* (code), `USER_GUIDE.md` explique le *quoi* (usage).

## Conventions du projet

- Tout le code, les commentaires, les messages utilisateur et les commits sont en français, à l'exception des identifiants de code (camelCase anglais habituel).
- `events/` et `commands/` restent minces : ils routent vers `services/`, ils ne portent pas de logique métier.
- Avant de committer : `npm run check` (syntaxe) et `npm test` (suite `node:test`) doivent passer.
- Toute nouvelle logique testable sans mocker l'API Discord doit avoir un test dans `test/`.

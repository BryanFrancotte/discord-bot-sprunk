'use strict';

const { OverwriteType, PermissionFlagsBits } = require('discord.js');

// Les overwrites de salon arrivent sous forme de `Collection` discord.js (une `Map`) ;
// les tests passent une simple `Map`, ou un tableau.
function toOverwriteList(overwrites) {
    if (!overwrites) return [];
    return typeof overwrites.values === 'function' ? [...overwrites.values()] : [...overwrites];
}

// Overwrites de rôles à supprimer pour aligner un salon acquis sur un ticket créé par le panel :
// tous les rôles sauf ceux de `keepIds`. Les overwrites de membres ne sont jamais retournés —
// c'est ce qui protège l'ouvreur du salon et les membres ajoutés via « Ajouter ».
function findObsoleteRoleOverwriteIds(overwrites, keepIds = []) {
    const kept = new Set(keepIds);
    return toOverwriteList(overwrites)
        .filter(overwrite => overwrite.type === OverwriteType.Role && !kept.has(overwrite.id))
        .map(overwrite => overwrite.id);
}

// Ouvreur probable d'un salon acquis : le seul membre ayant un accès individuel au salon
// (`ViewChannel` autorisé), hors `excludedIds`. Aucun candidat ou plusieurs ⇒ `null` :
// mieux vaut ne rien deviner que désigner le mauvais membre.
function findProbableOwnerId(overwrites, excludedIds = []) {
    const excluded = new Set(excludedIds);
    const candidates = toOverwriteList(overwrites).filter(overwrite =>
        overwrite.type === OverwriteType.Member
        && !excluded.has(overwrite.id)
        && overwrite.allow?.has?.(PermissionFlagsBits.ViewChannel));
    return candidates.length === 1 ? candidates[0].id : null;
}

module.exports = {
    findObsoleteRoleOverwriteIds,
    findProbableOwnerId
};

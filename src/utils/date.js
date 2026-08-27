'use strict';

const { PARIS_TIME_ZONE } = require('../constants');

const parisFormatter = new Intl.DateTimeFormat('fr-FR', {
    timeZone: PARIS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
});

function getParisParts(date) {
    const parts = parisFormatter.formatToParts(date);
    const value = type => Number(parts.find(part => part.type === type)?.value);

    return {
        year: value('year'),
        month: value('month'),
        day: value('day'),
        hour: value('hour'),
        minute: value('minute')
    };
}

function parseParisDate(dateText) {
    const match = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/.exec(dateText);
    if (!match) return null;

    const [, dayText, monthText, yearText, hourText, minuteText] = match;
    const expected = {
        year: Number(yearText),
        month: Number(monthText),
        day: Number(dayText),
        hour: Number(hourText),
        minute: Number(minuteText)
    };

    if (
        expected.month < 1 || expected.month > 12 ||
        expected.day < 1 || expected.day > 31 ||
        expected.hour < 0 || expected.hour > 23 ||
        expected.minute < 0 || expected.minute > 59
    ) {
        return null;
    }

    // Paris est UTC+2 en été et UTC+1 en hiver. Pour une heure ambiguë
    // au changement d’heure, la première occurrence (UTC+2) est choisie.
    for (const offsetHours of [2, 1]) {
        const candidate = new Date(Date.UTC(
            expected.year,
            expected.month - 1,
            expected.day,
            expected.hour - offsetHours,
            expected.minute,
            0
        ));

        const actual = getParisParts(candidate);
        if (Object.keys(expected).every(key => expected[key] === actual[key])) {
            return candidate;
        }
    }

    // Rejette notamment le 31/02 et les heures inexistantes au passage à l’heure d’été.
    return null;
}

module.exports = { parseParisDate };

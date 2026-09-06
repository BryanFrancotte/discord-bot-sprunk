'use strict';

const fs = require('fs');
const path = require('path');

const commandFiles = fs
    .readdirSync(__dirname)
    .filter(file => file.endsWith('.js') && file !== 'index.js');

module.exports = commandFiles.map(file => require(path.join(__dirname, file)));

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectDirectory = path.resolve(__dirname, '..');
const directories = [path.join(projectDirectory, 'src'), path.join(projectDirectory, 'scripts')];
const files = [];

function collectJavaScriptFiles(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) collectJavaScriptFiles(entryPath);
        else if (entry.isFile() && entry.name.endsWith('.js')) files.push(entryPath);
    }
}

directories.forEach(collectJavaScriptFiles);

let failed = false;
for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
        failed = true;
        const details = result.stderr || result.stdout || result.error?.message || 'Erreur inconnue';
        process.stderr.write(`${file}: ${details}\n`);
    }
}

if (failed) process.exit(1);
console.log(`✅ Syntaxe validée pour ${files.length} fichiers JavaScript.`);

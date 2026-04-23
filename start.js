const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// --- Lock mechanism to prevent multiple instances ---
const lockFile = path.join(__dirname, '.bot.lock');

if (fs.existsSync(lockFile)) {
    try {
        const oldPid = fs.readFileSync(lockFile, 'utf8');
        // Check if process still exists
        process.kill(parseInt(oldPid), 0); 
        console.error(`❌ Une instance de l'application est déjà en cours (PID: ${oldPid}). Arrêt.`);
        process.exit(1);
    } catch (e) {
        // Process doesn't exist, remove stale lock
        fs.unlinkSync(lockFile);
    }
}

fs.writeFileSync(lockFile, process.pid.toString());
process.on('exit', () => { if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile); });
process.on('SIGINT', () => { process.exit(); });
process.on('SIGTERM', () => { process.exit(); });

console.log('🚀 Démarrage du système SPRUNK...');
require('./index.js');

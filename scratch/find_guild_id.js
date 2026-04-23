const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'config.json');
const CONFIG = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

client.once('ready', () => {
    console.log('--- Connected ---');
    console.log('Bot Tag:', client.user.tag);
    console.log('Bot ID:', client.user.id);
    console.log('\n--- Guilds Info ---');
    if (client.guilds.cache.size === 0) {
        console.log('The bot is not currently in any servers (guilds).');
    } else {
        client.guilds.cache.forEach(guild => {
            console.log(`Server Name: ${guild.name}`);
            console.log(`Server ID:   ${guild.id}`);
        });
    }
    process.exit(0);
});

client.login(CONFIG.bot.token).catch(err => {
    console.error('Login failed:', err.message);
    process.exit(1);
});

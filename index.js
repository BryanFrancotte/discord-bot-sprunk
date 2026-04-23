require('dotenv').config();
process.env.TZ = 'Europe/Paris'; // Forcer le fuseau horaire Paris (CET/CEST)

const {
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder,
    ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType,
    REST, Routes, SlashCommandBuilder, StringSelectMenuBuilder, ChannelType,
    PermissionFlagsBits, AttachmentBuilder
} = require('discord.js');
const fs = require('fs');
const path = require('path');

// --- Single Instance Lock ---
const lockFile = path.join(__dirname, '.bot.lock');
if (fs.existsSync(lockFile)) {
    try {
        const oldPid = fs.readFileSync(lockFile, 'utf8');
        if (parseInt(oldPid) !== process.pid) {
            process.kill(parseInt(oldPid), 0); // Check if process is actually running
            console.error(`\n❌ ATTENTION : Le bot (PID ${oldPid}) est déjà en train de tourner en arrière-plan !`);
            process.exit(1);
        }
    } catch (e) {
        fs.unlinkSync(lockFile);
    }
}
fs.writeFileSync(lockFile, process.pid.toString());
const exitCleanup = () => { if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile); process.exit(0); };
process.on('SIGINT', exitCleanup);
process.on('SIGTERM', exitCleanup);
process.on('exit', () => { if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile); });

const configPath = path.join(__dirname, 'config.json');
const logsPath = path.join(__dirname, 'data', 'ticket-logs.json');
const missionsPath = path.join(__dirname, 'data', 'missions.json');
let CONFIG = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
    console.error('❌ Missing BOT_TOKEN in .env');
    process.exit(1);
}

if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'));
if (!fs.existsSync(missionsPath)) fs.writeFileSync(missionsPath, JSON.stringify({ missions: [] }, null, 2));

// --- Convertir une date/heure locale Paris → UTC (gère auto heure d'été/hiver) ---
function parseDateParis(year, month, day, hour, minute) {
    // 1. Créer une date approximative en UTC (on soustrait 1h pour CET comme estimation)
    const estimateUTC = new Date(Date.UTC(year, month - 1, day, hour - 1, minute));

    // 2. Trouver le vrai offset de Paris à ce moment-là grâce à Intl
    const formatter = new Intl.DateTimeFormat('fr-FR', {
        timeZone: 'Europe/Paris',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    });

    // 3. Méthode fiable : on teste les deux offsets possibles (UTC+1 et UTC+2)
    for (const offsetHours of [1, 2]) {
        const candidate = new Date(Date.UTC(year, month - 1, day, hour - offsetHours, minute, 0));
        const parts = formatter.formatToParts(candidate);
        const get = (type) => parseInt(parts.find(p => p.type === type).value);

        const pDay = get('day');
        const pMonth = get('month');
        const pYear = get('year');
        const pHour = get('hour');
        const pMinute = get('minute');

        // Si la conversion inverse (UTC → Paris) redonne la même heure locale, c'est le bon offset
        if (pYear === year && pMonth === month && pDay === day && pHour === hour && pMinute === minute) {
            return candidate;
        }
    }

    // Fallback : retourne la date telle quelle (ne devrait pas arriver)
    return new Date(Date.UTC(year, month - 1, day, hour - 1, minute));
}

// Function to save ticket logs
function saveTicketLog(entry) {
    try {
        const data = JSON.parse(fs.readFileSync(logsPath, 'utf8'));
        data.tickets.unshift(entry); // plus récent en premier
        if (data.tickets.length > 500) data.tickets = data.tickets.slice(0, 500);
        fs.writeFileSync(logsPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) { console.error('Erreur saveTicketLog:', e.message); }
}

// Hot-reload: recharge config.json dès qu'il est modifié
fs.watch(configPath, { persistent: false }, (eventType) => {
    if (eventType === 'change') {
        try {
            const raw = fs.readFileSync(configPath, 'utf8');
            CONFIG = JSON.parse(raw);
            console.log('🔄 config.json rechargé en direct.');
        } catch (e) {
            console.error('⚠️  Erreur de rechargement config.json (JSON invalide) :', e.message);
        }
    }
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions
    ],
    allowedMentions: { parse: ['roles', 'users'], repliedUser: true }
});

// --- Register Slash Commands ---
async function registerCommands() {
    const commands = [
        new SlashCommandBuilder()
            .setName('template')
            .setDescription('Afficher le template / panel des tickets')
            .toJSON(),
        new SlashCommandBuilder()
            .setName('mission')
            .setDescription('Créer une mission avec rappel')
            .addStringOption(o => o.setName('titre').setDescription('Titre de la mission').setRequired(true))
            .addStringOption(o => o.setName('description').setDescription('Description de ce qu\'il faut faire').setRequired(true))
            .addStringOption(o => o.setName('lieu').setDescription('Lieu du rendez-vous').setRequired(true))
            .addStringOption(o => o.setName('date').setDescription('Format: JJ/MM/AAAA HH:mm (ex: 15/04/2026 21:00)').setRequired(true))
            .addIntegerOption(o => o.setName('max').setDescription('Nombre max de participants').setRequired(false))
            .toJSON(),
        new SlashCommandBuilder()
            .setName('troll')
            .setDescription('Troll un utilisateur en lui envoyant plein de MP')
            .addUserOption(o => o.setName('cible').setDescription('L\'utilisateur à troll').setRequired(true))
            .toJSON(),
        new SlashCommandBuilder()
            .setName('distributeur')
            .setDescription('Envoyer le message d\'information Sprunk pour les distributeurs')
            .toJSON()
    ];

    const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
    try {
        console.log(`🔄 Enregistrement des commandes slash sur GUILD: ${CONFIG.bot.guildId}...`);

        // Optionnel: Nettoyer les commandes globales si elles interfèrent
        await rest.put(Routes.applicationCommands(client.user.id), { body: [] });

        await rest.put(
            Routes.applicationGuildCommands(client.user.id, CONFIG.bot.guildId),
            { body: commands }
        );
        console.log('✅ Commandes slash enregistrées (Guild) et globales nettoyées !');
    } catch (error) {
        console.error('❌ Erreur enregistrement commandes:', error);
    }
}

client.once('ready', async () => {
    console.log(`✅ SPRUNK Bot online as ${client.user.tag}`);
    // Enregistrement en arrière-plan pour ne pas bloquer
    registerCommands().catch(err => console.error('Register error:', err));
});

const getDisplayName = (member, user) => member?.displayName || user.globalName || user.username;

async function sendLogs(guild, embed, type = 'ticket', file = null) {
    const channelId = CONFIG.bot.logsChannelId;
    if (!channelId || channelId === "ID_ICI") return;
    try {
        const logsChannel = await guild.channels.fetch(channelId).catch(() => null);
        if (logsChannel && logsChannel.isTextBased()) {
            const options = { embeds: [embed] };
            if (file) options.files = [file];
            await logsChannel.send(options).catch(err => {
                if (err.code !== 50013 && err.code !== 50001) {
                    console.error('❌ Impossible d\'envoyer le log :', err.message);
                }
            });
        }
    } catch (e) {
        if (e.code !== 10003) console.error('⚠️ Erreur sendLogs:', e.message);
    }
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Command to setup the ticket hub manually
    if (message.content === '!setup' && message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        const embed = new EmbedBuilder()
            .setTitle('🥤 SPRUNK | HUB DE SUPPORT')
            .setDescription('Besoin d\'assistance ? Cliquez ci-dessous.')
            .setColor(CONFIG.bot.color)
            .setFooter({ text: CONFIG.bot.footerText });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('open_ticket')
                .setLabel('📩 Ouvrir un Ticket')
                .setStyle(ButtonStyle.Success)
        );

        await message.channel.send({ embeds: [embed], components: [row] });
        await message.delete();
    }
});

client.on('interactionCreate', async (interaction) => {
    const userDisplayName = getDisplayName(interaction.member, interaction.user);

    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;
        if (commandName === 'template') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Non autorisé.', ephemeral: true });

            const embed = new EmbedBuilder()
                .setTitle('🥤 SPRUNK | HUB DE SUPPORT')
                .setDescription("Besoin d'assistance ? Cliquez ci-dessous.")
                .setColor(CONFIG.bot.color)
                .setFooter({ text: CONFIG.bot.footerText });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('open_ticket')
                    .setLabel('📩 Ouvrir un Ticket')
                    .setStyle(ButtonStyle.Success)
            );

            await interaction.channel.send({ embeds: [embed], components: [row] });
            await interaction.reply({ content: '✅ Panel / template des tickets envoyé avec succès.', ephemeral: true });
        }

        if (commandName === 'mission') {
            try {
                await interaction.deferReply({ ephemeral: true });
            } catch (e) { return; }

            const hasPermission = interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
                interaction.member.roles.cache.has(CONFIG.bot.reassignRoleId);

            if (!hasPermission) return interaction.editReply({ content: '❌ Non autorisé.' });

            const titre = interaction.options.getString('titre');
            const description = interaction.options.getString('description');
            const lieu = interaction.options.getString('lieu');
            const dateStr = interaction.options.getString('date');
            const maxParticipants = interaction.options.getInteger('max') || 0;

            const missionChannelId = CONFIG.bot.missionChannelId || interaction.channelId;
            const channel = await interaction.guild.channels.fetch(missionChannelId).catch(() => null);

            if (!channel || !channel.isTextBased()) {
                return interaction.reply({ content: '❌ Salon de mission introuvable ou invalide.', ephemeral: true });
            }

            // Parsing simple: JJ/MM/AAAA HH:mm
            const regex = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/;
            const match = dateStr.match(regex);

            if (!match) {
                return interaction.editReply({ content: '❌ Format de date invalide. Utilisez: JJ/MM/AAAA HH:mm (ex: 15/04/2026 20:30)' });
            }

            const [_, day, month, year, hour, minute] = match;
            // Forcer le fuseau horaire Europe/Paris (gère automatiquement heure d'été/hiver)
            const targetDate = parseDateParis(parseInt(year), parseInt(month), parseInt(day), parseInt(hour), parseInt(minute));

            if (!targetDate || isNaN(targetDate.getTime()) || targetDate < new Date()) {
                return interaction.editReply({ content: '❌ Date invalide ou déjà passée.' });
            }

            const embed = new EmbedBuilder()
                .setTitle(`🚀 Mission : ${titre} | STAFF`)
                .setDescription(`Une nouvelle mission a été programmée !\n\n📝 **Mission :** ${description}\n📍 **RDV :** ${lieu}\n📅 **Date :** ${dateStr}\n👥 **Places :** ${maxParticipants > 0 ? maxParticipants : 'Illimité'}\n\nRéagissez avec ✅ pour participer.\nRéagissez avec 🟠 pour être en réserve.\n\n🔔 **Notification :** <@&1192209478054055946>`)
                .setColor(CONFIG.bot.color)
                .setFooter({ text: 'Réagissez pour participer ou être en réserve' })
                .setTimestamp(targetDate);

            const msg = await channel.send({ content: `<@&1192209478054055946>`, embeds: [embed] });
            await msg.react('✅');
            await msg.react('🟠');

            // Sauvegarde
            const missionsData = JSON.parse(fs.readFileSync(missionsPath, 'utf8'));
            missionsData.missions.push({
                id: msg.id,
                channelId: channel.id,
                guildId: interaction.guildId,
                titre: titre,
                description: description,
                lieu: lieu,
                timestamp: targetDate.getTime(),
                maxParticipants: maxParticipants,
                reminded15m: false,
                reminded5m: false,
                remindedNow: false,
                notificationIds: [] // Pour stocker les IDs des pings de rappel
            });
            fs.writeFileSync(missionsPath, JSON.stringify(missionsData, null, 2));

            await interaction.editReply({ content: `✅ Mission créée avec succès dans ${channel} (${maxParticipants > 0 ? maxParticipants : 'illimité'} places)` });
        }

        if (commandName === 'troll') {
            const hasPermission = interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
                interaction.member.roles.cache.has(CONFIG.bot.reassignRoleId);

            if (!hasPermission) return interaction.reply({ content: '❌ Non autorisé.', ephemeral: true });

            const target = interaction.options.getUser('cible');
            if (target.bot) return interaction.reply({ content: '❌ On ne peut pas troll un bot !', ephemeral: true });

            await interaction.reply({ content: `🚀 L'opération troll est lancée sur **${target.tag}** !`, ephemeral: true });

            const gifs = [
                "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExNHJmZzR6NHJmZzR6NHJmZzR6NHJmZzR6NHJmZzR6NHJmZzR6JmVwPXYxX2ludGVybmFsX2dpZl9ieV9pZCZjdD1n/amxLHEPgGDCKs/giphy.gif",
                "https://media.discordapp.net/attachments/1362474349734658320/1392906842019201144/GvPFL2pacAA0gLc.GIF?ex=69e45b56&is=69e309d6&hm=b8d28ad79f1dd78862aa18fd62536b811e7fd33ffde67a4b7b9bd8be71f113c3&=",
                "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExNHJmZzR6NHJmZzR6NHJmZzR6NHJmZzR6NHJmZzR6NHJmZzR6JmVwPXYxX2ludGVybmFsX2dpZl9ieV9pZCZjdD1n/3o72F8t9TDi2xTY97G/giphy.gif",
                "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExNHJmZzR6NHJmZzR6NHJmZzR6NHJmZzR6NHJmZzR6NHJmZzR6JmVwPXYxX2ludGVybmFsX2dpZl9ieV9pZCZjdD1n/vFKqnCdLPNOKc/giphy.gif",
                "https://media0.giphy.com/media/v1.Y2lkPTc5MGI3NjExbG1oZDFwdmxocXluejQ0OTI1cGJnMnA3NWIydGdnbnowNHNkb3RyYyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/RcEMr0uiigWcHUTF8l/giphy.gif"
            ]

            const messages = [
                `Hey ${target} ! Tu fais quoi ? 😜`,
                `On m'a dit que tu aimais les surprises ${target}... 🎁`,
                `Regarde ça ${target} ! 😂`,
                `T'es là ${target} ? 👀`,
                `Oops, encore un message pour ${target} ! 🙊`,
                `${target}, tu dors ? 😴`,
                `C'est cadeau ${target} ! ✨`,
                `Trollé ! 🤪 (nan je déconne c'est un MP)`
            ];

            for (let i = 0; i < 15; i++) {
                const gif = gifs[Math.floor(Math.random() * gifs.length)];
                const msg = messages[Math.floor(Math.random() * messages.length)];

                try {
                    await target.send(`${msg}\n${gif}`);
                } catch (err) {
                    console.error(`Impossible d'envoyer un MP à ${target.tag}:`, err.message);
                    break;
                }
                await new Promise(r => setTimeout(r, 800));
            }
        }

        if (commandName === 'distributeur') {
            console.log(`[DEBUG] Commande /distributeur reçue par le PID: ${process.pid}`);
            const embed = new EmbedBuilder()
                .setTitle('🥤 SPRUNK | INSTALLATION DE DISTRIBUTEUR')
                .setDescription(`Bonjour et bienvenue au Sprunk!\n\nPourriez-vous nous transmettre la position GPS précise du distributeur, accompagnée de photos indiquant son emplacement exact ?\n\nAttention, l'emplacement du distributeur ne peut pas gêner la circulation de véhicules et ne doit pas bloquer tous le passage sur un trottoir, il ne peut également pas être posé sur la propriété d'une entreprise qui ne vous appartient pas.\n\nL’installation du distributeur représente un coût de **15000 $**. En contrepartie, vous percevrez **40 %** des ventes générées.\n\nLes recharges seront entièrement prises en charge par nos soins. Nous vous demandons également d'être engagé au Sprunk le temps nécessaire à l’installation du distributeur. (il faut avoir un RSA pour le poser et le garder)\n\nUn contrat officiel sera rédigé et signé lors de l’installation.`)
                .setColor(CONFIG.bot.color)
                .setFooter({ text: CONFIG.bot.footerText })
                .setTimestamp();

            await interaction.channel.send({ embeds: [embed] });
            await interaction.reply({ content: '✅ Le message a été posté anonymement.', ephemeral: true });
        }
    }

    if (interaction.isButton()) {
        const { customId } = interaction;

        if (customId === 'open_ticket') {
            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('select_category')
                    .setPlaceholder('Sélectionnez une catégorie...')
                    .addOptions(CONFIG.tickets.map(t => {
                        const opt = {
                            label: t.label,
                            value: t.id,
                            description: t.details || 'Cliquez pour ouvrir'
                        };
                        if (t.emoji && t.emoji.trim()) opt.emoji = t.emoji.trim();
                        return opt;
                    }))
            );
            await interaction.reply({ content: 'Sélectionnez votre catégorie :', components: [row], ephemeral: true });
        }

        if (customId === 'close_ticket') {
            await interaction.reply('📦 Fermeture du ticket et génération du log...');
            const messages = await interaction.channel.messages.fetch({ limit: 100 });
            let transcript = `TRANSCRIPT SPRUNK - #${interaction.channel.name}\n\n`;
            const lines = [];

            messages.reverse().forEach(m => {
                const line = `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content}`;
                transcript += line + '\n';
                lines.push({
                    ts: m.createdAt.toISOString(),
                    author: m.author.tag,
                    content: m.content,
                    avatarURL: m.author.displayAvatarURL()
                });
            });

            const attachment = new AttachmentBuilder(Buffer.from(transcript), { name: `transcript-${interaction.channel.name}.txt` });

            await sendLogs(interaction.guild, new EmbedBuilder()
                .setTitle('🔒 TICKET FERMÉ')
                .setColor(CONFIG.bot.color)
                .setDescription(`Par **${userDisplayName}**\nSalon: ${interaction.channel.name}`)
                .setTimestamp(), 'ticket', attachment);

            const catId = CONFIG.tickets.find(t => interaction.channel.name.includes(t.id))?.id || 'inconnu';
            saveTicketLog({
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                channelName: interaction.channel.name,
                category: catId,
                closedBy: userDisplayName,
                closedByTag: interaction.user.tag,
                closedAt: new Date().toISOString(),
                messages: lines
            });

            setTimeout(() => interaction.channel.delete().catch(console.error), 2000);
        }

        if (customId === 'reassign_ticket') {
            if (!interaction.member.roles.cache.has(CONFIG.bot.reassignRoleId)) return interaction.reply({ content: "❌ Non autorisé.", ephemeral: true });
            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('confirm_reassign')
                    .setPlaceholder('Réassigner vers...')
                    .addOptions(CONFIG.tickets.map(t => ({
                        label: t.label,
                        value: `reassign_${t.id}`,
                        description: 'Transférer le dossier',
                        emoji: '🔄'
                    })))
            );
            await interaction.reply({ content: 'Réassignation :', components: [row], ephemeral: true });
        }

        if (customId === 'rename_ticket') {
            if (!interaction.member.roles.cache.has(CONFIG.bot.reassignRoleId)) return interaction.reply({ content: "❌ Non autorisé.", ephemeral: true });
            const modal = new ModalBuilder()
                .setCustomId('rename_modal')
                .setTitle('📦 RENOMMER LE TICKET');

            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('new_name')
                        .setLabel('Nouveau nom du salon')
                        .setRequired(true)
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder(interaction.channel.name)
                )
            );
            await interaction.showModal(modal);
        }
    }

    if (interaction.isModalSubmit() && interaction.customId === 'rename_modal') {
        const newName = interaction.fields.getTextInputValue('new_name').toLowerCase().replace(/\s+/g, '-');
        const oldName = interaction.channel.name;

        try {
            await interaction.channel.setName(newName);
            await interaction.reply({ content: `✅ Ticket renommé en **${newName}** (précédemment: ${oldName})`, ephemeral: true });

            await sendLogs(interaction.guild, new EmbedBuilder()
                .setTitle('📦 TICKET RENOMMÉ')
                .setColor('#3498db')
                .setDescription(`Par: **${userDisplayName}**\nAncien nom: **${oldName}**\nNouveau nom: **${newName}**`)
                .setTimestamp(), 'ticket');
        } catch (err) {
            console.error('❌ Erreur renommage salon :', err.message);
            if (!interaction.replied) await interaction.reply({ content: `❌ Erreur lors du renommage : ${err.message}`, ephemeral: true });
        }
    }

    if (interaction.isStringSelectMenu()) {
        const { customId, values } = interaction;

        if (customId === 'select_category') {
            await interaction.deferUpdate();
            const typeConfig = CONFIG.tickets.find(t => t.id === values[0]);

            const channel = await interaction.guild.channels.create({
                name: `ticket-${userDisplayName.replace(/\s+/g, '-')}-${values[0]}`,
                type: ChannelType.GuildText,
                parent: typeConfig.categoryId || null,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] },
                    { id: typeConfig.staffRoleId || interaction.guild.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
                ]
            }).catch(e => {
                console.error('❌ Erreur création salon :', e.message);
                return null;
            });

            if (!channel) return interaction.editReply({ content: '❌ Erreur : Impossible de créer le salon (Vérifiez les permissions ou IDs dans config.json).', components: [] });

            await sendLogs(interaction.guild, new EmbedBuilder()
                .setTitle('📩 TICKET OUVERT')
                .setColor(CONFIG.bot.color)
                .setDescription(`Ouvert par: **${userDisplayName}**\nCatégorie: **${typeConfig.label}**\nSalon: ${channel}`)
                .setTimestamp());

            const embed = new EmbedBuilder()
                .setTitle(typeConfig.title)
                .setDescription(typeConfig.description.replace('{user}', interaction.user) + `\n\n**Infos :**\n👤 **User :** ${userDisplayName}\n📝 **Détails :** ${typeConfig.details || "N/A"}`)
                .setColor(CONFIG.bot.color);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('close_ticket').setLabel('Fermer').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('reassign_ticket').setLabel('Réassigner').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('rename_ticket').setLabel('Renommer').setStyle(ButtonStyle.Primary)
            );

            await channel.send({ content: `${interaction.user} | <@&${typeConfig.staffRoleId}>`, embeds: [embed], components: [row] });
            await interaction.editReply({ content: `Ticket créé : ${channel}`, components: [] });
        }

        if (customId === 'confirm_reassign') {
            await interaction.deferUpdate();
            const target = CONFIG.tickets.find(t => t.id === values[0].replace('reassign_', ''));

            try {
                await interaction.channel.setParent(target.categoryId);
                await interaction.channel.permissionOverwrites.set([
                    { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                    { id: target.staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
                ]);

                await interaction.channel.send({
                    content: `<@&${target.staffRoleId}>`,
                    embeds: [new EmbedBuilder().setTitle('🔄 RÉASSIGNATION').setColor('#fbc531').setDescription(`Dossier transféré à **${target.label}**.`)]
                });
                await interaction.followUp({ content: 'Réassigné avec succès.', ephemeral: true });
            } catch (err) {
                console.error('❌ Erreur réassignation :', err.message);
                await interaction.followUp({ content: `❌ Erreur lors de la réassignation : ${err.message}`, ephemeral: true });
            }
        }
    }
});

// --- Mission Reactions ---
client.on('messageReactionAdd', async (reaction, user) => {
    try {
        if (user.bot) return;
        if (!['✅', '🟠'].includes(reaction.emoji.name)) return;

        if (reaction.partial) await reaction.fetch().catch(() => null);

        const data = JSON.parse(fs.readFileSync(missionsPath, 'utf8'));
        const mission = data.missions.find(m => m.id === reaction.message.id);
        if (!mission) return;

        if (reaction.emoji.name === '✅') {
            if (mission.maxParticipants > 0) {
                const users = await reaction.users.fetch();
                const count = users.filter(u => !u.bot).size;

                if (count > mission.maxParticipants) {
                    await reaction.users.remove(user).catch(() => null);
                    await user.send(`❌ Désolé, la mission **${mission.titre}** est déjà complète (${mission.maxParticipants} places).`).catch(() => null);
                    return;
                }
            }

            await reaction.message.channel.send({
                content: `✅ **${user}** a accepté la mission : **${mission.titre}** !`
            }).then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        } else if (reaction.emoji.name === '🟠') {
            await reaction.message.channel.send({
                content: `🟠 **${user}** est en réserve pour la mission : **${mission.titre}** !`
            }).then(m => setTimeout(() => m.delete().catch(() => null), 5000));
        }
    } catch (e) { console.error('Reaction error:', e); }
});

process.on('unhandledRejection', error => { console.error('Unhandled promise rejection:', error); });
process.on('uncaughtException', error => { console.error('Uncaught exception:', error); });

client.login(BOT_TOKEN);

// --- Mission Checker ---
setInterval(async () => {
    try {
        if (!fs.existsSync(missionsPath)) return;
        const data = JSON.parse(fs.readFileSync(missionsPath, 'utf8'));
        const now = Date.now();
        let changed = false;

        // Cleanup: Supprimer les missions vieilles de plus de 24h
        const initialCount = data.missions.length;
        data.missions = data.missions.filter(m => now < (m.timestamp + 24 * 3600000));
        if (data.missions.length !== initialCount) changed = true;

        for (const mission of data.missions) {
            const timeDiff = mission.timestamp - now;

            // Si la mission est passée depuis plus de 10 minutes et qu'on n'a rien envoyé, on abandonne
            if (timeDiff < -600000 && !mission.remindedNow) {
                mission.remindedNow = true;
                mission.reminded5m = true;
                mission.reminded15m = true;
                changed = true;
                continue;
            }

            // Priorité au rappel le plus proche du moment présent
            // Now reminder
            if (!mission.remindedNow && now >= mission.timestamp) {
                await sendReminder(mission, "maintenant");
                mission.remindedNow = true;
                mission.reminded5m = true; // Marquer les anciens rappels comme faits s'ils ont été manqués
                mission.reminded15m = true;
                changed = true;
            }
            // 5 minutes reminder
            else if (!mission.reminded5m && now >= (mission.timestamp - 5 * 60000)) {
                await sendReminder(mission, "5 minutes");
                mission.reminded5m = true;
                mission.reminded15m = true;
                changed = true;
            }
            // 15 minutes reminder
            else if (!mission.reminded15m && now >= (mission.timestamp - 15 * 60000)) {
                await sendReminder(mission, "15 minutes");
                mission.reminded15m = true;
                changed = true;
            }

            // Suppression automatique des rappels après 5 minutes
            if (mission.remindedNow && now >= (mission.timestamp + 5 * 60000) && !mission.cleanedUp) {
                try {
                    const guild = await client.guilds.fetch(mission.guildId).catch(() => null);
                    if (guild) {
                        const channel = await guild.channels.fetch(mission.channelId).catch(() => null);
                        if (channel && mission.notificationIds) {
                            for (const nid of mission.notificationIds) {
                                const rMsg = await channel.messages.fetch(nid).catch(() => null);
                                if (rMsg) await rMsg.delete().catch(() => null);
                            }
                        }
                    }
                } catch (e) { }
                mission.cleanedUp = true;
                changed = true;
            }
        }

        if (changed) {
            fs.writeFileSync(missionsPath, JSON.stringify(data, null, 2));
        }
    } catch (e) {
        console.error('Erreur Mission Checker:', e);
    }
}, 30000); // Augmenté à 30s pour être moins agressif

async function sendReminder(mission, timeLabel) {
    try {
        const guild = await client.guilds.fetch(mission.guildId).catch(() => null);
        if (!guild) return;
        const channel = await guild.channels.fetch(mission.channelId).catch(() => null);
        if (!channel) return;
        const message = await channel.messages.fetch(mission.id).catch(() => null);
        if (!message) return;

        const reactionPart = message.reactions.cache.get('✅');
        const reactionRes = message.reactions.cache.get('🟠');
        
        const participants = reactionPart ? await reactionPart.users.fetch() : null;
        const reserves = reactionRes ? await reactionRes.users.fetch() : null;

        const pTags = participants ? participants.filter(u => !u.bot).map(u => u.toString()) : [];
        const rTags = reserves ? reserves.filter(u => !u.bot).map(u => u.toString()) : [];

        const allToPing = [...new Set([...pTags, ...rTags])];

        if (allToPing.length > 0) {
            const reminderMsg = await channel.send({
                content: `${allToPing.join(' ')}\n\n🔔 **RAPPEL MISSION : ${mission.titre}**\nLa mission commence dans **${timeLabel}** ! Soyez prêts.`
            }).catch(console.error);

            if (reminderMsg && mission.notificationIds) {
                mission.notificationIds.push(reminderMsg.id);
            }
        }
    } catch (e) { console.error('sendReminder error:', e); }
}

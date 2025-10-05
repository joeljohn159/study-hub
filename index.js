// index.js (ES module)
import { Client, GatewayIntentBits, PermissionFlagsBits } from "discord.js";
import fs from "fs";

const TOKEN = process.env.BOT_TOKEN; // Keep secret in Render
const ANNOUNCE_CHANNEL = "bot-logs"; // change to your channel name

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

let inviteData = {};
let invites = new Map();
const DATA_FILE = "invites.json";

// Role tier configuration
const ROLE_TIERS = [
    { min: 100, name: "Legend", color: "Gold" },
    { min: 75, name: "Master", color: "Purple" },
    { min: 50, name: "Commander", color: "Red" },
    { min: 30, name: "Captain", color: "Orange" },
    { min: 10, name: "Leader", color: "Blue" },
    { min: 5, name: "Recruiter", color: "Green" },
    { min: 1, name: "Starter", color: "Grey" }
];

if (fs.existsSync(DATA_FILE)) {
    try {
        inviteData = JSON.parse(fs.readFileSync(DATA_FILE));
        console.log("📂 Loaded existing invite data");
    } catch (err) {
        console.error("Error loading invite data:", err);
        inviteData = {};
    }
}

// Save data
function saveData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(inviteData, null, 2));
    } catch (err) {
        console.error("Error saving data:", err);
    }
}

// Recursive count
function getTotalInvites(userId, data, visited = new Set()) {
    if (visited.has(userId)) return 0;
    visited.add(userId);

    const user = data[userId];
    if (!user || !user.invited || user.invited.length === 0) return 0;

    let total = user.invited.length;
    for (const id of user.invited) {
        total += getTotalInvites(id, data, visited);
    }
    return total;
}

// Get appropriate role for invite count
function getRoleForCount(count) {
    for (const tier of ROLE_TIERS) {
        if (count >= tier.min) {
            return tier;
        }
    }
    return null;
}

client.once("clientReady", async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    
    for (const guild of client.guilds.cache.values()) {
        try {
            // Check if bot has permission to manage invites
            const botMember = await guild.members.fetch(client.user.id);
            if (!botMember.permissions.has(PermissionFlagsBits.ManageGuild)) {
                console.error(`❌ Missing "Manage Server" permission in ${guild.name}`);
                console.error(`   Please re-invite the bot with proper permissions!`);
                continue;
            }

            const guildInvites = await guild.invites.fetch();
            invites.set(guild.id, guildInvites);
            console.log(`✅ Cached ${guildInvites.size} invites for ${guild.name}`);
        } catch (err) {
            console.error(`❌ Failed to cache invites for ${guild.name}:`, err.message);
        }
    }
});

// --- Member joins ---
client.on("guildMemberAdd", async (member) => {
    try {
        const guild = member.guild;
        const cachedInvites = invites.get(guild.id);
        
        if (!cachedInvites) {
            console.log("No cached invites, fetching...");
            const newInvites = await guild.invites.fetch();
            invites.set(guild.id, newInvites);
            return;
        }

        const newInvites = await guild.invites.fetch();
        const usedInvite = newInvites.find(
            (inv) => cachedInvites.get(inv.code)?.uses < inv.uses
        );

        invites.set(guild.id, newInvites);

        if (!usedInvite || !usedInvite.inviter) {
            console.log(`${member.user.tag} joined but couldn't determine inviter`);
            return;
        }

        const inviterId = usedInvite.inviter.id;
        const userId = member.id;

        // Initialize data structures
        if (!inviteData[inviterId]) {
            inviteData[inviterId] = { invited: [], invited_by: null };
        }
        if (!inviteData[userId]) {
            inviteData[userId] = { invited: [], invited_by: inviterId };
        } else {
            inviteData[userId].invited_by = inviterId;
        }

        // Add to inviter's list if not already there
        if (!inviteData[inviterId].invited.includes(userId)) {
            inviteData[inviterId].invited.push(userId);
        }

        saveData();

        const totalInvites = getTotalInvites(inviterId, inviteData);
        console.log(`${member.user.tag} joined via ${usedInvite.inviter.tag}'s invite (total: ${totalInvites})`);

        // Update role
        await updateRole(guild, inviterId, totalInvites);

        // Announce
        const announceChannel = guild.channels.cache.find(
            (ch) => ch.name === ANNOUNCE_CHANNEL
        );
        if (announceChannel) {
            announceChannel.send(
                `🎉 <@${member.id}> joined using <@${inviterId}>'s invite! Total for <@${inviterId}>: **${totalInvites}**`
            ).catch(err => console.error("Failed to send join message:", err));
        }
    } catch (err) {
        console.error("Error in guildMemberAdd:", err);
    }
});

// --- Member leaves ---
client.on("guildMemberRemove", async (member) => {
    try {
        const userId = member.id;
        const guild = member.guild;

        if (!inviteData[userId] || !inviteData[userId].invited_by) {
            console.log(`${member.user.tag} left but no invite data found`);
            return;
        }

        const inviterId = inviteData[userId].invited_by;

        // Remove from inviter's list
        if (inviteData[inviterId]) {
            inviteData[inviterId].invited = inviteData[inviterId].invited.filter(
                (id) => id !== userId
            );
        }

        // Don't delete the user data yet - just mark them as left
        // This preserves the tree structure for anyone they invited
        delete inviteData[userId];
        saveData();

        const totalInvites = getTotalInvites(inviterId, inviteData);
        console.log(`${member.user.tag} left, ${inviterId} now has ${totalInvites} invites`);

        // Update role
        await updateRole(guild, inviterId, totalInvites);

        // Announce
        const announceChannel = guild.channels.cache.find(
            (ch) => ch.name === ANNOUNCE_CHANNEL
        );
        if (announceChannel) {
            announceChannel.send(
                `👋 <@${userId}> left. <@${inviterId}> now has **${totalInvites}** invites.`
            ).catch(err => console.error("Failed to send leave message:", err));
        }
    } catch (err) {
        console.error("Error in guildMemberRemove:", err);
    }
});

// --- Role Updater Function ---
async function updateRole(guild, inviterId, totalInvites) {
    try {
        const inviter = await guild.members.fetch(inviterId).catch(() => null);
        if (!inviter) return;

        const tier = getRoleForCount(totalInvites);
        if (!tier) return;

        const roleName = tier.name;

        // Find or create the role
        let role = guild.roles.cache.find((r) => r.name === roleName);
        if (!role) {
            role = await guild.roles.create({
                name: roleName,
                color: tier.color,
                reason: "Invite tracker tier role",
            });
            console.log(`Created role: ${roleName}`);
        }

        // Remove old invite tier roles
        const tierRoleNames = ROLE_TIERS.map(t => t.name);
        const oldRoles = inviter.roles.cache.filter(
            (r) => tierRoleNames.includes(r.name) && r.id !== role.id
        );

        for (const oldRole of oldRoles.values()) {
            await inviter.roles.remove(oldRole).catch(() => {});
        }

        // Add new role if not already present
        if (!inviter.roles.cache.has(role.id)) {
            await inviter.roles.add(role);
            console.log(`Added ${roleName} to ${inviter.user.tag}`);
        }
    } catch (err) {
        console.error("Error updating inviter role:", err.message);
    }
}

// --- Commands ---
client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    
    const prefix = "!";
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === "invites") {
        const targetUser = message.mentions.users.first() || message.author;
        const totalInvites = getTotalInvites(targetUser.id, inviteData);
        const directInvites = inviteData[targetUser.id]?.invited.length || 0;
        
        message.reply(
            `${targetUser.tag} has **${totalInvites}** total invites (${directInvites} direct)`
        );
    }

    if (command === "leaderboard") {
        const entries = Object.entries(inviteData)
            .map(([userId, data]) => ({
                userId,
                total: getTotalInvites(userId, inviteData),
                direct: data.invited.length
            }))
            .sort((a, b) => b.total - a.total)
            .slice(0, 10);

        let leaderboard = "**📊 Invite Leaderboard**\n\n";
        for (let i = 0; i < entries.length; i++) {
            try {
                const user = await client.users.fetch(entries[i].userId);
                leaderboard += `${i + 1}. ${user.tag} - **${entries[i].total}** total (${entries[i].direct} direct)\n`;
            } catch {
                leaderboard += `${i + 1}. Unknown User - **${entries[i].total}** total\n`;
            }
        }

        message.reply(leaderboard || "No invite data yet!");
    }
});

// Error handlers
client.on("error", (error) => {
    console.error("Client error:", error);
});

process.on("unhandledRejection", (error) => {
    console.error("Unhandled rejection:", error);
});

client.login(TOKEN);

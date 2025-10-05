// index.js (ES module)
import { Client, GatewayIntentBits } from "discord.js";
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

if (fs.existsSync(DATA_FILE)) {
    inviteData = JSON.parse(fs.readFileSync(DATA_FILE));
}

// Save data
function saveData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(inviteData, null, 2));
}

// Recursive count
function getTotalInvites(userId, data, visited = new Set()) {
    if (visited.has(userId)) return 0;
    visited.add(userId);

    const user = data[userId];
    if (!user || !user.invited.length) return 0;

    let total = user.invited.length;
    for (const id of user.invited) {
        total += getTotalInvites(id, data, visited);
    }
    return total;
}

client.once("ready", async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    for (const guild of client.guilds.cache.values()) {
        const guildInvites = await guild.invites.fetch();
        invites.set(guild.id, guildInvites);
    }
});

// --- Member joins ---
client.on("guildMemberAdd", async (member) => {
    const guild = member.guild;
    const cachedInvites = invites.get(guild.id);
    const newInvites = await guild.invites.fetch();

    const usedInvite = newInvites.find(
        (inv) => cachedInvites.get(inv.code)?.uses < inv.uses
    );

    invites.set(guild.id, newInvites);

    if (!usedInvite || !usedInvite.inviter) return;

    const inviterId = usedInvite.inviter.id;
    const userId = member.id;

    if (!inviteData[inviterId])
        inviteData[inviterId] = { invited: [], invited_by: null };
    if (!inviteData[userId])
        inviteData[userId] = { invited: [], invited_by: inviterId };

    inviteData[inviterId].invited.push(userId);
    saveData();

    const totalInvites = getTotalInvites(inviterId, inviteData);

    const announceChannel = guild.channels.cache.find(
        (ch) => ch.name === ANNOUNCE_CHANNEL
    );
    announceChannel?.send(
        `🎉 <@${member.id}> joined using <@${inviterId}>'s invite! Total for <@${inviterId}>: **${totalInvites}**`
    );

    await updateRole(guild, inviterId, totalInvites);
});

// --- Member leaves ---
client.on("guildMemberRemove", async (member) => {
    const userId = member.id;
    const guild = member.guild;

    if (!inviteData[userId] || !inviteData[userId].invited_by) return;
    const inviterId = inviteData[userId].invited_by;

    if (inviteData[inviterId]) {
        inviteData[inviterId].invited = inviteData[inviterId].invited.filter(
            (id) => id !== userId
        );
    }

    delete inviteData[userId];
    saveData();

    const totalInvites = getTotalInvites(inviterId, inviteData);
    await updateRole(guild, inviterId, totalInvites);

    const announceChannel = guild.channels.cache.find(
        (ch) => ch.name === ANNOUNCE_CHANNEL
    );
    announceChannel?.send(
        `👋 <@${userId}> left. <@${inviterId}> now has **${totalInvites}** invites.`
    );
});

// --- Role Updater Function ---
async function updateRole(guild, inviterId, totalInvites) {
    try {
        const inviter = await guild.members.fetch(inviterId);
        const roleName = `Inviter - ${totalInvites}`;
        let role = guild.roles.cache.find((r) => r.name === roleName);

        if (!role) {
            role = await guild.roles.create({
                name: roleName,
                color: "Blue",
                reason: "Invite tracker role",
            });
        }

        inviter.roles.cache
            .filter((r) => r.name.startsWith("Inviter -") && r.id !== role.id)
            .forEach((r) => inviter.roles.remove(r).catch(() => { }));

        await inviter.roles.add(role).catch(() => { });
    } catch (err) {
        console.error("Error updating inviter role:", err);
    }
}

client.login(TOKEN);

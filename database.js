require('dotenv').config();
const bcrypt = require('bcrypt');
const { MongoClient, ServerApiVersion } = require("mongodb");
const { playerTemplate } = require('./mongoTemplates');
const badWords = require('./badwords');

const mongoDB = new MongoClient(process.env.mongoConnectionStr, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});
const whichDatabase = process.env.isDev == "yes" ? "takepoint-dev" : "takepoint";
const db = mongoDB.db(whichDatabase);

const collections = {
    reservedUsers: db.collection("reservedUsers"),
    players: db.collection("players"),
    sessions: db.collection("sessions"),
    games: db.collection("games")
};

const queries = {
    async register(username, password, email) {
        let usernameLower = username.toLowerCase();
        let emailLower = email.toLowerCase();
        let resp = await collections.players.findOne({ 
            $or: [{ usernameLower }, { email: emailLower }]
        });

        if (resp) {
            if (resp.allowReregister && resp.usernameLower === usernameLower && resp.email === emailLower) {
                let hash = await bcrypt.hash(password, 8);
                resp.passwordHash = hash;
                resp.email = emailLower;
                resp.allowReregister = false;
                await collections.players.replaceOne({ username: resp.username }, resp);
                return { error: false, username: resp.username };
            } else {
                if (resp.usernameLower === usernameLower) {
                    return { error: true, desc: "A player with that username already exists!", code: 1 };
                } else if (resp.email === emailLower) {
                    return { error: true, desc: "A player with that email already exists!", code: 2 };
                }
                return { error: true, desc: "Generic" };
            }
        }

        let isReserved = await collections.reservedUsers.findOne({ usernameLower });
        if (isReserved) {
            return { error: true, desc: 'That username is reserved as it belongs to a notable player. Check the Discord for help.', code: 1 };
        }

        for (let word of badWords) {
            if (usernameLower.includes(word)) {
                return { error: true, desc: 'Username may include profanity. Check the Discord for help.', code: 1 };
            }
        }

        let hash = await bcrypt.hash(password, 8);
        let player = playerTemplate({
            username,
            email: emailLower,
            passwordHash: hash
        });
        await collections.players.insertOne(player);
        return { error: false, username };
    },

    async login(usernameEmail, password) {
        let usernameEmailLower = usernameEmail.toLowerCase();
        let player = await collections.players.findOne({
            $or: [{ usernameLower: usernameEmailLower }, { email: usernameEmailLower }]
        });

        if (player && bcrypt.compareSync(password, player.passwordHash)) {
            return { error: false, username: player.username, perms: player.perms || 0 };
        } else {
            return { error: true, desc: "The provided username and password does not exist in our database.", code: 0 };
        }
    },

    async setSession(username, cookie) {
        let res = await collections.sessions.updateOne(
            { username },
            { $set: { cookie } },
            { upsert: true }
        );

        if (res.modifiedCount) {
            return { error: false };
        } else {
            return { error: true };
        }
    },

    async resumeSession(cookie) {
        let res = await collections.sessions.findOne({ cookie });
        if (!res) return { error: true };

        let player = await collections.players.findOne({ username: res.username });
        return { error: false, username: res.username, perms: player.perms || 0 };
    },

    async insertGame(username, stats) {
        stats.username = username;
        await collections.games.insertOne(stats);
    },

    async updateStats(username, stats, funFacts) {
        let player = await collections.players.findOne({ usernameLower: username.toLowerCase() });
        if (!player) return;

        let weaponList = ["pistol", "assault", "sniper", "shotgun"];
        let perkList = ["barrier", "health", "gas", "frag", "turret", "sd"];
        
        player.score += stats.score;
        funFacts['Score gained'].incrementValue(stats.score);
        player.timePlayed += stats.timeAlive;
        player.spm = parseFloat((player.score / (player.timePlayed / 1000 / 60)).toFixed(2));
        player.pointsTaken += stats.pointsTaken;
        player.pointsNeutralized += stats.pointsNeutralized;
        player.kills += stats.kills;
        funFacts['Kills'].incrementValue(stats.kills);
        if (stats.kills > player.killstreak) player.killstreak = stats.kills;
        player.deaths++;
        player.kdr = parseFloat((player.kills / player.deaths).toFixed(2));
        player.shotsFired += stats.bulletsFired;
        player.shotsHit += stats.bulletsHit;
        player.accuracy = parseFloat((100 * player.shotsHit / player.shotsFired).toFixed(2));
        player.damageDealt += stats.damageDealt;
        funFacts['Damage dealt'].incrementValue(stats.damageDealt);
        player.distanceCovered += Math.round(stats.distanceCovered);
        player.doubleKills += stats.doubleKills;
        player.tripleKills += stats.tripleKills;
        player.multiKills += stats.multiKills;
        
        let pistol = player.weapons.pistol;
        let pistolUpdates = stats.weapons[0];
        pistol.kills += pistolUpdates.kills;
        funFacts['Kills with pistol'].incrementValue(pistolUpdates.kills);
        pistol.shotsFired += pistolUpdates.bulletsFired;
        pistol.shotsHit += pistolUpdates.bulletsHit;
        pistol.damageDealt += pistolUpdates.damageDealt;
        
        if (stats.weaponChosenID !== undefined) {
            let id = stats.weaponChosenID;
            let weaponName = weaponList[id];
            let weaponStats = player.weapons[weaponName];
            //sometimes weaponStats is undefined, causing a crash...
            if (weaponStats) {
                weaponStats.kills += stats.weapons[id].kills;
                funFacts['Kills with ' + weaponName].incrementValue(stats.weapons[id].kills);
                weaponStats.shotsFired += stats.weapons[id].bulletsFired;
                weaponStats.shotsHit += stats.weapons[id].bulletsHit;
                weaponStats.accuracy = parseFloat((100 * weaponStats.shotsHit / weaponStats.shotsFired).toFixed(2));
                weaponStats.damageDealt += stats.weapons[id].damageDealt;
                weaponStats.selected++;
                weaponStats.timePlayed += Date.now() - stats.weaponChosenTime;
                
                if (!weaponStats.attachments) weaponStats.attachments = { 1: 0, 2: 0 };
                if (stats.attachmentID) weaponStats.attachments[stats.attachmentID]++;
                pistol.timePlayed += stats.weaponChosenTime - stats.spawnTime;
            }
        } else {
            pistol.timePlayed += Date.now() - stats.spawnTime;
        }

        funFacts['Hours played'].incrementValue((Date.now() - stats.spawnTime) / (60 * 60 * 1000));
        player.upgrades.speed += stats.upgrades.speed;
        player.upgrades.reload += stats.upgrades.reload;
        player.upgrades.mags += stats.upgrades.mags;
        player.upgrades.view += stats.upgrades.view;
        player.upgrades.heal += stats.upgrades.heal;
        
        if (stats.perkID) player.perks[perkList[stats.perkID - 1]]++;
        
        player.lastActive = Date.now();
        await collections.players.replaceOne({ username }, player);
    },

    async deleteOldGames(olderThan) {
        let oldestTs = Date.now() - olderThan * (24 * 60 * 60 * 1000);
        await collections.games.deleteMany({ spawnTime: { $lt: oldestTs } });
    }
};

module.exports = queries;
require('dotenv').config();
const axios = require('axios');
const { MongoClient, ServerApiVersion } = require("mongodb");
const cors = require('cors');
const express = require('express');
const sha256 = require('js-sha256').sha256;
const crypto = require('crypto');
const Server = require("./server");
const Cloudflare = require('./cloudflare');
const { playerTemplate } = require('./mongoTemplates');
const badWords = require('./badwords');

const app = express();
const CFWorker = new Cloudflare(process.env.cloudflareZoneID, process.env.cloudflareAPIKey, process.env.cloudflareAPIEmail);
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
const sessions = new Map();
const sessionTimeout = 60;

const port = 8080;
const countryToRegion = {
    "US": "North America",
    "CA": "North America",
    "MX": "North America",
    "DE": "Europe",
    "PL": "Europe",
    "NL": "Europe",
    "SE": "Europe",
    "IN": "India",
    "JP": "Japan",
    "AU": "Australia"
};
let servers = [];
//TODO: In the future, we select highscores and fun facts from database
let funFacts = [
    ["Bug fixes", "1,000"],
    ["Sample text", "1"]
];
let leaderboard = [];
let leaderboardDate = getCurrentDate(-5);

function getCurrentDate(offset) {
    let d = new Date();
    let localTime = d.getTime();
    let localOffset = d.getTimezoneOffset() * 60000;
    let utc = localTime + localOffset;
    let actualTime = utc + (3600000 * offset);
    return new Date(actualTime).getDate();
}

function createGameState() {
    let funFact = funFacts[Math.floor(Math.random() * funFacts.length)];
    let gameState = {
        [funFact[0]]: funFact[1]
    };
    for (let i = 0; i < leaderboard.length; i++) {
        gameState[i.toString()] = leaderboard[i];
    }
    return gameState;
}

function isServerAuthorized(key) {
    return key == process.env.registerKey;
}

async function generateSession(username) {
    let sessionCookie = generateCookie();
    sessions.set(username, { lastRefresh: Date.now(), cookie: sessionCookie });
    let res = await queryDb({ type: "setSession", data: { username: username, cookie: sessionCookie } })
    if (!res.error) return true;
    else return false;
}

function generateCookie() {
    return crypto.randomBytes(64).toString('hex');
}

async function queryDb(query) {
    let data = query.data;
    switch (query.type) {
        case "register": {
            let resp = await collections.players.find({ 
                $or: [{ usernameLower: data.username.toLowerCase() }, { email: data.email }]
            }).toArray();
            if (resp.length > 0) {
                if (resp[0].usernameLower == data.username.toLowerCase()) {
                    return { error: true, desc: "A player with that username already exists!", code: 1 };
                } else if (resp[0].email == data.email) {
                    return { error: true, desc: "A player with that email already exists!", code: 2 };
                }
                return { error: true, desc: "Generic" };
            }
            let isReserved = await collections.reservedUsers.find({
                usernameLower: data.username.toLowerCase()
            }).toArray();
            if (isReserved.length > 0) {
                return { error: true, desc: 'That username is reserved as it belongs to a notable player. Check the Discord for help.', code: 1 };
            }
            for (word of badWords) {
                if (data.username.toLowerCase().includes(word)) {
                    return { error: true, desc: 'Username may include profanity. Check the Discord for help.', code: 1 };
                }
            }
            await collections.players.insertOne(playerTemplate(data));
            return { error: false, username: data.username };
        }
        case "login": {
            let resp = await collections.players.find({
                $and: [
                    { $or: [ { usernameLower: data.usernameEmail.toLowerCase() }, { email: data.usernameEmail.toLowerCase() } ] }, 
                    { passwordHash: data.passwordHash }
                ]
            }).toArray();
            if (resp.length) return { error: false, username: resp[0].username };
            else return { error: true, desc: "The provided username and password does not exist in our database.", code: 0 };
        }
        case "setSession": {
            let res = await collections.sessions.updateOne(
                { username: data.username },
                { $set: { 
                    cookie: data.cookie
                } },
                { upsert: true }
            )
            if (res.modifiedCount) return { error: false };
            else return { error: true };
        }
        case "resumeSession": {
            let res = await collections.sessions.find({
                cookie: data.cookie
            }).toArray();
            if (res.length) return { error: false, username: res[0].username };
            else return { error: true };
        }
        case "insertGame": {
            data.stats.username = data.username;
            await collections.games.insertOne(data.stats);
            return;
        }
        case "updateStats": {
            let stats = data.stats;
            let username = data.username;
            let player = await collections.players.find({
                usernameLower: username.toLowerCase()
            }).toArray();
            if (!player.length) return;
            player = player[0];
            let weaponList = ["pistol", "assault", "sniper", "shotgun"];
            let perkList = ["barrier", "health", "gas", "frag", "turret", "sd"];
            player.score += stats.score;
            player.timePlayed += stats.timeAlive;
            player.spm = parseFloat((player.score / (player.timePlayed / 1000 / 60)).toFixed(2))
            player.pointsTaken += stats.pointsTaken;
            player.pointsNeutralized += stats.pointsNeutralized;
            player.kills += stats.kills;
            if (stats.kills > player.killstreak) player.killstreak = stats.kills;
            player.deaths++;
            player.kdr = parseFloat((player.kills / player.deaths).toFixed(2));
            player.shotsFired += stats.bulletsFired;
            player.shotsHit += stats.bulletsHit;
            player.accuracy = parseFloat((100 * player.shotsHit / player.shotsFired).toFixed(2));
            player.damageDealt += stats.damageDealt;
            player.distanceCovered += Math.round(stats.distanceCovered);
            player.doubleKills += stats.doubleKills;
            player.tripleKills += stats.tripleKills;
            player.multiKills += stats.multiKills;
            let pistol = player.weapons.pistol;
            let pistolUpdates = stats.weapons[0];
            pistol.kills += pistolUpdates.kills;
            pistol.shotsFired += pistolUpdates.bulletsFired;
            pistol.shotsHit += pistolUpdates.bulletsHit;
            pistol.damageDealt += pistolUpdates.damageDealt;
            if (stats.weaponChosenID) {;
                let weaponStats = player.weapons[weaponList[stats.weaponChosenID]];
                let id = stats.weaponChosenID;
                weaponStats.kills += stats.weapons[id].kills;
                weaponStats.shotsFired += stats.weapons[id].bulletsFired;
                weaponStats.shotsHit += stats.weapons[id].bulletsHit;
                weaponStats.accuracy = parseFloat((100 * weaponStats.shotsHit / weaponStats.shotsFired).toFixed(2));
                weaponStats.damageDealt += stats.weapons[id].damageDealt++;
                weaponStats.selected++;
                weaponStats.timePlayed += Date.now() - stats.weaponChosenTime;
                pistol.timePlayed += stats.weaponChosenTime - stats.spawnTime;
            } else {
                pistol.timePlayed += Date.now() - stats.spawnTime;
            }
            player.upgrades.speed += stats.upgrades.speed;
            player.upgrades.reload += stats.upgrades.reload;
            player.upgrades.mags += stats.upgrades.mags;
            player.upgrades.view += stats.upgrades.view;
            player.upgrades.heal += stats.upgrades.heal;
            if (stats.perkID) player.perks[perkList[stats.perkID - 1]]++;
            player.lastActive = Date.now();
            await collections.players.replaceOne(
                { username: username },
                player
            );
        }
    }
}

async function getServerAttrs(ipv4) {
    let resp = await axios.get(`http://ip-api.com/json/${ipv4}`);
    let { data } = resp;
    let accessURL = ipv4;
    if (CFWorker.status == 1) {
        let test = await CFWorker.getSubdomain(ipv4);
        if (test != "") accessURL = test;
    }
    let attrs = {
        region: countryToRegion[data.countryCode],
        city: data.city.split(" ")[0],
        url: accessURL
    };
    return attrs;
}

app.use(express.json());
app.use(cors({ origin: "*" }));

app.listen(port, async function () {
    console.log(`API listening on ${port}`);
});

app.get('/', (req, res) => {
    res.status(200).send("Hello, world!");
});

app.get('/gameState', (req, res) => {
    res.status(200);
    res.send(JSON.stringify(createGameState()));
});

app.post('/find_instances', (req, res) => {
    res.type('application/json');
    res.status(200);
    res.send(JSON.stringify(servers.map(server => server.data)));
});

app.post('/register_instance', async (req, res) => {
    let serverInfo = req.body;
    if (!isServerAuthorized(serverInfo.auth.registerKey)) return;
    let server = servers.find(e => e.id == serverInfo.auth.id);
    if (!server) {
        if (!serverInfo.override) {
            let sourceIP = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
            if (sourceIP.includes(":")) {
                let resp = await axios.get("https://api.ipify.org");
                sourceIP = resp.data;
            }
            let attrs = await getServerAttrs(sourceIP);
            serverInfo.data.region = attrs.region;
            serverInfo.data.city = attrs.city;
            serverInfo.data.url = attrs.url;
        }
        server = new Server(serverInfo.auth.id, serverInfo.data);
        servers.push(server);
    }
    else {
        server.refresh(serverInfo.data);
    }
    res.status(200);
    res.end();
});

app.post('/gameStats', async (req, res) => {
    let body = req.body;
    if (!isServerAuthorized(body.auth.registerKey) || !servers.find(e => e.id == body.auth.id)) return;
    let stats = JSON.parse(body.data.stats);
    let username = body.data.username;
    if (username != "N/A") for (let i = 0; i < 5; i++) {
        if (!leaderboard[i] || stats.score > leaderboard[i].score) {
            let shouldUpdateScore = true;
            for (let j = 0; j < 5; j++) {
                if (!leaderboard[j]) break;
                if (leaderboard[j].username == username && stats.score > leaderboard[j].score) {
                    leaderboard.splice(j, 1);
                    break;
                } else if (leaderboard[j].username == username) {
                    shouldUpdateScore = false;
                    break;
                }
            }
            if (!shouldUpdateScore) break;
            leaderboard.splice(i, 0, { username: username, score: stats.score });
            if (leaderboard.length > 5) leaderboard.pop();
            break;
        }
    }
    await queryDb({
        type: "insertGame",
        data: {
            username, stats
        }
    });
    if (username != "N/A") await queryDb({
        type: "updateStats",
        data: {
            username, stats
        }
    });
    res.status(200);
    res.end();
});

app.post('/auth/*', async (req, res) => {
    let body = req.body;
    if (!isServerAuthorized(body.auth.registerKey) || !servers.find(e => e.id == body.auth.id)) return;
    let loc = req.url.split("/")[2];
    if (loc == "updateSessions") {
        let sessionsOnServer = JSON.parse(body.data.sessions);
        for (let username of sessionsOnServer) {
            if (sessions.has(username)) {
                let session = sessions.get(username);
                session.lastRefresh = Date.now();
            }
            else generateSession(username);
        }
    }
    else if (loc == "register") {
        let resp = await queryDb({ 
            type: "register", 
            data: {
                username: body.data.username,
                email: body.data.email,
                passwordHash: sha256(body.data.password)
            }
        });
        if (!resp.error) {
            let res = await generateSession(resp.username);
            if (res) resp.cookie = sessions.get(resp.username).cookie;
        }
        res.write(JSON.stringify(resp));
        res.status(200);
        res.end();
        return;
    }
    else if (loc == "login") {
        let resp = await queryDb({ 
            type: "login", 
            data: {
                usernameEmail: body.data.usernameEmail,
                passwordHash: sha256(body.data.password)
            }
        });
        if (!resp.error) {
            if (sessions.has(resp.username)) {
                resp.error = true;
                resp.desc = "You are already logged in. Try again in 60 seconds.";
                resp.code = 0;
            } else {
                let res = await generateSession(resp.username);
                if (res) resp.cookie = sessions.get(resp.username).cookie;
            }
        }
        res.write(JSON.stringify(resp));
        res.status(200);
        res.end();
    }
    else if (loc == "loginCookie") {
        let resp = await queryDb({ 
            type: "resumeSession", 
            data: {
                cookie: body.data.cookie
            }
        });
        if (!resp.error) {
            if (sessions.has(resp.username)) {
                resp.error = true;
            } else {
                let res = await generateSession(resp.username);
                if (res) resp.cookie = sessions.get(resp.username).cookie;
            }
        }
        res.write(JSON.stringify(resp));
        res.status(200);
        res.end();
    }
    else if (loc == "logout") {
        sessions.delete(body.data.username);
        res.status(200);
        res.end();
    }
});

const loops = {
    clearInactiveServers: setInterval(() => {
        servers = servers.filter(server => Date.now() - server.refreshedAt < 30 * 1000);
    }, 3000),
    clearInactiveSessions: setInterval(() => {
        for (let [username, sessionInfo] of sessions) {
            if (Date.now() - sessionInfo.lastRefresh > sessionTimeout * 1000) {
                sessions.delete(username);
            }
        }
    }, 10000),
    resetDailyLB: setInterval(() => {
        if (getCurrentDate(-5) != leaderboardDate) {
            leaderboard = [];
            leaderboardDate = getCurrentDate();
        }
    }, 5000)
};

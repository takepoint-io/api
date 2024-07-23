require('dotenv').config();
const axios = require('axios');
const cors = require('cors');
const express = require('express');
const crypto = require('crypto');
const Server = require("./server");
const Cloudflare = require('./cloudflare');
const db = require('./database');

const app = express();
const CFWorker = new Cloudflare(process.env.cloudflareZoneID, process.env.cloudflareAPIKey, process.env.cloudflareAPIEmail);

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
let funFactTypes = [
    "Kills", "Damage dealt",
    "Kills with pistol", "Kills with assault",
    "Kills with sniper", "Kills with shotgun",
    "Score gained", "Hours played"
];
let funFacts = {};
initFunFacts();
let leaderboard = [];
let leaderboardDate = getCurrentDate(-5);

function initFunFacts() {
    for (let name of funFactTypes) {
        funFacts[name] = {
            name: name,
            internalValue: 0,
            incrementValue: (amount) => {
                funFacts[name].internalValue += amount;
            },
            get value() {
                return funFacts[name].internalValue.toLocaleString(undefined, {
                    maximumFractionDigits: 2
                });
            }
        }
    }
}

function getCurrentDate(offset) {
    let d = new Date();
    let localTime = d.getTime();
    let localOffset = d.getTimezoneOffset() * 60000;
    let utc = localTime + localOffset;
    let actualTime = utc + (3600000 * offset);
    return new Date(actualTime).getDate();
}

function createGameState() {
    let keys = Object.keys(funFacts);
    let funFact = funFacts[keys[Math.floor(Math.random() * keys.length)]];
    let gameState = {
        [funFact.name]: funFact.value
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
    let res = await db.setSession(username, sessionCookie);
    if (!res.error) return true;
    else return false;
}

function generateCookie() {
    return crypto.randomBytes(64).toString('hex');
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
    await db.insertGame(username, stats);
    if (username != "N/A") await db.updateStats(username, stats, funFacts);
    res.status(200);
    res.end();
});

app.post('/auth/*', async (req, res) => {
    let body = req.body;
    if (!isServerAuthorized(body.auth.registerKey) || !servers.find(e => e.id == body.auth.id)) return;
    let data = body.data;
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
        let { username, email, password } = data;
        let resp = await db.register(username, email, password);
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
        let { usernameEmail, password } = data;
        let resp = await db.login(usernameEmail, password);
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
        let resp = await db.resumeSession(data.cookie);
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
        sessions.delete(data.username);
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
            initFunFacts();
            leaderboard = [];
            leaderboardDate = getCurrentDate(-5);
            db.deleteOldGames(7);
        }
    }, 5000)
};

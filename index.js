require('dotenv').config();
const axios = require('axios');
const cors = require('cors');
const express = require('express');
const Server = require("./server");
const Cloudflare = require('./cloudflare');

const app = express();
const CFWorker = new Cloudflare(process.env.cloudflareZoneID, process.env.cloudflareAPIKey, process.env.cloudflareAPIEmail);

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
let leaderboard = [
    {"username" : "placeholder", "score" : 1337}
];

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
    if (serverInfo.auth.registerKey != process.env.registerKey) return;
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
})

setInterval(() => {
    servers = servers.filter(server => Date.now() - server.refreshedAt < 30 * 1000);
}, 3000)
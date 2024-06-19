require('dotenv').config();
const axios = require('axios');
const { MongoClient, ServerApiVersion } = require("mongodb");
const cors = require('cors');
const express = require('express');
const sha256 = require('js-sha256').sha256;
const Server = require("./server");
const Cloudflare = require('./cloudflare');
const { playerTemplate } = require('./mongoTemplates');

const app = express();
const CFWorker = new Cloudflare(process.env.cloudflareZoneID, process.env.cloudflareAPIKey, process.env.cloudflareAPIEmail);
const mongoDB = new MongoClient(process.env.mongoConnectionStr, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});
const db = mongoDB.db("takepoint");
const players = db.collection("players");

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

async function queryDb(query) {
    switch (query.type) {
        case "register": {
            let data = query.data;
            let resp = await players.find({ 
                $or: [{ username: data.username }, { email: data.email }]
            }).toArray();
            if (resp.length > 0) {
                if (resp[0].username == data.username) {
                    return { error: true, desc: "A player with that username already exists!", code: 1 };
                } else if (resp[0].email == data.email) {
                    return { error: true, desc: "A player with that email already exists!", code: 2 };
                }
                return { error: true, desc: "Generic" };
            }
            let result = await players.insertOne(playerTemplate(data));
            return { error: false };
        }
        case "login": {
            let data = query.data;
            let resp = await players.find({
                $and: [
                    { $or: [ { username: data.usernameEmail }, { email: data.usernameEmail } ] }, 
                    { passwordHash: data.passwordHash }
                ]
            }).toArray();
            if (resp.length) return { error: false, username: resp[0].username };
            else return { error: true, desc: "The provided username and password does not exist in our database.", code: 0 };
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

app.post('/auth/*', async (req, res) => {
    let body = req.body;
    if (body.auth.registerKey != process.env.registerKey || !servers.find(e => e.id == body.auth.id)) return;
    let loc = req.url.split("/")[2];
    if (loc == "register") {
        let resp = await queryDb({ 
            type: "register", 
            data: {
                username: body.data.username,
                email: body.data.email,
                passwordHash: sha256(body.data.password)
            }
        });
        res.write(JSON.stringify(resp));
        res.status(200);
        res.end();
        return;
    } 
    if (loc == "login") {
        let resp = await queryDb({ 
            type: "login", 
            data: {
                usernameEmail: body.data.usernameEmail,
                passwordHash: sha256(body.data.password)
            }
        });
        res.write(JSON.stringify(resp));
        res.status(200);
        res.end();
        return;
    }
});

setInterval(() => {
    servers = servers.filter(server => Date.now() - server.refreshedAt < 30 * 1000);
}, 3000)
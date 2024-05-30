require('dotenv').config();
const express = require('express');
const app = express();
const cors = require('cors');
const Server = require("./server");
const port = 8080;
let servers = [];
let gameState = {
    "Hours played" : "137,510.00",
    "0": {"username" : "vxxxv", "score" : 28273},
    "1": {"username" : "Kawmi", "score" : 27028},
    "2": {"username" : "Starboy", "score" : 26709},
    "3": {"username" : "Newkawasaki", "score" : 26558},
    "4": {"username" : "davizin", "score" : 25384}
}

app.use(express.json());
app.use(cors({ origin: "*" }));

app.listen(port, function () {
    console.log(`API listening on ${port}`);
});

app.get('/', (req, res) => {
    res.status(200).send("Hello, world!");
});

app.get('/gameState', (req, res) => {
    res.status(200);
    res.send(JSON.stringify(gameState));
});

app.post('/find_instances', (req, res) => {
    res.type('application/json');
    res.status(200);
    res.send(JSON.stringify(servers.map(server => server.data)));
});

app.post('/register_instance', (req, res) => {
    let serverInfo = req.body;
    if (serverInfo.auth.registerKey != process.env.registerKey) return;
    let server = servers.find(e => e.id == serverInfo.auth.id);
    if (!server) {
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
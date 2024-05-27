require('dotenv').config();
const axios = require('axios');

axios.post('http://127.0.0.1:8080/register_instance', {
    auth: {
        id: 0,
        registerKey: process.env.registerKey
    },
    data: {
        region: "North America",
        city: "Dallas",
        game_type: "3TEAM",
        owner: null,
        label: null,
        url: "testing.com",
        players: 0,
        capacity: 120,
        short_id: null
    }
})
.then(resp => {
    if (resp.status == 200) {
        console.log("Successfully registered a test instance.");
    }
    else {
        throw "oops";
    }
})
.catch(error => {
    console.log('Couldn\'t register an instance. Did you run "node index.js"?');
});
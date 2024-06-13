class Server {
    constructor(id, data) {
        this.id = id;
        this.init = false;
        this.data = {};
        this.refresh(data);
    }

    refresh(data) {
        this.refreshedAt = Date.now();
        this.setData(data);
    }

    setData(data) {
        if (!this.init) {
            this.data = {
                region: data.region,
                city: data.city,
                url: data.url,
                game_type: "3TEAM",
                owner: null,
                label: null,
                players: data.players,
                capacity: data.capacity,
                short_id: null
            }
            this.init = true;
        } else {
            this.data.players = data.players;
        }
    }
}

module.exports = Server;
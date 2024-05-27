class Server {
    constructor(id, data) {
        this.id = id;
        this.data = data;
        this.refreshedAt = Date.now();
    }

    refresh(data) {
        this.refreshedAt = Date.now();
        this.data = data;
    }
}

module.exports = Server;
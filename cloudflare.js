const axios = require('axios');

class Cloudflare {
    constructor(zoneID, apiKey, apiEmail) {
        this.zoneID = zoneID;
        this.apiKey = apiKey;
        this.apiEmail = apiEmail;
        if (!this.zoneID || !this.apiKey || !this.apiEmail) {
            this.status = 0;
        } else {
            this.status = 1;
        }
    }

    async getSubdomain(ipv4) {
        let resp = await axios.get(`https://api.cloudflare.com/client/v4/zones/${this.zoneID}/dns_records`,
            { headers: { 'Content-Type': 'application/json', 'X-Auth-Email': this.apiEmail, 'X-Auth-Key': this.apiKey } }
        )
        let { data } = resp;
        if (data.success) {
            let subdomain = data.result.find(e => e.type == "A" && e.content == ipv4);
            return subdomain.name;
        } else return "";
    }
}

module.exports = Cloudflare;
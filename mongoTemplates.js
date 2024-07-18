const templates = {
    playerTemplate: (data) => {
        return {
            createdAt: Date.now(),
            pointsTaken: 0,
            pointsNeutralized: 0,
            score: 0,
            timePlayed: 0,
            kdr: 0,
            spm: 0,
            kills: 0,
            killstreak: 0,
            deaths: 0,
            accuracy: 0,
            shotsFired: 0,
            shotsHit: 0,
            damageDealt: 0,
            distanceCovered: 0,
            doubleKills: 0,
            tripleKills: 0,
            multiKills: 0,
            lastActive: Date.now(),
            weapons: {
                pistol: {
                    kills: 0,
                    timePlayed: 0,
                    shotsFired: 0,
                    shotsHit: 0,
                    accuracy: 0,
                    damageDealt: 0
                },
                sniper: {
                    selected: 0,
                    kills: 0,
                    timePlayed: 0,
                    shotsFired: 0,
                    shotsHit: 0,
                    accuracy: 0,
                    damageDealt: 0
                },
                shotgun: {
                    selected: 0,
                    kills: 0,
                    timePlayed: 0,
                    shotsFired: 0,
                    shotsHit: 0,
                    accuracy: 0,
                    damageDealt: 0
                },
                assault: {
                    selected: 0,
                    kills: 0,
                    timePlayed: 0,
                    shotsFired: 0,
                    shotsHit: 0,
                    accuracy: 0,
                    damageDealt: 0
                }
            },
            upgrades: {
                speed: 0,
                reload: 0,
                mags: 0,
                view: 0,
                heal: 0
            },
            perks: {
                health: 0,
                barrier: 0,
                gas: 0,
                frag: 0,
                turret: 0,
                sd: 0
            },
            badges: [],
            usernameLower: data.username.toLowerCase(),
            username: data.username,
            email: data.email,
            passwordHash: data.passwordHash
        };
    }
}

module.exports = templates;

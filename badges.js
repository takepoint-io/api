const badges = [
    {
        name: "pacifist",
        info: "Reached 100,000 score without dealing damage",
        eligible(game) {
            if (game.score >= 100_000 && game.damageDealt == 0) return true;
        }
    }
]

module.exports = {
    allEligible(game) {
        let eligibleFor = [];
        for (let badge of badges) {
            if (badge.eligible(game)) {
                eligibleFor.push({
                    name: badge.name,
                    info: badge.info,
                    timestamp: Date.now()
                });
            }
        }
        return eligibleFor;
    }
}
// name -> evolvesFrom (null for Basics) for every real Base Set Pokémon,
// mirrored from the client's CARD_STATS (data-cards.js) -- kept as its own
// small file rather than duplicating the client's full stats (attacks, HP,
// etc.) since custom-deck validation (see pureEconomy.js's
// validateCustomDeck) only ever needs "is this name a Basic Pokémon?".
// Regenerate by re-running the same extraction script if CARD_STATS ever
// adds/removes a Pokémon.
module.exports = {
  "Beedrill": "Kakuna", "Bulbasaur": null, "Farfetch'd": null, "Gyarados": "Magikarp",
  "Hitmonchan": null, "Ivysaur": "Bulbasaur", "Kakuna": "Weedle", "Machoke": "Machop",
  "Machop": null, "Magikarp": null, "Onix": null, "Sandshrew": null, "Squirtle": null,
  "Starmie": "Staryu", "Staryu": null, "Wartortle": "Squirtle", "Weedle": null,
  "Mewtwo": null, "Kadabra": "Abra", "Jynx": null, "Haunter": "Gastly", "Gastly": null,
  "Drowzee": null, "Abra": null, "Pikachu": null, "Magnemite": null,
  "Ninetales": "Vulpix", "Arcanine": "Growlithe", "Charmeleon": "Charmander",
  "Growlithe": null, "Nidoran ♂": null, "Tangela": null, "Vulpix": null,
  "Charmander": null, "Clefairy Doll": null, "Alakazam": "Kadabra",
  "Blastoise": "Wartortle", "Chansey": null, "Charizard": "Charmeleon",
  "Clefairy": null, "Machamp": "Machoke", "Magneton": "Magnemite",
  "Nidoking": "Nidorino", "Poliwrath": "Poliwhirl", "Raichu": "Pikachu",
  "Venusaur": "Ivysaur", "Zapdos": null, "Dragonair": "Dratini",
  "Dugtrio": "Diglett", "Electabuzz": null, "Electrode": "Voltorb",
  "Pidgeotto": "Pidgey", "Dewgong": "Seel", "Dratini": null, "Magmar": null,
  "Nidorino": "Nidoran ♂", "Poliwhirl": "Poliwag", "Porygon": null,
  "Raticate": "Rattata", "Seel": null, "Caterpie": null, "Diglett": null,
  "Doduo": null, "Koffing": null, "Metapod": "Caterpie", "Pidgey": null,
  "Poliwag": null, "Ponyta": null, "Rattata": null, "Voltorb": null
};

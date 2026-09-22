// Server-side mirror of the 4 real precon decklists (data-decks.js's own
// DECKLISTS, precon keys only). Firebase only ever deploys the functions/
// directory (functions.source: "functions" in firebase.json) -- a
// require('../data-decks.js') from here would work locally but silently
// break in a real deploy, so this is a deliberate copy, not a shortcut.
// Keep in sync with data-decks.js by hand if those decklists ever change.
const STARTER_DECKLISTS = {
  overgrowth: [
    { name: "Gyarados", count: 1 },
    { name: "Magikarp", count: 2 },
    { name: "Starmie", count: 3 },
    { name: "Staryu", count: 4 },
    { name: "Beedrill", count: 1 },
    { name: "Kakuna", count: 2 },
    { name: "Ivysaur", count: 2 },
    { name: "Weedle", count: 4 },
    { name: "Bulbasaur", count: 4 },
    { name: "Potion", count: 1 },
    { name: "Bill", count: 2 },
    { name: "Super Potion", count: 2 },
    { name: "Switch", count: 2 },
    { name: "Gust of Wind", count: 2 },
    { name: "Water Energy", count: 12 },
    { name: "Grass Energy", count: 16 }
  ],
  blackout: [
    { name: "Hitmonchan", count: 1 },
    { name: "Farfetch'd", count: 2 },
    { name: "Wartortle", count: 2 },
    { name: "Squirtle", count: 4 },
    { name: "Staryu", count: 3 },
    { name: "Onix", count: 3 },
    { name: "Sandshrew", count: 3 },
    { name: "Machoke", count: 2 },
    { name: "Machop", count: 4 },
    { name: "Super Energy Removal", count: 1 },
    { name: "PlusPower", count: 1 },
    { name: "Professor Oak", count: 1 },
    { name: "Gust of Wind", count: 1 },
    { name: "Energy Removal", count: 4 },
    { name: "Fighting Energy", count: 16 },
    { name: "Water Energy", count: 12 }
  ],
  zap: [
    { name: "Mewtwo", count: 1 },
    { name: "Kadabra", count: 1 },
    { name: "Jynx", count: 2 },
    { name: "Haunter", count: 2 },
    { name: "Gastly", count: 3 },
    { name: "Drowzee", count: 2 },
    { name: "Abra", count: 3 },
    { name: "Pikachu", count: 4 },
    { name: "Magnemite", count: 3 },
    { name: "Computer Search", count: 1 },
    { name: "Defender", count: 1 },
    { name: "Super Potion", count: 1 },
    { name: "Professor Oak", count: 1 },
    { name: "Switch", count: 2 },
    { name: "Potion", count: 1 },
    { name: "Gust of Wind", count: 2 },
    { name: "Bill", count: 2 },
    { name: "Lightning Energy", count: 12 },
    { name: "Psychic Energy", count: 16 }
  ],
  brushfire: [
    { name: "Ninetales", count: 1 },
    { name: "Weedle", count: 4 },
    { name: "Tangela", count: 2 },
    { name: "Nidoran ♂", count: 4 },
    { name: "Arcanine", count: 1 },
    { name: "Growlithe", count: 2 },
    { name: "Charmeleon", count: 2 },
    { name: "Vulpix", count: 2 },
    { name: "Charmander", count: 4 },
    { name: "Lass", count: 1 },
    { name: "PlusPower", count: 1 },
    { name: "Energy Retrieval", count: 2 },
    { name: "Switch", count: 1 },
    { name: "Potion", count: 3 },
    { name: "Gust of Wind", count: 1 },
    { name: "Energy Removal", count: 1 },
    { name: "Grass Energy", count: 10 },
    { name: "Fire Energy", count: 18 }
  ]
};

module.exports = { STARTER_DECKLISTS: STARTER_DECKLISTS };

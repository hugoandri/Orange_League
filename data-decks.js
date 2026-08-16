// Exact 60-card decklists for the Base Set preconstructed theme decks
// "Overgrowth" (player) and "Blackout" (CPU), sourced from Bulbapedia:
//   https://bulbapedia.bulbagarden.net/wiki/Overgrowth_(TCG)
//   https://bulbapedia.bulbagarden.net/wiki/Blackout_(TCG)
// (fetched via action=raw wikitext, current stable revisions as of 2026-08-16)
//
// Overgrowth: 23 Pokemon + 9 Trainer + 28 Energy = 60
// Blackout:   24 Pokemon + 8 Trainer + 28 Energy = 60
//   NOTE: the design spec's carried-over composition note said Blackout was
//   "27 Pokemon / 5 Trainer / 28 Energy". The freshly fetched Bulbapedia
//   decklist (cross-checked against both the raw wikitext and the rendered
//   page's row-by-row listing, which agree on every card name and quantity)
//   sums to 24 Pokemon / 8 Trainer / 28 Energy = 60. The "27/5" figure
//   appears to have been an arithmetic error in the earlier note, not a
//   different decklist -- the correct total (60) and the correct set of
//   card names/quantities below are what actually ships.

const DECKLISTS = {
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
  ]
};

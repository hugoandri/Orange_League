// Exact 60-card decklists for real Base Set preconstructed theme decks,
// sourced from Bulbapedia:
//   https://bulbapedia.bulbagarden.net/wiki/Overgrowth_(TCG)
//   https://bulbapedia.bulbagarden.net/wiki/Blackout_(TCG)
//   https://bulbapedia.bulbagarden.net/wiki/Zap!_(TCG)
//   https://bulbapedia.bulbagarden.net/wiki/Brushfire_(TCG)
// (Overgrowth/Blackout fetched via action=raw wikitext, 2026-08-16; Zap!
// and Brushfire fetched 2026-08-25 -- all four real Base Set theme decks
// are now in)
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
// Zap!:       21 Pokemon + 11 Trainer + 28 Energy = 60
//   NOTE: an earlier informal collector's-reference note claimed "23
//   Trainer / 16 Energy" for this deck (would sum to 72, not 60 -- an
//   impossible real decklist). The itemized row-by-row Bulbapedia listing
//   (fetched twice, independently, both times agreeing on every card name
//   and quantity) sums correctly to 60 and is what's used below.
// Brushfire:  22 Pokemon + 10 Trainer + 28 Energy = 60

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

// The 4 real precon decks, fixed -- unlike Object.keys(DECKLISTS), this
// does NOT grow once a player's custom decks (Fase 4, 'custom-1'..
// 'custom-4') get registered into that same object at runtime (see
// registerCustomDecks, ui.js). createGame's CPU-deck-pool selection
// (rules-engine.js) needs exactly this fixed list -- the CPU must never be
// handed one of the PLAYER's own personally-built custom decks.
const PRECON_DECK_KEYS = ['overgrowth', 'blackout', 'zap', 'brushfire'];

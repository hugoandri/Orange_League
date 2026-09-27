// data-trainers.js
// Definitions for the 10 retro Yu-Gi-Oh! Forbidden Memories-style Pokémon Trainers.
// Used by admin.html (Deck Builder / Assigner) and index.html (PVP / Desafiar Entrenador).

const DEFAULT_TRAINERS = [
  {
    id: "trainer_01",
    num: "01",
    name: "Rojo",
    title: "Campeón Legendario",
    type: "FUEGO",
    typeColor: "#ff4444",
    photo: "Perfil/Trainer_01_Red.jpg",
    desc: "Inspirado en el mítico Entrenador Rojo del Monte Plateado. Mirada penetrante de batalla, gorra clásica hacia atrás y aura ardiente.",
    deckPreset: "brushfire",
    deckName: "Mazo Llamarada (Brushfire)",
    cards: [
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
  },
  {
    id: "trainer_02",
    num: "02",
    name: "Azul",
    title: "El Rival Táctico",
    type: "AGUA / LUCHA",
    typeColor: "#00e5ff",
    photo: "Perfil/Trainer_02_Rival.jpg",
    desc: "Arquetipo de rival prodigio estilo Seto Kaiba / Azul. Gabardina oscura de cuello alto, sonrisa confiada y relámpagos estallando de fondo.",
    deckPreset: "blackout",
    deckName: "Mazo Apagón (Blackout)",
    cards: [
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
  },
  {
    id: "trainer_03",
    num: "03",
    name: "Spark",
    title: "El As del Trueno",
    type: "ELÉCTRICO",
    typeColor: "#ffd23f",
    photo: "Perfil/Trainer_03_Electric.jpg",
    desc: "Dinamismo y energía pura: cabello rubio con mechas eléctricas, gafas de combate y una tormenta de plasma amarillo a su alrededor.",
    deckPreset: "zap",
    deckName: "Mazo Trueno (Zap!)",
    cards: [
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
    ]
  },
  {
    id: "trainer_04",
    num: "04",
    name: "Lance",
    title: "Maestro Dragón",
    type: "DRAGÓN",
    typeColor: "#ff3366",
    photo: "Perfil/Trainer_04_Dragon.jpg",
    desc: "Solemne y regio como Lance: capa de batalla con hombreras esculpidas en cabezas de dragón rojo, ojos dorados y fuego draconiano.",
    deckPreset: "custom",
    deckName: "Mazo Furia Dragón",
    cards: [
      { name: "Dragonair", count: 2 },
      { name: "Dratini", count: 4 },
      { name: "Charizard", count: 1 },
      { name: "Charmeleon", count: 2 },
      { name: "Charmander", count: 3 },
      { name: "Gyarados", count: 1 },
      { name: "Magikarp", count: 2 },
      { name: "Professor Oak", count: 2 },
      { name: "Bill", count: 3 },
      { name: "Computer Search", count: 1 },
      { name: "Gust of Wind", count: 2 },
      { name: "Switch", count: 2 },
      { name: "Energy Removal", count: 2 },
      { name: "Super Potion", count: 2 },
      { name: "Double Colorless Energy", count: 4 },
      { name: "Fire Energy", count: 17 },
      { name: "Water Energy", count: 10 }
    ]
  },
  {
    id: "trainer_05",
    num: "05",
    name: "Sabrina",
    title: "La Reina Psíquica",
    type: "PSÍQUICO",
    typeColor: "#c084fc",
    photo: "Perfil/Trainer_05_Psychic.jpg",
    desc: "Elegancia y misterio absoluto: cabello largo violeta oscuro, ojos amatista telequinéticos y orbes de energía mental en un vórtice cósmico.",
    deckPreset: "custom",
    deckName: "Mazo Telequinesis",
    cards: [
      { name: "Alakazam", count: 1 },
      { name: "Kadabra", count: 2 },
      { name: "Abra", count: 4 },
      { name: "Mr. Mime", count: 2 },
      { name: "Mewtwo", count: 2 },
      { name: "Jynx", count: 2 },
      { name: "Drowzee", count: 3 },
      { name: "Professor Oak", count: 2 },
      { name: "Bill", count: 4 },
      { name: "Switch", count: 2 },
      { name: "Gust of Wind", count: 2 },
      { name: "Energy Removal", count: 3 },
      { name: "Super Potion", count: 2 },
      { name: "Defender", count: 1 },
      { name: "Psychic Energy", count: 28 }
    ]
  },
  {
    id: "trainer_06",
    num: "06",
    name: "Misty",
    title: "La Prodigio Acuática",
    type: "AGUA",
    typeColor: "#00bcd4",
    photo: "Perfil/Trainer_06_Water.jpg",
    desc: "Atlética y vivaz: cabello celeste en coleta alta, mirada zafiro decidida y un remolino de olas y gotas marinas resplandecientes.",
    deckPreset: "custom",
    deckName: "Mazo Maremoto",
    cards: [
      { name: "Blastoise", count: 1 },
      { name: "Wartortle", count: 2 },
      { name: "Squirtle", count: 4 },
      { name: "Starmie", count: 3 },
      { name: "Staryu", count: 4 },
      { name: "Gyarados", count: 1 },
      { name: "Magikarp", count: 2 },
      { name: "Seel", count: 2 },
      { name: "Professor Oak", count: 2 },
      { name: "Bill", count: 3 },
      { name: "Switch", count: 2 },
      { name: "Gust of Wind", count: 2 },
      { name: "Energy Removal", count: 2 },
      { name: "Potion", count: 2 },
      { name: "Super Potion", count: 1 },
      { name: "Water Energy", count: 27 }
    ]
  },
  {
    id: "trainer_07",
    num: "07",
    name: "Morty",
    title: "El Ocultista Fantasma",
    type: "FANTASMA",
    typeColor: "#9c27b0",
    photo: "Perfil/Trainer_07_Ghost.jpg",
    desc: "Místico y enigmático: pelo cenizo alborotado, bufanda oscura, sonrisa espectral y fuego fatuo flotando entre espíritus astrales.",
    deckPreset: "custom",
    deckName: "Mazo Sombras Astrales",
    cards: [
      { name: "Haunter", count: 3 },
      { name: "Gastly", count: 4 },
      { name: "Mewtwo", count: 2 },
      { name: "Drowzee", count: 3 },
      { name: "Kadabra", count: 2 },
      { name: "Abra", count: 3 },
      { name: "Professor Oak", count: 2 },
      { name: "Bill", count: 4 },
      { name: "Computer Search", count: 2 },
      { name: "Switch", count: 2 },
      { name: "Gust of Wind", count: 2 },
      { name: "Energy Removal", count: 3 },
      { name: "Psychic Energy", count: 28 }
    ]
  },
  {
    id: "trainer_08",
    num: "08",
    name: "Ranger",
    title: "El Guardabosques",
    type: "PLANTA",
    typeColor: "#4caf50",
    photo: "Perfil/Trainer_08_Forest.jpg",
    desc: "Conexión con la naturaleza: bandana con hoja dorada, chaqueta de explorador con medallas botánicas y vendaval de hojas de otoño.",
    deckPreset: "custom",
    deckName: "Mazo Bosque Milenario",
    cards: [
      { name: "Venusaur", count: 1 },
      { name: "Ivysaur", count: 2 },
      { name: "Bulbasaur", count: 4 },
      { name: "Scyther", count: 3 },
      { name: "Pinsir", count: 2 },
      { name: "Tangela", count: 2 },
      { name: "Weedle", count: 3 },
      { name: "Kakuna", count: 2 },
      { name: "Beedrill", count: 1 },
      { name: "Professor Oak", count: 2 },
      { name: "Bill", count: 3 },
      { name: "Switch", count: 2 },
      { name: "Gust of Wind", count: 2 },
      { name: "Potion", count: 2 },
      { name: "Grass Energy", count: 29 }
    ]
  },
  {
    id: "trainer_09",
    num: "09",
    name: "Steven",
    title: "El Estratega de Acero",
    type: "ACERO / ROCA",
    typeColor: "#90caf9",
    photo: "Perfil/Trainer_09_Steel.jpg",
    desc: "Sofisticación y poder: cabello plateado, elegante traje de etiqueta con broche de rubí y fragmentos de metal pulido flotando alrededor.",
    deckPreset: "custom",
    deckName: "Mazo Fortaleza Blindada",
    cards: [
      { name: "Magneton", count: 2 },
      { name: "Magnemite", count: 4 },
      { name: "Onix", count: 3 },
      { name: "Rhydon", count: 2 },
      { name: "Rhyhorn", count: 3 },
      { name: "Porygon", count: 2 },
      { name: "Chansey", count: 1 },
      { name: "Professor Oak", count: 2 },
      { name: "Bill", count: 3 },
      { name: "Computer Search", count: 1 },
      { name: "Switch", count: 2 },
      { name: "Defender", count: 3 },
      { name: "Gust of Wind", count: 2 },
      { name: "Double Colorless Energy", count: 4 },
      { name: "Lightning Energy", count: 14 },
      { name: "Fighting Energy", count: 12 }
    ]
  },
  {
    id: "trainer_10",
    num: "10",
    name: "Bruno",
    title: "El Maestro Marcial",
    type: "LUCHA",
    typeColor: "#ff5722",
    photo: "Perfil/Trainer_10_Fighting.jpg",
    desc: "Fuerza implacable: cinta roja, vendas de combate en hombros y pecho, y un aura ardiente de espíritu de lucha rugiendo al fondo.",
    deckPreset: "custom",
    deckName: "Mazo Puño Demoledor",
    cards: [
      { name: "Machamp", count: 1 },
      { name: "Machoke", count: 2 },
      { name: "Machop", count: 4 },
      { name: "Hitmonchan", count: 3 },
      { name: "Primeape", count: 2 },
      { name: "Mankey", count: 3 },
      { name: "Diglett", count: 3 },
      { name: "Dugtrio", count: 1 },
      { name: "Professor Oak", count: 2 },
      { name: "Bill", count: 3 },
      { name: "PlusPower", count: 3 },
      { name: "Gust of Wind", count: 2 },
      { name: "Energy Removal", count: 3 },
      { name: "Switch", count: 2 },
      { name: "Fighting Energy", count: 26 }
    ]
  }
];

const TRAINER_PRESET_OPTIONS = [
  { key: 'brushfire', name: 'Mazo Llamarada (Brushfire)' },
  { key: 'blackout', name: 'Mazo Apagón (Blackout)' },
  { key: 'zap', name: 'Mazo Trueno (Zap!)' },
  { key: 'overgrowth', name: 'Mazo Maremoto (Overgrowth)' },
  { key: 'custom', name: 'Mazo Personalizado (Editor)' }
];

function cloneTrainerDeck(cards) {
  if (!Array.isArray(cards)) { return []; }
  return cards.map(function (c) { return { name: c.name, count: c.count }; });
}

function cloneTrainers(trainers) {
  return (trainers || DEFAULT_TRAINERS).map(function (t) {
    return {
      id: t.id,
      num: t.num,
      name: t.name,
      title: t.title,
      type: t.type,
      typeColor: t.typeColor,
      photo: t.photo,
      desc: t.desc,
      deckPreset: t.deckPreset || 'custom',
      deckName: t.deckName || 'Mazo de ' + t.name,
      cards: cloneTrainerDeck(t.cards)
    };
  });
}

function getTrainerDeckList(trainer) {
  if (!trainer) {
    return (typeof DECKLISTS !== 'undefined' && DECKLISTS.overgrowth) || [];
  }
  if (trainer.deckPreset !== 'custom' && typeof DECKLISTS !== 'undefined' && DECKLISTS[trainer.deckPreset]) {
    return DECKLISTS[trainer.deckPreset];
  }
  if (Array.isArray(trainer.cards) && trainer.cards.length > 0) {
    return trainer.cards;
  }
  var fallbackKey = trainer.deckPreset || 'overgrowth';
  return (typeof DECKLISTS !== 'undefined' && DECKLISTS[fallbackKey]) || [];
}

function getTrainerDeckCardCount(cards) {
  if (!Array.isArray(cards)) { return 0; }
  var total = 0;
  cards.forEach(function (c) { total += (c.count || 0); });
  return total;
}

function getTrainerDeckComposition(cards) {
  var total = 0;
  var pokemon = 0;
  var trainerCount = 0;
  var energy = 0;
  var hasBasic = false;

  (cards || []).forEach(function (c) {
    var count = c.count || 0;
    total += count;
    var stats = (typeof CARD_STATS !== 'undefined' && CARD_STATS[c.name]) || null;
    if (stats) {
      if (stats.supertype === 'Pokémon') {
        pokemon += count;
        if (!stats.evolvesFrom) { hasBasic = true; }
      } else if (stats.supertype === 'Trainer') {
        trainerCount += count;
      } else if (stats.supertype === 'Energy') {
        energy += count;
      }
    }
  });

  return {
    total: total,
    pokemon: pokemon,
    trainer: trainerCount,
    energy: energy,
    hasBasic: hasBasic
  };
}

function loadTrainersConfigSync() {
  try {
    var raw = localStorage.getItem('tcg_trainers_config');
    if (raw) {
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length === 10) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Error reading tcg_trainers_config from localStorage:', e);
  }
  return cloneTrainers(DEFAULT_TRAINERS);
}

function saveTrainersConfigSync(trainers) {
  try {
    localStorage.setItem('tcg_trainers_config', JSON.stringify(trainers));
    return true;
  } catch (e) {
    console.error('Error saving tcg_trainers_config to localStorage:', e);
    return false;
  }
}

if (typeof module !== 'undefined') {
  module.exports = {
    DEFAULT_TRAINERS,
    TRAINER_PRESET_OPTIONS,
    cloneTrainerDeck,
    cloneTrainers,
    getTrainerDeckList,
    getTrainerDeckCardCount,
    getTrainerDeckComposition,
    loadTrainersConfigSync,
    saveTrainersConfigSync
  };
}

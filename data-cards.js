// Full game-stat data for the ~29 unique cards used across the Overgrowth
// and Blackout Base Set theme decks (data-decks.js), sourced from the
// pokemontcg.io API (set.id:base1 -- Base Set), fetched 2026-08-16.
// Pokemon fields: hp, types, evolvesFrom, attacks[] (name/cost/
// convertedEnergyCost/damage/text), weaknesses, resistances, retreatCost
// (converted energy count -- Beedrill legitimately has 0, matching its
// real Base Set print).
// Trainer fields: text is the verbatim printed effect text from the API
// rules field (joined if multiple lines).
// Energy cards only need supertype.
const CARD_STATS = {
  "Beedrill": {
    "supertype": "Pokémon",
    "hp": 80,
    "types": [
      "Grass"
    ],
    "evolvesFrom": "Kakuna",
    "attacks": [
      {
        "name": "Twineedle",
        "cost": [
          "Colorless",
          "Colorless",
          "Colorless"
        ],
        "convertedEnergyCost": 3,
        "damage": "30×",
        "text": "Flip 2 coins. This attack does 30 damage times the number of heads."
      },
      {
        "name": "Poison Sting",
        "cost": [
          "Grass",
          "Grass",
          "Grass"
        ],
        "convertedEnergyCost": 3,
        "damage": "40",
        "text": "Flip a coin. If heads, the Defending Pokémon is now Poisoned."
      }
    ],
    "weaknesses": [
      {
        "type": "Fire",
        "value": "×2"
      }
    ],
    "resistances": [
      {
        "type": "Fighting",
        "value": "-30"
      }
    ],
    "retreatCost": 0
  },
  "Bill": {
    "supertype": "Trainer",
    "text": "Draw 2 cards."
  },
  "Bulbasaur": {
    "supertype": "Pokémon",
    "hp": 40,
    "types": [
      "Grass"
    ],
    "evolvesFrom": null,
    "attacks": [
      {
        "name": "Leech Seed",
        "cost": [
          "Grass",
          "Grass"
        ],
        "convertedEnergyCost": 2,
        "damage": "20",
        "text": "Unless all damage from this attack is prevented, you may remove 1 damage counter from Bulbasaur."
      }
    ],
    "weaknesses": [
      {
        "type": "Fire",
        "value": "×2"
      }
    ],
    "resistances": [],
    "retreatCost": 1
  },
  "Energy Removal": {
    "supertype": "Trainer",
    "text": "Choose 1 Energy card attached to 1 of your opponent's Pokémon and discard it."
  },
  "Farfetch'd": {
    "supertype": "Pokémon",
    "hp": 50,
    "types": [
      "Colorless"
    ],
    "evolvesFrom": null,
    "attacks": [
      {
        "name": "Leek Slap",
        "cost": [
          "Colorless"
        ],
        "convertedEnergyCost": 1,
        "damage": "30",
        "text": "Flip a coin. If tails, this attack does nothing. Either way, you can't use this attack again as long as Farfetch'd stays in play (even putting Farfetch'd on the Bench won't let you use it again)."
      },
      {
        "name": "Pot Smash",
        "cost": [
          "Colorless",
          "Colorless",
          "Colorless"
        ],
        "convertedEnergyCost": 3,
        "damage": "30",
        "text": ""
      }
    ],
    "weaknesses": [
      {
        "type": "Lightning",
        "value": "×2"
      }
    ],
    "resistances": [
      {
        "type": "Fighting",
        "value": "-30"
      }
    ],
    "retreatCost": 1
  },
  "Double Colorless Energy": {
    "supertype": "Energy"
  },
  "Fighting Energy": {
    "supertype": "Energy"
  },
  "Fire Energy": {
    "supertype": "Energy"
  },
  "Grass Energy": {
    "supertype": "Energy"
  },
  "Gust of Wind": {
    "supertype": "Trainer",
    "text": "Choose 1 of your opponent's Benched Pokémon and switch it with his or her Active Pokémon."
  },
  "Gyarados": {
    "supertype": "Pokémon",
    "hp": 100,
    "types": [
      "Water"
    ],
    "evolvesFrom": "Magikarp",
    "attacks": [
      {
        "name": "Dragon Rage",
        "cost": [
          "Water",
          "Water",
          "Water"
        ],
        "convertedEnergyCost": 3,
        "damage": "50",
        "text": ""
      },
      {
        "name": "Bubblebeam",
        "cost": [
          "Water",
          "Water",
          "Water",
          "Water"
        ],
        "convertedEnergyCost": 4,
        "damage": "40",
        "text": "Flip a coin. If heads, the Defending Pokémon is now Paralyzed."
      }
    ],
    "weaknesses": [
      {
        "type": "Grass",
        "value": "×2"
      }
    ],
    "resistances": [
      {
        "type": "Fighting",
        "value": "-30"
      }
    ],
    "retreatCost": 3
  },
  "Hitmonchan": {
    "supertype": "Pokémon",
    "hp": 70,
    "types": [
      "Fighting"
    ],
    "evolvesFrom": null,
    "attacks": [
      {
        "name": "Jab",
        "cost": [
          "Fighting"
        ],
        "convertedEnergyCost": 1,
        "damage": "20",
        "text": ""
      },
      {
        "name": "Special Punch",
        "cost": [
          "Fighting",
          "Fighting",
          "Colorless"
        ],
        "convertedEnergyCost": 3,
        "damage": "40",
        "text": ""
      }
    ],
    "weaknesses": [
      {
        "type": "Psychic",
        "value": "×2"
      }
    ],
    "resistances": [],
    "retreatCost": 2
  },
  "Ivysaur": {
    "supertype": "Pokémon",
    "hp": 60,
    "types": [
      "Grass"
    ],
    "evolvesFrom": "Bulbasaur",
    "attacks": [
      {
        "name": "Vine Whip",
        "cost": [
          "Grass",
          "Colorless",
          "Colorless"
        ],
        "convertedEnergyCost": 3,
        "damage": "30",
        "text": ""
      },
      {
        "name": "Poisonpowder",
        "cost": [
          "Grass",
          "Grass",
          "Grass"
        ],
        "convertedEnergyCost": 3,
        "damage": "20",
        "text": "The Defending Pokémon is now Poisoned."
      }
    ],
    "weaknesses": [
      {
        "type": "Fire",
        "value": "×2"
      }
    ],
    "resistances": [],
    "retreatCost": 1
  },
  "Kakuna": {
    "supertype": "Pokémon",
    "hp": 80,
    "types": [
      "Grass"
    ],
    "evolvesFrom": "Weedle",
    "attacks": [
      {
        "name": "Stiffen",
        "cost": [
          "Colorless",
          "Colorless"
        ],
        "convertedEnergyCost": 2,
        "damage": "",
        "text": "Flip a coin. If heads, prevent all damage done to Kakuna during your opponent's next turn. (Any other effects of attacks still happen.)"
      },
      {
        "name": "Poisonpowder",
        "cost": [
          "Grass",
          "Grass"
        ],
        "convertedEnergyCost": 2,
        "damage": "20",
        "text": "Flip a coin. If heads, the Defending Pokémon is now Poisoned."
      }
    ],
    "weaknesses": [
      {
        "type": "Fire",
        "value": "×2"
      }
    ],
    "resistances": [],
    "retreatCost": 2
  },
  "Machoke": {
    "supertype": "Pokémon",
    "hp": 80,
    "types": [
      "Fighting"
    ],
    "evolvesFrom": "Machop",
    "attacks": [
      {
        "name": "Karate Chop",
        "cost": [
          "Fighting",
          "Fighting",
          "Colorless"
        ],
        "convertedEnergyCost": 3,
        "damage": "50-",
        "text": "Does 50 damage minus 10 damage for each damage counter on Machoke."
      },
      {
        "name": "Submission",
        "cost": [
          "Fighting",
          "Fighting",
          "Colorless",
          "Colorless"
        ],
        "convertedEnergyCost": 4,
        "damage": "60",
        "text": "Machoke does 20 damage to itself."
      }
    ],
    "weaknesses": [
      {
        "type": "Psychic",
        "value": "×2"
      }
    ],
    "resistances": [],
    "retreatCost": 3
  },
  "Machop": {
    "supertype": "Pokémon",
    "hp": 50,
    "types": [
      "Fighting"
    ],
    "evolvesFrom": null,
    "attacks": [
      {
        "name": "Low Kick",
        "cost": [
          "Fighting"
        ],
        "convertedEnergyCost": 1,
        "damage": "20",
        "text": ""
      }
    ],
    "weaknesses": [
      {
        "type": "Psychic",
        "value": "×2"
      }
    ],
    "resistances": [],
    "retreatCost": 1
  },
  "Magikarp": {
    "supertype": "Pokémon",
    "hp": 30,
    "types": [
      "Water"
    ],
    "evolvesFrom": null,
    "attacks": [
      {
        "name": "Tackle",
        "cost": [
          "Colorless"
        ],
        "convertedEnergyCost": 1,
        "damage": "10",
        "text": ""
      },
      {
        "name": "Flail",
        "cost": [
          "Water"
        ],
        "convertedEnergyCost": 1,
        "damage": "10×",
        "text": "Does 10 damage times the number of damage counters on Magikarp."
      }
    ],
    "weaknesses": [
      {
        "type": "Lightning",
        "value": "×2"
      }
    ],
    "resistances": [],
    "retreatCost": 1
  },
  "Onix": {
    "supertype": "Pokémon",
    "hp": 90,
    "types": [
      "Fighting"
    ],
    "evolvesFrom": null,
    "attacks": [
      {
        "name": "Rock Throw",
        "cost": [
          "Fighting"
        ],
        "convertedEnergyCost": 1,
        "damage": "10",
        "text": ""
      },
      {
        "name": "Harden",
        "cost": [
          "Fighting",
          "Fighting"
        ],
        "convertedEnergyCost": 2,
        "damage": "",
        "text": "During your opponent's next turn, whenever 30 or less damage is done to Onix (after applying Weakness and Resistance), prevent that damage. (Any other effects of attacks still happen.)"
      }
    ],
    "weaknesses": [
      {
        "type": "Grass",
        "value": "×2"
      }
    ],
    "resistances": [],
    "retreatCost": 3
  },
  "PlusPower": {
    "supertype": "Trainer",
    "text": "Attach PlusPower to your Active Pokémon. At the end of your turn, discard PlusPower. If this Pokémon's attack does damage to the Defending Pokémon (after applying Weakness and Resistance), the attack does 10 more damage to the Defending Pokémon."
  },
  "Potion": {
    "supertype": "Trainer",
    "text": "Remove up to 2 damage counters from 1 of your Pokémon."
  },
  "Professor Oak": {
    "supertype": "Trainer",
    "text": "Discard your hand, then draw 7 cards."
  },
  "Sandshrew": {
    "supertype": "Pokémon",
    "hp": 40,
    "types": [
      "Fighting"
    ],
    "evolvesFrom": null,
    "attacks": [
      {
        "name": "Sand-attack",
        "cost": [
          "Fighting"
        ],
        "convertedEnergyCost": 1,
        "damage": "10",
        "text": "If the Defending Pokémon tries to attack during your opponent's next turn, your opponent flips a coin. If tails, that attack does nothing."
      }
    ],
    "weaknesses": [
      {
        "type": "Grass",
        "value": "×2"
      }
    ],
    "resistances": [
      {
        "type": "Lightning",
        "value": "-30"
      }
    ],
    "retreatCost": 1
  },
  "Squirtle": {
    "supertype": "Pokémon",
    "hp": 40,
    "types": [
      "Water"
    ],
    "evolvesFrom": null,
    "attacks": [
      {
        "name": "Bubble",
        "cost": [
          "Water"
        ],
        "convertedEnergyCost": 1,
        "damage": "10",
        "text": "Flip a coin. If heads, the Defending Pokémon is now Paralyzed."
      },
      {
        "name": "Withdraw",
        "cost": [
          "Water",
          "Colorless"
        ],
        "convertedEnergyCost": 2,
        "damage": "",
        "text": "Flip a coin. If heads, prevent all damage done to Squirtle during your opponent's next turn. (Any other effects of attacks still happen.)"
      }
    ],
    "weaknesses": [
      {
        "type": "Lightning",
        "value": "×2"
      }
    ],
    "resistances": [],
    "retreatCost": 1
  },
  "Starmie": {
    "supertype": "Pokémon",
    "hp": 60,
    "types": [
      "Water"
    ],
    "evolvesFrom": "Staryu",
    "attacks": [
      {
        "name": "Recover",
        "cost": [
          "Water",
          "Water"
        ],
        "convertedEnergyCost": 2,
        "damage": "",
        "text": "Discard 1 Water Energy card attached to Starmie in order to use this attack. Remove all damage counters from Starmie."
      },
      {
        "name": "Star Freeze",
        "cost": [
          "Water",
          "Colorless",
          "Colorless"
        ],
        "convertedEnergyCost": 3,
        "damage": "20",
        "text": "Flip a coin. If heads, the Defending Pokémon is now Paralyzed."
      }
    ],
    "weaknesses": [
      {
        "type": "Lightning",
        "value": "×2"
      }
    ],
    "resistances": [],
    "retreatCost": 1
  },
  "Staryu": {
    "supertype": "Pokémon",
    "hp": 40,
    "types": [
      "Water"
    ],
    "evolvesFrom": null,
    "attacks": [
      {
        "name": "Slap",
        "cost": [
          "Water"
        ],
        "convertedEnergyCost": 1,
        "damage": "20",
        "text": ""
      }
    ],
    "weaknesses": [
      {
        "type": "Lightning",
        "value": "×2"
      }
    ],
    "resistances": [],
    "retreatCost": 1
  },
  "Super Energy Removal": {
    "supertype": "Trainer",
    "text": "Discard 1 Energy card attached to 1 of your Pokémon in order to choose 1 of your opponent's Pokémon and up to 2 Energy cards attached to it. Discard those Energy cards."
  },
  "Super Potion": {
    "supertype": "Trainer",
    "text": "Discard 1 Energy card attached to your own Pokémon in order to remove up to 4 damage counters from that Pokémon."
  },
  "Switch": {
    "supertype": "Trainer",
    "text": "Switch 1 of your own Benched Pokémon with your Active Pokémon."
  },
  "Wartortle": {
    "supertype": "Pokémon",
    "hp": 70,
    "types": [
      "Water"
    ],
    "evolvesFrom": "Squirtle",
    "attacks": [
      {
        "name": "Withdraw",
        "cost": [
          "Water",
          "Colorless"
        ],
        "convertedEnergyCost": 2,
        "damage": "",
        "text": "Flip a coin. If heads, prevent all damage done to Wartortle during your opponent's next turn. (Any other effects of attacks still happen.)"
      },
      {
        "name": "Bite",
        "cost": [
          "Water",
          "Colorless",
          "Colorless"
        ],
        "convertedEnergyCost": 3,
        "damage": "40",
        "text": ""
      }
    ],
    "weaknesses": [
      {
        "type": "Lightning",
        "value": "×2"
      }
    ],
    "resistances": [],
    "retreatCost": 1
  },
  "Water Energy": {
    "supertype": "Energy"
  },
  "Weedle": {
    "supertype": "Pokémon",
    "hp": 40,
    "types": [
      "Grass"
    ],
    "evolvesFrom": null,
    "attacks": [
      {
        "name": "Poison Sting",
        "cost": [
          "Grass"
        ],
        "convertedEnergyCost": 1,
        "damage": "10",
        "text": "Flip a coin. If heads, the Defending Pokémon is now Poisoned."
      }
    ],
    "weaknesses": [
      {
        "type": "Fire",
        "value": "×2"
      }
    ],
    "resistances": [],
    "retreatCost": 1
  },
  "Mewtwo": {
    "supertype": "Pokémon",
    "hp": 60,
    "types": ["Psychic"],
    "evolvesFrom": null,
    "attacks": [
      {
        "name": "Psychic",
        "cost": ["Psychic", "Colorless"],
        "convertedEnergyCost": 2,
        "damage": "10+",
        "text": "Does 10 damage plus 10 more damage for each Energy card attached to the Defending Pokémon."
      },
      {
        "name": "Barrier",
        "cost": ["Psychic", "Psychic"],
        "convertedEnergyCost": 2,
        "damage": "0",
        "text": "Discard 1 Psychic Energy card attached to Mewtwo in order to use this attack. During your opponent's next turn, prevent all effects of attacks, including damage, done to Mewtwo."
      }
    ],
    "weaknesses": [{ "type": "Psychic", "value": "×2" }],
    "resistances": [],
    "retreatCost": 3
  },
  "Kadabra": {
    "supertype": "Pokémon",
    "hp": 60,
    "types": ["Psychic"],
    "evolvesFrom": "Abra",
    "attacks": [
      {
        "name": "Recover",
        "cost": ["Psychic", "Psychic"],
        "convertedEnergyCost": 2,
        "damage": "0",
        "text": "Discard 1 Psychic Energy card attached to Kadabra in order to use this attack. Remove all damage counters from Kadabra."
      },
      {
        "name": "Super Psy",
        "cost": ["Psychic", "Psychic", "Colorless"],
        "convertedEnergyCost": 3,
        "damage": "50",
        "text": ""
      }
    ],
    "weaknesses": [{ "type": "Psychic", "value": "×2" }],
    "resistances": [],
    "retreatCost": 3
  },
  "Jynx": {
    "supertype": "Pokémon",
    "hp": 70,
    "types": ["Psychic"],
    "evolvesFrom": null,
    "attacks": [
      {
        "name": "Doubleslap",
        "cost": ["Psychic"],
        "convertedEnergyCost": 1,
        "damage": "10×",
        "text": "Flip 2 coins. This attack does 10 damage times the number of heads."
      },
      {
        "name": "Meditate",
        "cost": ["Psychic", "Psychic", "Colorless"],
        "convertedEnergyCost": 3,
        "damage": "20+",
        "text": "Does 20 damage plus 10 more damage for each damage counter on the Defending Pokémon."
      }
    ],
    "weaknesses": [{ "type": "Psychic", "value": "×2" }],
    "resistances": [],
    "retreatCost": 2
  },
  "Haunter": {
    "supertype": "Pokémon",
    "hp": 60,
    "types": ["Psychic"],
    "evolvesFrom": "Gastly",
    "attacks": [
      {
        "name": "Hypnosis",
        "cost": ["Psychic"],
        "convertedEnergyCost": 1,
        "damage": "0",
        "text": "The Defending Pokémon is now Asleep."
      },
      {
        "name": "Dream Eater",
        "cost": ["Psychic", "Psychic"],
        "convertedEnergyCost": 2,
        "damage": "50",
        "text": "You can't use this attack unless the Defending Pokémon is Asleep."
      }
    ],
    "weaknesses": [],
    "resistances": [{ "type": "Fighting", "value": "-30" }],
    "retreatCost": 1
  },
  "Gastly": {
    "supertype": "Pokémon",
    "hp": 30,
    "types": ["Psychic"],
    "evolvesFrom": null,
    "attacks": [
      {
        "name": "Sleeping Gas",
        "cost": ["Psychic"],
        "convertedEnergyCost": 1,
        "damage": "0",
        "text": "Flip a coin. If heads, the Defending Pokémon is now Asleep."
      },
      {
        "name": "Destiny Bond",
        "cost": ["Psychic", "Colorless"],
        "convertedEnergyCost": 2,
        "damage": "0",
        "text": "Discard 1 Psychic Energy card attached to Gastly in order to use this attack. If a Pokémon Knocks Out Gastly during your opponent's next turn, Knock Out that Pokémon."
      }
    ],
    "weaknesses": [],
    "resistances": [{ "type": "Fighting", "value": "-30" }],
    "retreatCost": 0
  },
  "Drowzee": {
    "supertype": "Pokémon",
    "hp": 50,
    "types": ["Psychic"],
    "evolvesFrom": null,
    "attacks": [
      {
        "name": "Pound",
        "cost": ["Colorless"],
        "convertedEnergyCost": 1,
        "damage": "10",
        "text": ""
      },
      {
        "name": "Confuse Ray",
        "cost": ["Psychic", "Psychic"],
        "convertedEnergyCost": 2,
        "damage": "10",
        "text": "Flip a coin. If heads, the Defending Pokémon is now Confused."
      }
    ],
    "weaknesses": [{ "type": "Psychic", "value": "×2" }],
    "resistances": [],
    "retreatCost": 1
  },
  "Abra": {
    "supertype": "Pokémon",
    "hp": 30,
    "types": ["Psychic"],
    "evolvesFrom": null,
    "attacks": [
      {
        "name": "Psyshock",
        "cost": ["Psychic"],
        "convertedEnergyCost": 1,
        "damage": "10",
        "text": "Flip a coin. If heads, the Defending Pokémon is now Paralyzed."
      }
    ],
    "weaknesses": [{ "type": "Psychic", "value": "×2" }],
    "resistances": [],
    "retreatCost": 0
  },
  "Pikachu": {
    "supertype": "Pokémon",
    "hp": 40,
    "types": ["Lightning"],
    "evolvesFrom": null,
    "attacks": [
      {
        "name": "Gnaw",
        "cost": ["Colorless"],
        "convertedEnergyCost": 1,
        "damage": "10",
        "text": ""
      },
      {
        "name": "Thunder Jolt",
        "cost": ["Lightning", "Colorless"],
        "convertedEnergyCost": 2,
        "damage": "30",
        "text": "Flip a coin. If tails, Pikachu does 10 damage to itself."
      }
    ],
    "weaknesses": [{ "type": "Fighting", "value": "×2" }],
    "resistances": [],
    "retreatCost": 1
  },
  "Magnemite": {
    "supertype": "Pokémon",
    "hp": 40,
    "types": ["Lightning"],
    "evolvesFrom": null,
    "attacks": [
      {
        "name": "Thunder Wave",
        "cost": ["Lightning"],
        "convertedEnergyCost": 1,
        "damage": "10",
        "text": "Flip a coin. If heads, the Defending Pokémon is now Paralyzed."
      },
      {
        "name": "Selfdestruct",
        "cost": ["Lightning", "Colorless"],
        "convertedEnergyCost": 2,
        "damage": "40",
        "text": "Does 10 damage to each Pokémon on each player's Bench. (Don't apply Weakness and Resistance for Benched Pokémon.) Magnemite does 40 damage to itself."
      }
    ],
    "weaknesses": [{ "type": "Fighting", "value": "×2" }],
    "resistances": [],
    "retreatCost": 1
  },
  "Computer Search": {
    "supertype": "Trainer",
    "text": "Discard 2 cards from your hand. (If you can't discard 2 cards, you can't play this card.) Search your deck for a card and put it into your hand. Shuffle your deck afterward."
  },
  "Defender": {
    "supertype": "Trainer",
    "text": "Attach Defender to 1 of your Pokémon. At the end of your opponent's next turn, discard Defender. Damage done to that Pokémon by attacks is reduced by 20 (after applying Weakness and Resistance)."
  },
  "Lightning Energy": {
    "supertype": "Energy"
  },
  "Psychic Energy": {
    "supertype": "Energy"
  },
  "Ninetales": {
    "supertype": "Pokémon",
    "hp": 80,
    "types": ["Fire"],
    "evolvesFrom": "Vulpix",
    "attacks": [
      {
        "name": "Lure",
        "cost": ["Colorless", "Colorless"],
        "convertedEnergyCost": 2,
        "damage": "0",
        "text": "If your opponent has any Benched Pokémon, choose 1 of them and switch it with the Defending Pokémon."
      },
      {
        "name": "Fire Blast",
        "cost": ["Fire", "Fire", "Fire", "Fire"],
        "convertedEnergyCost": 4,
        "damage": "80",
        "text": "Discard 1 Fire Energy card attached to Ninetales in order to use this attack."
      }
    ],
    "weaknesses": [{ "type": "Water", "value": "×2" }],
    "resistances": [],
    "retreatCost": 1
  },
  "Arcanine": {
    "supertype": "Pokémon",
    "hp": 100,
    "types": ["Fire"],
    "evolvesFrom": "Growlithe",
    "attacks": [
      {
        "name": "Flamethrower",
        "cost": ["Fire", "Fire", "Colorless"],
        "convertedEnergyCost": 3,
        "damage": "50",
        "text": "Discard 1 Fire Energy card attached to Arcanine in order to use this attack."
      },
      {
        "name": "Take Down",
        "cost": ["Fire", "Fire", "Colorless", "Colorless"],
        "convertedEnergyCost": 4,
        "damage": "80",
        "text": "Arcanine does 30 damage to itself."
      }
    ],
    "weaknesses": [{ "type": "Water", "value": "×2" }],
    "resistances": [],
    "retreatCost": 3
  },
  "Charmeleon": {
    "supertype": "Pokémon",
    "hp": 80,
    "types": ["Fire"],
    "evolvesFrom": "Charmander",
    "attacks": [
      {
        "name": "Slash",
        "cost": ["Colorless", "Colorless", "Colorless"],
        "convertedEnergyCost": 3,
        "damage": "30",
        "text": ""
      },
      {
        "name": "Flamethrower",
        "cost": ["Fire", "Fire", "Colorless"],
        "convertedEnergyCost": 3,
        "damage": "50",
        "text": "Discard 1 Fire Energy card attached to Charmeleon in order to use this attack."
      }
    ],
    "weaknesses": [{ "type": "Water", "value": "×2" }],
    "resistances": [],
    "retreatCost": 1
  },
  "Growlithe": {
    "supertype": "Pokémon",
    "hp": 60,
    "types": ["Fire"],
    "evolvesFrom": null,
    "attacks": [
      {
        "name": "Flare",
        "cost": ["Fire", "Colorless"],
        "convertedEnergyCost": 2,
        "damage": "20",
        "text": ""
      }
    ],
    "weaknesses": [{ "type": "Water", "value": "×2" }],
    "resistances": [],
    "retreatCost": 1
  },
  "Nidoran ♂": {
    "supertype": "Pokémon",
    "hp": 40,
    "types": ["Grass"],
    "evolvesFrom": null,
    "attacks": [
      {
        "name": "Horn Hazard",
        "cost": ["Grass"],
        "convertedEnergyCost": 1,
        "damage": "30",
        "text": "Flip a coin. If tails, this attack does nothing."
      }
    ],
    "weaknesses": [{ "type": "Psychic", "value": "×2" }],
    "resistances": [],
    "retreatCost": 1
  },
  "Tangela": {
    "supertype": "Pokémon",
    "hp": 50,
    "types": ["Grass"],
    "evolvesFrom": null,
    "attacks": [
      {
        "name": "Bind",
        "cost": ["Grass", "Colorless"],
        "convertedEnergyCost": 2,
        "damage": "20",
        "text": "Flip a coin. If heads, the Defending Pokémon is now Paralyzed."
      },
      {
        "name": "Poisonpowder",
        "cost": ["Grass", "Grass", "Grass"],
        "convertedEnergyCost": 3,
        "damage": "20",
        "text": "The Defending Pokémon is now Poisoned."
      }
    ],
    "weaknesses": [{ "type": "Fire", "value": "×2" }],
    "resistances": [],
    "retreatCost": 2
  },
  "Vulpix": {
    "supertype": "Pokémon",
    "hp": 50,
    "types": ["Fire"],
    "evolvesFrom": null,
    "attacks": [
      {
        "name": "Confuse Ray",
        "cost": ["Fire", "Fire"],
        "convertedEnergyCost": 2,
        "damage": "10",
        "text": "Flip a coin. If heads, the Defending Pokémon is now Confused."
      }
    ],
    "weaknesses": [{ "type": "Water", "value": "×2" }],
    "resistances": [],
    "retreatCost": 1
  },
  "Charmander": {
    "supertype": "Pokémon",
    "hp": 50,
    "types": ["Fire"],
    "evolvesFrom": null,
    "attacks": [
      {
        "name": "Scratch",
        "cost": ["Colorless"],
        "convertedEnergyCost": 1,
        "damage": "10",
        "text": ""
      },
      {
        "name": "Ember",
        "cost": ["Fire", "Colorless"],
        "convertedEnergyCost": 2,
        "damage": "30",
        "text": "Discard 1 Fire Energy card attached to Charmander in order to use this attack."
      }
    ],
    "weaknesses": [{ "type": "Water", "value": "×2" }],
    "resistances": [],
    "retreatCost": 1
  },
  "Lass": {
    "supertype": "Trainer",
    "text": "You and your opponent show each other your hands, then shuffle all the Trainer cards from your hands into your decks."
  },
  "Energy Retrieval": {
    "supertype": "Trainer",
    "text": "Trade 1 of the other cards in your hand for up to 2 basic Energy cards from your discard pile."
  },
  "Alakazam": {
    "supertype": "Pokémon", "hp": 80, "types": ["Psychic"], "evolvesFrom": "Kadabra",
    "pokemonPower": { "name": "Damage Swap", "text": "As often as you like during your turn (before your attack), you may move 1 damage counter from 1 of your Pokémon to another as long as you don't Knock Out that Pokémon. This power can't be used if Alakazam is Asleep, Confused, or Paralyzed." },
    "attacks": [
      { "name": "Confuse Ray", "cost": ["Psychic", "Psychic", "Psychic"], "convertedEnergyCost": 3, "damage": "30", "text": "Flip a coin. If heads, the Defending Pokémon is now Confused." }
    ],
    "weaknesses": [{ "type": "Psychic", "value": "×2" }], "resistances": [], "retreatCost": 3
  },
  "Blastoise": {
    "supertype": "Pokémon", "hp": 100, "types": ["Water"], "evolvesFrom": "Wartortle",
    "pokemonPower": { "name": "Rain Dance", "text": "As often as you like during your turn (before your attack), you may attach 1 Water Energy card to 1 of your Water Pokémon. (This doesn't use up your 1 Energy card attachment for the turn.) This power can't be used if Blastoise is Asleep, Confused, or Paralyzed." },
    "attacks": [
      { "name": "Hydro Pump", "cost": ["Water", "Water", "Water"], "convertedEnergyCost": 3, "damage": "40+", "text": "Does 40 damage plus 10 more damage for each Water Energy attached to Blastoise but not used to pay for this attack's Energy cost. Extra Water Energy after the 2nd doesn't count." }
    ],
    "weaknesses": [{ "type": "Lightning", "value": "×2" }], "resistances": [], "retreatCost": 3
  },
  "Chansey": {
    "supertype": "Pokémon", "hp": 120, "types": ["Colorless"], "evolvesFrom": null,
    "attacks": [
      { "name": "Scrunch", "cost": ["Colorless", "Colorless"], "convertedEnergyCost": 2, "damage": "0", "text": "Flip a coin. If heads, prevent all damage done to Chansey during your opponent's next turn." },
      { "name": "Double-edge", "cost": ["Colorless", "Colorless", "Colorless", "Colorless"], "convertedEnergyCost": 4, "damage": "80", "text": "Chansey does 80 damage to itself." }
    ],
    "weaknesses": [{ "type": "Fighting", "value": "×2" }], "resistances": [{ "type": "Psychic", "value": "-30" }], "retreatCost": 1
  },
  "Charizard": {
    "supertype": "Pokémon", "hp": 120, "types": ["Fire"], "evolvesFrom": "Charmeleon",
    "pokemonPower": { "name": "Energy Burn", "text": "As often as you like during your turn (before your attack), you may turn all Energy attached to Charizard into Fire Energy for the rest of the turn. This power can't be used if Charizard is Asleep, Confused, or Paralyzed." },
    "attacks": [
      { "name": "Fire Spin", "cost": ["Fire", "Fire", "Fire", "Fire"], "convertedEnergyCost": 4, "damage": "100", "text": "Discard 2 Energy cards attached to Charizard in order to use this attack." }
    ],
    "weaknesses": [{ "type": "Water", "value": "×2" }], "resistances": [{ "type": "Fighting", "value": "-30" }], "retreatCost": 3
  },
  "Clefairy": {
    "supertype": "Pokémon", "hp": 40, "types": ["Colorless"], "evolvesFrom": null,
    "attacks": [
      { "name": "Sing", "cost": ["Colorless"], "convertedEnergyCost": 1, "damage": "0", "text": "Flip a coin. If heads, the Defending Pokémon is now Asleep." },
      { "name": "Metronome", "cost": ["Colorless", "Colorless", "Colorless"], "convertedEnergyCost": 3, "damage": "0", "text": "Choose 1 of the Defending Pokémon's attacks. Metronome copies that attack except for its Energy costs and anything else required in order to use that attack, such as discarding Energy cards." }
    ],
    "weaknesses": [{ "type": "Fighting", "value": "×2" }], "resistances": [{ "type": "Psychic", "value": "-30" }], "retreatCost": 1
  },
  "Machamp": {
    "supertype": "Pokémon", "hp": 100, "types": ["Fighting"], "evolvesFrom": "Machoke",
    "pokemonPower": { "name": "Strikes Back", "text": "Whenever your opponent's attack damages Machamp (even if Machamp is Knocked Out), this power does 10 damage to the attacking Pokémon. (Don't apply Weakness and Resistance.) This power can't be used if Machamp is already Asleep, Confused, or Paralyzed when your opponent attacks." },
    "attacks": [
      { "name": "Seismic Toss", "cost": ["Fighting", "Fighting", "Fighting", "Colorless"], "convertedEnergyCost": 4, "damage": "60", "text": "" }
    ],
    "weaknesses": [{ "type": "Psychic", "value": "×2" }], "resistances": [], "retreatCost": 3
  },
  "Magneton": {
    "supertype": "Pokémon", "hp": 60, "types": ["Lightning"], "evolvesFrom": "Magnemite",
    "attacks": [
      { "name": "Thunder Wave", "cost": ["Lightning", "Lightning", "Colorless"], "convertedEnergyCost": 3, "damage": "30", "text": "Flip a coin. If heads, the Defending Pokémon is now Paralyzed." },
      { "name": "Selfdestruct", "cost": ["Lightning", "Lightning", "Colorless", "Colorless"], "convertedEnergyCost": 4, "damage": "80", "text": "Does 20 damage to each Pokémon on each player's Bench. (Don't apply Weakness and Resistance for Benched Pokémon.) Magneton does 80 damage to itself." }
    ],
    "weaknesses": [{ "type": "Fighting", "value": "×2" }], "resistances": [], "retreatCost": 1
  },
  "Nidoking": {
    "supertype": "Pokémon", "hp": 90, "types": ["Grass"], "evolvesFrom": "Nidorino",
    "attacks": [
      { "name": "Thrash", "cost": ["Grass", "Colorless", "Colorless"], "convertedEnergyCost": 3, "damage": "30+", "text": "Flip a coin. If heads, this attack does 30 damage plus 10 more damage; if tails, this attack does 30 damage and Nidoking does 10 damage to itself." },
      { "name": "Toxic", "cost": ["Grass", "Grass", "Grass"], "convertedEnergyCost": 3, "damage": "20", "text": "The Defending Pokémon is now Poisoned. It now takes 20 Poison damage instead of 10 after each player's turn (even if it was already Poisoned)." }
    ],
    "weaknesses": [{ "type": "Psychic", "value": "×2" }], "resistances": [], "retreatCost": 3
  },
  "Poliwrath": {
    "supertype": "Pokémon", "hp": 90, "types": ["Water"], "evolvesFrom": "Poliwhirl",
    "attacks": [
      { "name": "Water Gun", "cost": ["Water", "Water", "Colorless"], "convertedEnergyCost": 3, "damage": "30+", "text": "Does 30 damage plus 10 more damage for each Water Energy attached to Poliwrath but not used to pay for this attack's Energy cost. Extra Water Energy after the 2nd doesn't count." },
      { "name": "Whirlpool", "cost": ["Water", "Water", "Colorless", "Colorless"], "convertedEnergyCost": 4, "damage": "40", "text": "If the Defending Pokémon has any Energy cards attached to it, choose 1 of them and discard it." }
    ],
    "weaknesses": [{ "type": "Grass", "value": "×2" }], "resistances": [], "retreatCost": 3
  },
  "Raichu": {
    "supertype": "Pokémon", "hp": 80, "types": ["Lightning"], "evolvesFrom": "Pikachu",
    "attacks": [
      { "name": "Agility", "cost": ["Lightning", "Colorless", "Colorless"], "convertedEnergyCost": 3, "damage": "20", "text": "Flip a coin. If heads, during your opponent's next turn, prevent all effects of attacks, including damage, done to Raichu." },
      { "name": "Thunder", "cost": ["Lightning", "Lightning", "Lightning", "Colorless"], "convertedEnergyCost": 4, "damage": "60", "text": "Flip a coin. If tails, Raichu does 30 damage to itself." }
    ],
    "weaknesses": [{ "type": "Fighting", "value": "×2" }], "resistances": [], "retreatCost": 1
  },
  "Venusaur": {
    "supertype": "Pokémon", "hp": 100, "types": ["Grass"], "evolvesFrom": "Ivysaur",
    "pokemonPower": { "name": "Energy Trans", "text": "As often as you like during your turn (before your attack), you may take 1 Grass Energy card attached to 1 of your Pokémon and attach it to a different one. This power can't be used if Venusaur is Asleep, Confused, or Paralyzed." },
    "attacks": [
      { "name": "Solarbeam", "cost": ["Grass", "Grass", "Grass", "Grass"], "convertedEnergyCost": 4, "damage": "60", "text": "" }
    ],
    "weaknesses": [{ "type": "Fire", "value": "×2" }], "resistances": [], "retreatCost": 2
  },
  "Zapdos": {
    "supertype": "Pokémon", "hp": 90, "types": ["Lightning"], "evolvesFrom": null,
    "attacks": [
      { "name": "Thunder", "cost": ["Lightning", "Lightning", "Lightning", "Colorless"], "convertedEnergyCost": 4, "damage": "60", "text": "Flip a coin. If tails, Zapdos does 30 damage to itself." },
      { "name": "Thunderbolt", "cost": ["Lightning", "Lightning", "Lightning", "Lightning"], "convertedEnergyCost": 4, "damage": "100", "text": "Discard all Energy cards attached to Zapdos in order to use this attack." }
    ],
    "weaknesses": [], "resistances": [{ "type": "Fighting", "value": "-30" }], "retreatCost": 3
  },
  "Dragonair": {
    "supertype": "Pokémon", "hp": 80, "types": ["Colorless"], "evolvesFrom": "Dratini",
    "attacks": [
      { "name": "Slam", "cost": ["Colorless", "Colorless", "Colorless"], "convertedEnergyCost": 3, "damage": "30×", "text": "Flip 2 coins. This attack does 30 damage times the number of heads." },
      { "name": "Hyper Beam", "cost": ["Colorless", "Colorless", "Colorless", "Colorless"], "convertedEnergyCost": 4, "damage": "20", "text": "If the Defending Pokémon has any Energy cards attached to it, choose 1 of them and discard it." }
    ],
    "weaknesses": [], "resistances": [{ "type": "Psychic", "value": "-30" }], "retreatCost": 2
  },
  "Dugtrio": {
    "supertype": "Pokémon", "hp": 70, "types": ["Fighting"], "evolvesFrom": "Diglett",
    "attacks": [
      { "name": "Slash", "cost": ["Fighting", "Fighting", "Colorless"], "convertedEnergyCost": 3, "damage": "40", "text": "" },
      { "name": "Earthquake", "cost": ["Fighting", "Fighting", "Fighting", "Fighting"], "convertedEnergyCost": 4, "damage": "70", "text": "Does 10 damage to each of your own Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)" }
    ],
    "weaknesses": [{ "type": "Grass", "value": "×2" }], "resistances": [{ "type": "Lightning", "value": "-30" }], "retreatCost": 2
  },
  "Electabuzz": {
    "supertype": "Pokémon", "hp": 70, "types": ["Lightning"], "evolvesFrom": null,
    "attacks": [
      { "name": "Thundershock", "cost": ["Lightning"], "convertedEnergyCost": 1, "damage": "10", "text": "Flip a coin. If heads, the Defending Pokémon is now Paralyzed." },
      { "name": "Thunderpunch", "cost": ["Lightning", "Colorless"], "convertedEnergyCost": 2, "damage": "30+", "text": "Flip a coin. If heads, this attack does 30 damage plus 10 more damage; if tails, this attack does 30 damage and Electabuzz does 10 damage to itself." }
    ],
    "weaknesses": [{ "type": "Fighting", "value": "×2" }], "resistances": [], "retreatCost": 2
  },
  "Electrode": {
    "supertype": "Pokémon", "hp": 80, "types": ["Lightning"], "evolvesFrom": "Voltorb",
    "pokemonPower": { "name": "Buzzap", "text": "At any time during your turn (before your attack), you may Knock Out Electrode and attach it to 1 of your other Pokémon. If you do, choose a type of Energy. Electrode is now an Energy card (instead of a Pokémon) that provides 2 energy of that type. This power can't be used if Electrode is Asleep, Confused, or Paralyzed." },
    "attacks": [
      { "name": "Electric Shock", "cost": ["Lightning", "Lightning", "Lightning"], "convertedEnergyCost": 3, "damage": "50", "text": "Flip a coin. If tails, Electrode does 10 damage to itself." }
    ],
    "weaknesses": [{ "type": "Fighting", "value": "×2" }], "resistances": [], "retreatCost": 1
  },
  "Pidgeotto": {
    "supertype": "Pokémon", "hp": 60, "types": ["Colorless"], "evolvesFrom": "Pidgey",
    "attacks": [
      { "name": "Whirlwind", "cost": ["Colorless", "Colorless"], "convertedEnergyCost": 2, "damage": "20", "text": "If your opponent has any Benched Pokémon, he or she chooses 1 of them and switches it with the Defending Pokémon. (Do the damage before switching the Pokémon.)" },
      { "name": "Mirror Move", "cost": ["Colorless", "Colorless", "Colorless"], "convertedEnergyCost": 3, "damage": "0", "text": "If Pidgeotto was attacked last turn, do the final result of that attack on Pidgeotto to the Defending Pokémon." }
    ],
    "weaknesses": [{ "type": "Lightning", "value": "×2" }], "resistances": [{ "type": "Fighting", "value": "-30" }], "retreatCost": 1
  },
  "Dewgong": {
    "supertype": "Pokémon", "hp": 80, "types": ["Water"], "evolvesFrom": "Seel",
    "attacks": [
      { "name": "Aurora Beam", "cost": ["Water", "Water", "Colorless"], "convertedEnergyCost": 3, "damage": "50", "text": "" },
      { "name": "Ice Beam", "cost": ["Water", "Water", "Colorless", "Colorless"], "convertedEnergyCost": 4, "damage": "30", "text": "Flip a coin. If heads, the Defending Pokémon is now Paralyzed." }
    ],
    "weaknesses": [{ "type": "Lightning", "value": "×2" }], "resistances": [], "retreatCost": 3
  },
  "Dratini": {
    "supertype": "Pokémon", "hp": 40, "types": ["Colorless"], "evolvesFrom": null,
    "attacks": [
      { "name": "Pound", "cost": ["Colorless"], "convertedEnergyCost": 1, "damage": "10", "text": "" }
    ],
    "weaknesses": [], "resistances": [{ "type": "Psychic", "value": "-30" }], "retreatCost": 1
  },
  "Magmar": {
    "supertype": "Pokémon", "hp": 50, "types": ["Fire"], "evolvesFrom": null,
    "attacks": [
      { "name": "Fire Punch", "cost": ["Fire", "Fire"], "convertedEnergyCost": 2, "damage": "30", "text": "" },
      { "name": "Flamethrower", "cost": ["Fire", "Fire", "Colorless"], "convertedEnergyCost": 3, "damage": "50", "text": "Discard 1 Fire Energy card attached to Magmar in order to use this attack." }
    ],
    "weaknesses": [{ "type": "Water", "value": "×2" }], "resistances": [], "retreatCost": 2
  },
  "Nidorino": {
    "supertype": "Pokémon", "hp": 60, "types": ["Grass"], "evolvesFrom": "Nidoran ♂",
    "attacks": [
      { "name": "Double Kick", "cost": ["Grass", "Colorless", "Colorless"], "convertedEnergyCost": 3, "damage": "30×", "text": "Flip 2 coins. This attack does 30 damage times the number of heads." },
      { "name": "Horn Drill", "cost": ["Grass", "Grass", "Colorless", "Colorless"], "convertedEnergyCost": 4, "damage": "50", "text": "" }
    ],
    "weaknesses": [{ "type": "Psychic", "value": "×2" }], "resistances": [], "retreatCost": 1
  },
  "Poliwhirl": {
    "supertype": "Pokémon", "hp": 60, "types": ["Water"], "evolvesFrom": "Poliwag",
    "attacks": [
      { "name": "Amnesia", "cost": ["Water", "Water"], "convertedEnergyCost": 2, "damage": "0", "text": "Choose 1 of the Defending Pokémon's attacks. That Pokémon can't use that attack during your opponent's next turn." },
      { "name": "Doubleslap", "cost": ["Water", "Water", "Colorless"], "convertedEnergyCost": 3, "damage": "30×", "text": "Flip 2 coins. This attack does 30 damage times the number of heads." }
    ],
    "weaknesses": [{ "type": "Grass", "value": "×2" }], "resistances": [], "retreatCost": 1
  },
  "Porygon": {
    "supertype": "Pokémon", "hp": 30, "types": ["Colorless"], "evolvesFrom": null,
    "attacks": [
      { "name": "Conversion 1", "cost": ["Colorless"], "convertedEnergyCost": 1, "damage": "0", "text": "If the Defending Pokémon has a Weakness, you may change it to a type of your choice other than Colorless." },
      { "name": "Conversion 2", "cost": ["Colorless", "Colorless"], "convertedEnergyCost": 2, "damage": "0", "text": "Change Porygon's Resistance to a type of your choice other than Colorless." }
    ],
    "weaknesses": [{ "type": "Fighting", "value": "×2" }], "resistances": [{ "type": "Psychic", "value": "-30" }], "retreatCost": 1
  },
  "Raticate": {
    "supertype": "Pokémon", "hp": 60, "types": ["Colorless"], "evolvesFrom": "Rattata",
    "attacks": [
      { "name": "Bite", "cost": ["Colorless"], "convertedEnergyCost": 1, "damage": "20", "text": "" },
      { "name": "Super Fang", "cost": ["Colorless", "Colorless", "Colorless"], "convertedEnergyCost": 3, "damage": "0", "text": "Does damage to the Defending Pokémon equal to half the Defending Pokémon's remaining HP, rounded up to the nearest 10." }
    ],
    "weaknesses": [{ "type": "Fighting", "value": "×2" }], "resistances": [{ "type": "Psychic", "value": "-30" }], "retreatCost": 1
  },
  "Seel": {
    "supertype": "Pokémon", "hp": 60, "types": ["Water"], "evolvesFrom": null,
    "attacks": [
      { "name": "Headbutt", "cost": ["Water"], "convertedEnergyCost": 1, "damage": "10", "text": "" }
    ],
    "weaknesses": [{ "type": "Lightning", "value": "×2" }], "resistances": [], "retreatCost": 1
  },
  "Caterpie": {
    "supertype": "Pokémon", "hp": 40, "types": ["Grass"], "evolvesFrom": null,
    "attacks": [
      { "name": "String Shot", "cost": ["Grass"], "convertedEnergyCost": 1, "damage": "10", "text": "Flip a coin. If heads, the Defending Pokémon is now Paralyzed." }
    ],
    "weaknesses": [{ "type": "Fire", "value": "×2" }], "resistances": [], "retreatCost": 1
  },
  "Diglett": {
    "supertype": "Pokémon", "hp": 30, "types": ["Fighting"], "evolvesFrom": null,
    "attacks": [
      { "name": "Dig", "cost": ["Fighting"], "convertedEnergyCost": 1, "damage": "10", "text": "" },
      { "name": "Mud Slap", "cost": ["Fighting", "Fighting"], "convertedEnergyCost": 2, "damage": "30", "text": "" }
    ],
    "weaknesses": [{ "type": "Grass", "value": "×2" }], "resistances": [{ "type": "Lightning", "value": "-30" }], "retreatCost": 0
  },
  "Doduo": {
    "supertype": "Pokémon", "hp": 50, "types": ["Colorless"], "evolvesFrom": null,
    "attacks": [
      { "name": "Fury Attack", "cost": ["Colorless"], "convertedEnergyCost": 1, "damage": "10×", "text": "Flip 2 coins. This attack does 10 damage times the number of heads." }
    ],
    "weaknesses": [{ "type": "Lightning", "value": "×2" }], "resistances": [{ "type": "Fighting", "value": "-30" }], "retreatCost": 0
  },
  "Koffing": {
    "supertype": "Pokémon", "hp": 50, "types": ["Grass"], "evolvesFrom": null,
    "attacks": [
      { "name": "Foul Gas", "cost": ["Grass", "Grass"], "convertedEnergyCost": 2, "damage": "10", "text": "Flip a coin. If heads, the Defending Pokémon is now Poisoned. If tails, the Defending Pokémon is now Confused." }
    ],
    "weaknesses": [{ "type": "Psychic", "value": "×2" }], "resistances": [], "retreatCost": 1
  },
  "Metapod": {
    "supertype": "Pokémon", "hp": 70, "types": ["Grass"], "evolvesFrom": "Caterpie",
    "attacks": [
      { "name": "Stiffen", "cost": ["Colorless", "Colorless"], "convertedEnergyCost": 2, "damage": "0", "text": "Flip a coin. If heads, prevent all damage done to Metapod during your opponent's next turn. (Any other effects of attacks still happen.)" },
      { "name": "Stun Spore", "cost": ["Grass", "Grass"], "convertedEnergyCost": 2, "damage": "20", "text": "Flip a coin. If heads, the Defending Pokémon is now Paralyzed." }
    ],
    "weaknesses": [{ "type": "Fire", "value": "×2" }], "resistances": [], "retreatCost": 2
  },
  "Pidgey": {
    "supertype": "Pokémon", "hp": 40, "types": ["Colorless"], "evolvesFrom": null,
    "attacks": [
      { "name": "Whirlwind", "cost": ["Colorless", "Colorless"], "convertedEnergyCost": 2, "damage": "10", "text": "If your opponent has any Benched Pokémon, they choose 1 of them and switch it with the Defending Pokémon. (Do the damage before switching the Pokémon.)" }
    ],
    "weaknesses": [{ "type": "Lightning", "value": "×2" }], "resistances": [{ "type": "Fighting", "value": "-30" }], "retreatCost": 1
  },
  "Poliwag": {
    "supertype": "Pokémon", "hp": 40, "types": ["Water"], "evolvesFrom": null,
    "attacks": [
      { "name": "Water Gun", "cost": ["Water"], "convertedEnergyCost": 1, "damage": "10+", "text": "Does 10 damage plus 10 more damage for each Water Energy attached to Poliwag but not used to pay for this attack's Energy cost. You can't add more than 20 damage in this way." }
    ],
    "weaknesses": [{ "type": "Grass", "value": "×2" }], "resistances": [], "retreatCost": 1
  },
  "Ponyta": {
    "supertype": "Pokémon", "hp": 40, "types": ["Fire"], "evolvesFrom": null,
    "attacks": [
      { "name": "Smash Kick", "cost": ["Colorless", "Colorless"], "convertedEnergyCost": 2, "damage": "20", "text": "" },
      { "name": "Flame Tail", "cost": ["Fire", "Fire"], "convertedEnergyCost": 2, "damage": "30", "text": "" }
    ],
    "weaknesses": [{ "type": "Water", "value": "×2" }], "resistances": [], "retreatCost": 1
  },
  "Rattata": {
    "supertype": "Pokémon", "hp": 30, "types": ["Colorless"], "evolvesFrom": null,
    "attacks": [
      { "name": "Bite", "cost": ["Colorless"], "convertedEnergyCost": 1, "damage": "20", "text": "" }
    ],
    "weaknesses": [{ "type": "Fighting", "value": "×2" }], "resistances": [{ "type": "Psychic", "value": "-30" }], "retreatCost": 0
  },
  "Voltorb": {
    "supertype": "Pokémon", "hp": 40, "types": ["Lightning"], "evolvesFrom": null,
    "attacks": [
      { "name": "Tackle", "cost": ["Colorless"], "convertedEnergyCost": 1, "damage": "10", "text": "" }
    ],
    "weaknesses": [{ "type": "Fighting", "value": "×2" }], "resistances": [], "retreatCost": 1
  }
};

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
  "Fighting Energy": {
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
  }
};

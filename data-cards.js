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
  }
};

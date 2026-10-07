// Prices live here so the browser cannot change what an order costs.
// Keep in sync with HAMPERS, ING and BOXES in public/index.html.
module.exports = {
  "hampers": {
    "classic": {
      "name": "Classic Cocoa Box",
      "price": 799
    },
    "choconut": {
      "name": "Choco-Nut Party Box",
      "price": 1099
    },
    "dark": {
      "name": "Dark Side Hamper",
      "price": 1299
    },
    "kaju": {
      "name": "Kaju Celebration Box",
      "price": 1499
    },
    "annivmix": {
      "name": "Dark Chocolate and Dry Fruit Box",
      "price": 1799
    },
    "festive": {
      "name": "Festive Mithai Mix",
      "price": 1599
    },
    "almondpista": {
      "name": "Almond and Pista Box",
      "price": 1399
    },
    "royal": {
      "name": "Royal Dry Fruit Box",
      "price": 1899
    },
    "corp": {
      "name": "Office Thank-you Box",
      "price": 1199
    },
    "peanut": {
      "name": "Roasted Peanut Crunch Box",
      "price": 599
    },
    "snack": {
      "name": "Healthy Desk Snack Box",
      "price": 1299
    },
    "lux": {
      "name": "Chocoholic Grand Hamper",
      "price": 2999
    },
    "favours": {
      "name": "Wedding Favour Set of 10",
      "price": 4499
    },
    "kids": {
      "name": "Sprinkle Party Box",
      "price": 999
    }
  },
  "ing": {
    "milk": {
      "name": "Milk chocolate",
      "group": "Chocolates",
      "per100g": 180
    },
    "darkc": {
      "name": "Dark chocolate",
      "group": "Chocolates",
      "per100g": 220
    },
    "praline": {
      "name": "Hazelnut praline",
      "group": "Chocolates",
      "per100g": 260
    },
    "truffle": {
      "name": "Truffles",
      "group": "Chocolates",
      "per100g": 320
    },
    "almond": {
      "name": "Almonds (badam)",
      "group": "Nuts",
      "per100g": 120
    },
    "kaju": {
      "name": "Cashews (kaju)",
      "group": "Nuts",
      "per100g": 160
    },
    "pista": {
      "name": "Pistachios (pista)",
      "group": "Nuts",
      "per100g": 260
    },
    "peanut": {
      "name": "Roasted peanuts",
      "group": "Nuts",
      "per100g": 40
    },
    "walnut": {
      "name": "Walnuts (akhrot)",
      "group": "Nuts",
      "per100g": 150
    },
    "hazel": {
      "name": "Hazelnuts",
      "group": "Nuts",
      "per100g": 200
    },
    "raisin": {
      "name": "Raisins (kishmish)",
      "group": "Dry fruits",
      "per100g": 60
    },
    "dates": {
      "name": "Dates (khajoor)",
      "group": "Dry fruits",
      "per100g": 90
    },
    "figs": {
      "name": "Figs (anjeer)",
      "group": "Dry fruits",
      "per100g": 220
    },
    "apricot": {
      "name": "Apricots (khumani)",
      "group": "Dry fruits",
      "per100g": 140
    },
    "cran": {
      "name": "Dried cranberries",
      "group": "Dry fruits",
      "per100g": 130
    }
  },
  "boxes": {
    "s": {
      "name": "Small",
      "grams": 300,
      "price": 150
    },
    "m": {
      "name": "Medium",
      "grams": 500,
      "price": 250
    },
    "l": {
      "name": "Large",
      "grams": 800,
      "price": 400
    }
  },
  "bases": [
    "Chocolates",
    "Nuts",
    "Dry fruits",
    "Mix of all"
  ]
};

/* Shared menu definition: Customer, POS and backend use these exact prices and options. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.KopiCatalog = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const categories = [
  {
    "id": "kopi",
    "name": "Kopi;",
    "label": "Kopi;",
    "products": [
      {
        "id": "americano",
        "name": "Americano",
        "image": "Menu/Kopi1.png",
        "description": "Bold black coffee with a smooth espresso finish.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "HOT - 12oz": 100,
          "ICED - 16oz": 110
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "HOT - 12oz",
              "ICED - 16oz"
            ],
            "defaultValue": null,
            "priceKey": true
          },
          {
            "key": "ice",
            "label": "Ice Level",
            "values": [
              "Normal Ice",
              "Less Ice"
            ],
            "defaultValue": "Normal Ice",
            "priceKey": false
          },
          {
            "key": "addons",
            "label": "Add-ons (worth ₱30)",
            "values": [
              "Oat milk",
              "Espresso shot"
            ],
            "defaultValue": null,
            "priceKey": false,
            "addOnPrice": 30
          }
        ]
      },
      {
        "id": "caramel-macchiato",
        "name": "Caramel Macchiato",
        "image": "Menu/Kopi2.png",
        "description": "A smooth blend of vanilla syrup and steamed milk, topped with rich espresso and caramel drizzle.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "HOT - 12oz": 110,
          "ICED - 16oz": 120
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "HOT - 12oz",
              "ICED - 16oz"
            ],
            "defaultValue": null,
            "priceKey": true
          },
          {
            "key": "ice",
            "label": "Ice Level",
            "values": [
              "Normal Ice",
              "Less Ice"
            ],
            "defaultValue": "Normal Ice",
            "priceKey": false
          },
          {
            "key": "addons",
            "label": "Add-ons (worth ₱30)",
            "values": [
              "Oat milk",
              "Espresso shot"
            ],
            "defaultValue": null,
            "priceKey": false,
            "addOnPrice": 30
          }
        ]
      },
      {
        "id": "spanish-latte",
        "name": "Spanish Latte",
        "image": "Menu/Kopi3.png",
        "description": "Creamy espresso latte sweetened with a balanced Spanish-style finish.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "HOT - 12oz": 110,
          "ICED - 16oz": 120
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "HOT - 12oz",
              "ICED - 16oz"
            ],
            "defaultValue": null,
            "priceKey": true
          },
          {
            "key": "ice",
            "label": "Ice Level",
            "values": [
              "Normal Ice",
              "Less Ice"
            ],
            "defaultValue": "Normal Ice",
            "priceKey": false
          },
          {
            "key": "addons",
            "label": "Add-ons (worth ₱30)",
            "values": [
              "Oat milk",
              "Espresso shot"
            ],
            "defaultValue": null,
            "priceKey": false,
            "addOnPrice": 30
          }
        ]
      },
      {
        "id": "dirty-matcha",
        "name": "Dirty Matcha",
        "image": "Menu/Kopi4.png",
        "description": "Earthy matcha layered with espresso and milk.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "ICED - 16oz": 120
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "ICED - 16oz"
            ],
            "defaultValue": "ICED - 16oz",
            "priceKey": true
          },
          {
            "key": "ice",
            "label": "Ice Level",
            "values": [
              "Normal Ice",
              "Less Ice"
            ],
            "defaultValue": "Normal Ice",
            "priceKey": false
          },
          {
            "key": "addons",
            "label": "Add-ons (worth ₱30)",
            "values": [
              "Oat milk",
              "Espresso shot"
            ],
            "defaultValue": null,
            "priceKey": false,
            "addOnPrice": 30
          }
        ]
      },
      {
        "id": "dark-mocha",
        "name": "Dark Mocha",
        "image": "Menu/Kopi5.png",
        "description": "Dark chocolate and espresso with a creamy coffee base.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "HOT - 12oz": 110,
          "ICED - 16oz": 120
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "HOT - 12oz",
              "ICED - 16oz"
            ],
            "defaultValue": null,
            "priceKey": true
          },
          {
            "key": "ice",
            "label": "Ice Level",
            "values": [
              "Normal Ice",
              "Less Ice"
            ],
            "defaultValue": "Normal Ice",
            "priceKey": false
          },
          {
            "key": "addons",
            "label": "Add-ons (worth ₱30)",
            "values": [
              "Oat milk",
              "Espresso shot"
            ],
            "defaultValue": null,
            "priceKey": false,
            "addOnPrice": 30
          }
        ]
      },
      {
        "id": "white-choco-mocha",
        "name": "White Choco Mocha",
        "image": "Menu/Kopi6.png",
        "description": "A creamy blend of white chocolate and espresso with smooth steamed milk.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "HOT - 12oz": 110,
          "ICED - 16oz": 120
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "HOT - 12oz",
              "ICED - 16oz"
            ],
            "defaultValue": null,
            "priceKey": true
          },
          {
            "key": "ice",
            "label": "Ice Level",
            "values": [
              "Normal Ice",
              "Less Ice"
            ],
            "defaultValue": "Normal Ice",
            "priceKey": false
          },
          {
            "key": "addons",
            "label": "Add-ons (worth ₱30)",
            "values": [
              "Oat milk",
              "Espresso shot"
            ],
            "defaultValue": null,
            "priceKey": false,
            "addOnPrice": 30
          }
        ]
      },
      {
        "id": "cafe-latte",
        "name": "Cafe Latte",
        "image": "Menu/Kopi7.png",
        "description": "Rich espresso combined with velvety steamed milk for a smooth, classic taste.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "HOT - 12oz": 110,
          "ICED - 16oz": 120
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "HOT - 12oz",
              "ICED - 16oz"
            ],
            "defaultValue": null,
            "priceKey": true
          },
          {
            "key": "ice",
            "label": "Ice Level",
            "values": [
              "Normal Ice",
              "Less Ice"
            ],
            "defaultValue": "Normal Ice",
            "priceKey": false
          },
          {
            "key": "addons",
            "label": "Add-ons (worth ₱30)",
            "values": [
              "Oat milk",
              "Espresso shot"
            ],
            "defaultValue": null,
            "priceKey": false,
            "addOnPrice": 30
          }
        ]
      },
      {
        "id": "nutella-latte",
        "name": "Nutella Latte",
        "image": "Menu/Kopi8.png",
        "description": "Nutella with smooth espresso and milk.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "ICED - 16oz": 120
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "ICED - 16oz"
            ],
            "defaultValue": "ICED - 16oz",
            "priceKey": true
          },
          {
            "key": "ice",
            "label": "Ice Level",
            "values": [
              "Normal Ice",
              "Less Ice"
            ],
            "defaultValue": "Normal Ice",
            "priceKey": false
          },
          {
            "key": "addons",
            "label": "Add-ons (worth ₱30)",
            "values": [
              "Oat milk",
              "Espresso shot"
            ],
            "defaultValue": null,
            "priceKey": false,
            "addOnPrice": 30
          }
        ]
      },
      {
        "id": "salted-caramel",
        "name": "Salted Caramel",
        "image": "Menu/Kopi9.png",
        "description": "Caramel latte with a gentle salted finish.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "HOT - 12oz": 110,
          "ICED - 16oz": 120
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "HOT - 12oz",
              "ICED - 16oz"
            ],
            "defaultValue": null,
            "priceKey": true
          },
          {
            "key": "ice",
            "label": "Ice Level",
            "values": [
              "Normal Ice",
              "Less Ice"
            ],
            "defaultValue": "Normal Ice",
            "priceKey": false
          },
          {
            "key": "addons",
            "label": "Add-ons (worth ₱30)",
            "values": [
              "Oat milk",
              "Espresso shot"
            ],
            "defaultValue": null,
            "priceKey": false,
            "addOnPrice": 30
          }
        ]
      },
      {
        "id": "sea-salt-latte",
        "name": "Sea Salt Latte",
        "image": "Menu/Kopi10.png",
        "description": "Smooth espresso and creamy milk topped with a light, savory sea salt cream.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "ICED - 16oz": 120
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "ICED - 16oz"
            ],
            "defaultValue": "ICED - 16oz",
            "priceKey": true
          },
          {
            "key": "ice",
            "label": "Ice Level",
            "values": [
              "Normal Ice",
              "Less Ice"
            ],
            "defaultValue": "Normal Ice",
            "priceKey": false
          },
          {
            "key": "addons",
            "label": "Add-ons (worth ₱30)",
            "values": [
              "Oat milk",
              "Espresso shot"
            ],
            "defaultValue": null,
            "priceKey": false,
            "addOnPrice": 30
          }
        ]
      },
      {
        "id": "kopi-special",
        "name": "Kopi; Special",
        "image": "Menu/Kopi11.png",
        "description": "Our signature house blend featuring rich espresso, creamy milk, and a uniquely satisfying flavor.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "ICED - 16oz": 130
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "ICED - 16oz"
            ],
            "defaultValue": "ICED - 16oz",
            "priceKey": true
          },
          {
            "key": "ice",
            "label": "Ice Level",
            "values": [
              "Normal Ice",
              "Less Ice"
            ],
            "defaultValue": "Normal Ice",
            "priceKey": false
          },
          {
            "key": "addons",
            "label": "Add-ons (worth ₱30)",
            "values": [
              "Oat milk",
              "Espresso shot"
            ],
            "defaultValue": null,
            "priceKey": false,
            "addOnPrice": 30
          }
        ]
      }
    ]
  },
  {
    "id": "non-kopi",
    "name": "Non-Kopi;",
    "label": "Non-Kopi;",
    "products": [
      {
        "id": "milky-chocolate",
        "name": "Milky Chocolate",
        "image": "Menu/NonKopi1.png",
        "description": "Rich chocolate blended with creamy milk for a smooth, indulgent treat.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "HOT - 12oz": 110,
          "ICED - 16oz": 120
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "HOT - 12oz",
              "ICED - 16oz"
            ],
            "defaultValue": null,
            "priceKey": true
          },
          {
            "key": "ice",
            "label": "Ice Level",
            "values": [
              "Normal Ice",
              "Less Ice"
            ],
            "defaultValue": "Normal Ice",
            "priceKey": false
          },
          {
            "key": "addons",
            "label": "Add-ons (worth ₱30)",
            "values": [
              "Oat milk"
            ],
            "defaultValue": null,
            "priceKey": false,
            "addOnPrice": 30
          }
        ]
      },
      {
        "id": "matcha-latte",
        "name": "Matcha Latte",
        "image": "Menu/NonKopi2.png",
        "description": "Smooth matcha and milk with a clean green tea finish.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "HOT - 12oz": 110,
          "ICED - 16oz": 120
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "HOT - 12oz",
              "ICED - 16oz"
            ],
            "defaultValue": null,
            "priceKey": true
          },
          {
            "key": "ice",
            "label": "Ice Level",
            "values": [
              "Normal Ice",
              "Less Ice"
            ],
            "defaultValue": "Normal Ice",
            "priceKey": false
          },
          {
            "key": "addons",
            "label": "Add-ons (worth ₱30)",
            "values": [
              "Oat milk"
            ],
            "defaultValue": null,
            "priceKey": false,
            "addOnPrice": 30
          }
        ]
      },
      {
        "id": "strawberry-oreo",
        "name": "Strawberry Oreo",
        "image": "Menu/NonKopi3.png",
        "description": "Sweet strawberry and crunchy Oreo blended into a creamy, refreshing drink.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "ICED - 16oz": 120
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "ICED - 16oz"
            ],
            "defaultValue": "ICED - 16oz",
            "priceKey": true
          },
          {
            "key": "ice",
            "label": "Ice Level",
            "values": [
              "Normal Ice",
              "Less Ice"
            ],
            "defaultValue": "Normal Ice",
            "priceKey": false
          },
          {
            "key": "addons",
            "label": "Add-ons (worth ₱30)",
            "values": [
              "Oat milk"
            ],
            "defaultValue": null,
            "priceKey": false,
            "addOnPrice": 30
          }
        ]
      },
      {
        "id": "sea-salt-matcha",
        "name": "Sea Salt Matcha",
        "image": "Menu/NonKopi4.png",
        "description": "A creamy milk-based drink topped with a smooth, lightly salted cream and matcha.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "ICED - 16oz": 125
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "ICED - 16oz"
            ],
            "defaultValue": "ICED - 16oz",
            "priceKey": true
          },
          {
            "key": "ice",
            "label": "Ice Level",
            "values": [
              "Normal Ice",
              "Less Ice"
            ],
            "defaultValue": "Normal Ice",
            "priceKey": false
          },
          {
            "key": "addons",
            "label": "Add-ons (worth ₱30)",
            "values": [
              "Oat milk"
            ],
            "defaultValue": null,
            "priceKey": false,
            "addOnPrice": 30
          }
        ]
      },
      {
        "id": "chocolate-matcha",
        "name": "Chocolate Matcha",
        "image": "Menu/NonKopi5.png",
        "description": "A delightful blend of rich chocolate and smooth matcha.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "ICED - 16oz": 120
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "ICED - 16oz"
            ],
            "defaultValue": "ICED - 16oz",
            "priceKey": true
          },
          {
            "key": "ice",
            "label": "Ice Level",
            "values": [
              "Normal Ice",
              "Less Ice"
            ],
            "defaultValue": "Normal Ice",
            "priceKey": false
          },
          {
            "key": "addons",
            "label": "Add-ons (worth ₱30)",
            "values": [
              "Oat milk"
            ],
            "defaultValue": null,
            "priceKey": false,
            "addOnPrice": 30
          }
        ]
      },
      {
        "id": "milky-oreo",
        "name": "Milky Oreo",
        "image": "Menu/NonKopi6.png",
        "description": "Creamy milk blended with crushed Oreo cookies for a rich and satisfying flavor.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "ICED - 16oz": 120
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "ICED - 16oz"
            ],
            "defaultValue": "ICED - 16oz",
            "priceKey": true
          },
          {
            "key": "ice",
            "label": "Ice Level",
            "values": [
              "Normal Ice",
              "Less Ice"
            ],
            "defaultValue": "Normal Ice",
            "priceKey": false
          },
          {
            "key": "addons",
            "label": "Add-ons (worth ₱30)",
            "values": [
              "Oat milk"
            ],
            "defaultValue": null,
            "priceKey": false,
            "addOnPrice": 30
          }
        ]
      },
      {
        "id": "milky-strawberry",
        "name": "Milky Strawberry",
        "image": "Menu/NonKopi7.png",
        "description": "Fresh strawberry flavor blended with creamy milk for a sweet, refreshing taste.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "ICED - 16oz": 120
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "ICED - 16oz"
            ],
            "defaultValue": "ICED - 16oz",
            "priceKey": true
          },
          {
            "key": "ice",
            "label": "Ice Level",
            "values": [
              "Normal Ice",
              "Less Ice"
            ],
            "defaultValue": "Normal Ice",
            "priceKey": false
          },
          {
            "key": "addons",
            "label": "Add-ons (worth ₱30)",
            "values": [
              "Oat milk"
            ],
            "defaultValue": null,
            "priceKey": false,
            "addOnPrice": 30
          }
        ]
      }
    ]
  },
  {
    "id": "fruit-soda-tea-series",
    "name": "Fruit Soda and Tea Series",
    "label": "Fruit Soda and Tea Series",
    "products": [
      {
        "id": "hibiscus-tea-with-strawberry",
        "name": "Hibiscus Tea with Strawberry popping bobba",
        "image": "Menu/Hibiscus_tea.png",
        "description": "A refreshing hibiscus tea, sweet strawberry, and popping bobba for a fruity burst in every sip.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "HOT - 12oz": 110,
          "ICED - 16oz": 120
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "HOT - 12oz",
              "ICED - 16oz"
            ],
            "defaultValue": null,
            "priceKey": true
          },
          {
            "key": "ice",
            "label": "Ice Level",
            "values": [
              "Normal Ice",
              "Less Ice"
            ],
            "defaultValue": "Less Ice",
            "priceKey": false
          },
          {
            "key": "addons",
            "label": "Add-ons (worth ₱30)",
            "values": [
              "Syrup-Sauce"
            ],
            "defaultValue": null,
            "priceKey": false,
            "addOnPrice": 30
          }
        ]
      },
      {
        "id": "green-apple",
        "name": "Green Apple",
        "image": "Menu/FruitSoda1.png",
        "description": "Crisp green apple flavor with sparkling soda for a refreshing fizz.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "16oz": 110
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "16oz"
            ],
            "defaultValue": "16oz",
            "priceKey": true
          },
          {
            "key": "ice",
            "label": "Ice Level",
            "values": [
              "Normal Ice",
              "Less Ice"
            ],
            "defaultValue": "Normal Ice",
            "priceKey": false
          },
          {
            "key": "addons",
            "label": "Add-ons (worth ₱30)",
            "values": [
              "Syrup-Sauce"
            ],
            "defaultValue": null,
            "priceKey": false,
            "addOnPrice": 30
          }
        ]
      },
      {
        "id": "blueberry",
        "name": "Blueberry",
        "image": "Menu/FruitSoda2.png",
        "description": "Sweet blueberry blended with sparkling soda for a fruity, bubbly refreshment.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "16oz": 110
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "16oz"
            ],
            "defaultValue": "16oz",
            "priceKey": true
          },
          {
            "key": "ice",
            "label": "Ice Level",
            "values": [
              "Normal Ice",
              "Less Ice"
            ],
            "defaultValue": "Normal Ice",
            "priceKey": false
          },
          {
            "key": "addons",
            "label": "Add-ons (worth ₱30)",
            "values": [
              "Syrup-Sauce"
            ],
            "defaultValue": null,
            "priceKey": false,
            "addOnPrice": 30
          }
        ]
      },
      {
        "id": "lychee",
        "name": "Lychee",
        "image": "Menu/FruitSoda3.png",
        "description": "Delicate lychee flavor mixed with sparkling soda for a light and refreshing drink.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "16oz": 110
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "16oz"
            ],
            "defaultValue": "16oz",
            "priceKey": true
          },
          {
            "key": "ice",
            "label": "Ice Level",
            "values": [
              "Normal Ice",
              "Less Ice"
            ],
            "defaultValue": "Normal Ice",
            "priceKey": false
          },
          {
            "key": "addons",
            "label": "Add-ons (worth ₱30)",
            "values": [
              "Syrup-Sauce"
            ],
            "defaultValue": null,
            "priceKey": false,
            "addOnPrice": 30
          }
        ]
      },
      {
        "id": "strawberry",
        "name": "Strawberry",
        "image": "Menu/FruitSoda4.png",
        "description": "Sweet strawberry flavor combined with sparkling soda for a fruity, fizzy delight.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "16oz": 110
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "16oz"
            ],
            "defaultValue": "16oz",
            "priceKey": true
          },
          {
            "key": "ice",
            "label": "Ice Level",
            "values": [
              "Normal Ice",
              "Less Ice"
            ],
            "defaultValue": "Normal Ice",
            "priceKey": false
          },
          {
            "key": "addons",
            "label": "Add-ons (worth ₱30)",
            "values": [
              "Syrup-Sauce"
            ],
            "defaultValue": null,
            "priceKey": false,
            "addOnPrice": 30
          }
        ]
      }
    ]
  },
  {
    "id": "cream-based",
    "name": "Cream Based",
    "label": "Frappe",
    "products": [
      {
        "id": "nutty-choco",
        "name": "Nutty Choco",
        "image": "Menu/CreamB1.png",
        "description": "A creamy blend of rich chocolate and nutty flavors, perfectly blended with ice.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "16oz": 140
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "16oz"
            ],
            "defaultValue": "16oz",
            "priceKey": true
          }
        ]
      },
      {
        "id": "triple-white-chocolate",
        "name": "Triple White Chocolate",
        "image": "Menu/CreamB2.png",
        "description": "Smooth white chocolate blended into a rich, creamy frappe.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "16oz": 150
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "16oz"
            ],
            "defaultValue": "16oz",
            "priceKey": true
          }
        ]
      },
      {
        "id": "matcha-cream",
        "name": "Matcha Cream",
        "image": "Menu/CreamB3.png",
        "description": "Premium matcha blended with creamy milk for a smooth and refreshing treat.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "16oz": 140
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "16oz"
            ],
            "defaultValue": "16oz",
            "priceKey": true
          }
        ]
      },
      {
        "id": "triple-chocolate",
        "name": "Triple Chocolate",
        "image": "Menu/CreamB4.png",
        "description": "A rich blend of chocolatey flavor, perfectly creamy and indulgent.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "16oz": 150
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "16oz"
            ],
            "defaultValue": "16oz",
            "priceKey": true
          }
        ]
      },
      {
        "id": "cookies-n-cream",
        "name": "Cookies n' Cream",
        "image": "Menu/CreamB5.png",
        "description": "Creamy vanilla blended with crushed cookies for a classic favorite.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "16oz": 140
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "16oz"
            ],
            "defaultValue": "16oz",
            "priceKey": true
          }
        ]
      },
      {
        "id": "strawberry-n-cream",
        "name": "Strawberry n' Cream",
        "image": "Menu/CreamB6.png",
        "description": "Sweet strawberry blended with creamy milk for a refreshing frappe.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "16oz": 150
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "16oz"
            ],
            "defaultValue": "16oz",
            "priceKey": true
          }
        ]
      },
      {
        "id": "biscoff-n-cream",
        "name": "Biscoff n' Cream",
        "image": "Menu/CreamB7.png",
        "description": "Creamy milk blended with caramelized Biscoff cookies for a rich, spiced flavor.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "16oz": 150
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "16oz"
            ],
            "defaultValue": "16oz",
            "priceKey": true
          }
        ]
      }
    ]
  },
  {
    "id": "coffee-based",
    "name": "Coffee Based",
    "label": "Coffee Based",
    "products": [
      {
        "id": "triple-mocha",
        "name": "Triple Mocha",
        "image": "Menu/CoffeeB1.png",
        "description": "A rich blend of espresso and three layers of chocolate, perfectly blended with ice.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "16oz": 160
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "16oz"
            ],
            "defaultValue": "16oz",
            "priceKey": true
          }
        ]
      },
      {
        "id": "mocha-frappe",
        "name": "Mocha Frappe",
        "image": "Menu/CoffeeB2.png",
        "description": "Bold espresso and rich chocolate blended into a smooth, icy treat.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "16oz": 160
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "16oz"
            ],
            "defaultValue": "16oz",
            "priceKey": true
          }
        ]
      },
      {
        "id": "caramel-frappe",
        "name": "Caramel Frappe",
        "image": "Menu/CoffeeB3.png",
        "description": "Smooth espresso blended with sweet caramel and creamy milk.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "16oz": 160
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "16oz"
            ],
            "defaultValue": "16oz",
            "priceKey": true
          }
        ]
      },
      {
        "id": "dark-mochaccino",
        "name": "Dark Mochaccino",
        "image": "Menu/CoffeeB4.png",
        "description": "Bold espresso and dark chocolate blended for a rich, intense flavor.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "16oz": 160
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "16oz"
            ],
            "defaultValue": "16oz",
            "priceKey": true
          }
        ]
      },
      {
        "id": "white-mocha-frappe",
        "name": "White Mocha Frappe",
        "image": "Menu/CoffeeB5.png",
        "description": "Espresso blended with creamy white chocolate for a smooth and indulgent finish.",
        "type": "drink",
        "customizable": true,
        "prices": {
          "16oz": 160
        },
        "options": [
          {
            "key": "size",
            "label": "Size",
            "values": [
              "16oz"
            ],
            "defaultValue": "16oz",
            "priceKey": true
          }
        ]
      }
    ]
  },
  {
    "id": "rice-meals",
    "name": "Rice Meals",
    "label": "Rice Meals",
    "products": [
      {
        "id": "bangus",
        "name": "Bangus",
        "image": "Menu/RiceM1.png",
        "description": "Bangus, garlic rice, and egg.",
        "type": "food",
        "customizable": true,
        "prices": {
          "Regular": 189
        },
        "options": []
      },
      {
        "id": "liempo",
        "name": "Liempo",
        "image": "Menu/RiceM2.png",
        "description": "Liempo, garlic rice, and egg.",
        "type": "food",
        "customizable": true,
        "prices": {
          "Regular": 169
        },
        "options": []
      },
      {
        "id": "tapa",
        "name": "Tapa",
        "image": "Menu/RiceM3.png",
        "description": "Tapa, garlic rice, and egg.",
        "type": "food",
        "customizable": true,
        "prices": {
          "Regular": 179
        },
        "options": []
      },
      {
        "id": "hungarian-sausage",
        "name": "Hungarian Sausage",
        "image": "Menu/RiceM4.png",
        "description": "Hungarian sausage, garlic rice, and egg.",
        "type": "food",
        "customizable": true,
        "prices": {
          "Regular": 169
        },
        "options": []
      }
    ]
  },
  {
    "id": "chicken-meals",
    "name": "Chicken Meals",
    "label": "Chicken Meals",
    "products": [
      {
        "id": "chicken-wings",
        "name": "Chicken Wings",
        "image": "Menu/ChickenM1.png",
        "description": "Crispy, juicy chicken wings tossed in your favorite flavorful sauce.",
        "type": "food",
        "customizable": true,
        "prices": {
          "6pcs": 190,
          "12pcs": 370
        },
        "options": [
          {
            "key": "flavor",
            "label": "Flavors",
            "values": [
              "Sweet Chili",
              "Spicy",
              "Garlic Parmesan"
            ],
            "defaultValue": "Sweet Chili",
            "priceKey": false
          },
          {
            "key": "pieces",
            "label": "Pieces",
            "values": [
              "6pcs",
              "12pcs"
            ],
            "defaultValue": "12pcs",
            "priceKey": true
          }
        ]
      },
      {
        "id": "chicken-fingers-with-fries",
        "name": "Chicken Fingers with Fries",
        "image": "Menu/ChickenM2.png",
        "description": "Crispy chicken tenders served with golden, seasoned fries for a satisfying meal.",
        "type": "food",
        "customizable": true,
        "prices": {
          "Regular": 195
        },
        "options": [
          {
            "key": "flavor",
            "label": "Flavors",
            "values": [
              "Sweet Chili",
              "Spicy",
              "Garlic Parmesan"
            ],
            "defaultValue": "Sweet Chili",
            "priceKey": false
          }
        ]
      }
    ]
  },
  {
    "id": "snacks",
    "name": "Snacks",
    "label": "Snacks",
    "products": [
      {
        "id": "beef-quesadilla",
        "name": "Beef Quesadilla",
        "image": "Menu/Snack1.png",
        "description": "Seasoned beef and melted cheese folded in a toasted tortilla.",
        "type": "food",
        "customizable": true,
        "prices": {
          "Regular": 155
        },
        "options": []
      },
      {
        "id": "cheese-quesadilla",
        "name": "Cheese Quesadilla",
        "image": "Menu/Snack2.png",
        "description": "Melted cheese wrapped in a warm, toasted tortilla for a simple classic.",
        "type": "food",
        "customizable": true,
        "prices": {
          "Regular": 145
        },
        "options": []
      },
      {
        "id": "nachos",
        "name": "Nachos",
        "image": "Menu/Snack3.png",
        "description": "Crispy nachos topped with rich, creamy cheese sauce.",
        "type": "food",
        "customizable": true,
        "prices": {
          "Regular": 155
        },
        "options": []
      },
      {
        "id": "cheesy-fries",
        "name": "Cheesy Fries",
        "image": "Menu/Snack4.png",
        "description": "Golden fries topped with creamy cheese sauce.",
        "type": "food",
        "customizable": true,
        "prices": {
          "Regular": 145
        },
        "options": []
      }
    ]
  }
];
  const products = categories.flatMap(group => group.products.map(product => ({ ...product, category: group.id })));
  const findProduct = id => products.find(product => product.id === id);
  return { categories, products, findProduct };
});


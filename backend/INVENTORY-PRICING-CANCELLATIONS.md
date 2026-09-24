# Inventory, pricing and cancellations

## What's connected

- The customer Menu, admin POS and backend pricing share Customer/Catalog.js.
- The server decides names, sizes, add-on prices, the KOPI10 discount and totals.
  Prices or discounts sent by a customer are not trusted. Delivery is currently free.
- All 45 menu products have recipes for every offered size. Selected add-ons,
  chicken flavors, less ice (40% less), quantities and takeaway packaging are included.
- Orders and deductions are saved together. Insufficient stock or a failed write
  rolls back the whole operation, rather than leaving a partial order.
- Checkout retry keys prevent duplicate orders and deductions. Use **Recover
  previous order** after losing a response; do not send another GCash payment.

## What the Inventory numbers mean

Stock is **available, unallocated** grams, milliliters or pieces, not the number
of unopened packages. The table also shows package equivalents.

- Add stock: enter the actual amount received in the displayed base unit.
- Set stock: enter available stock, excluding ingredients reserved for open orders.
- Low stock: 25% of one package or less, but more than zero.
- Sugar, Condensed Milk and Sprite: one package or less is low stock.
- Zero is out of stock. Orders that need it are blocked.
- The history button shows every recorded addition, deduction and stock return.

## Cancellation rules

- **New:** ingredients are reserved. Cancellation returns the exact allocations
  recorded for that order, once only.
- **Preparing:** ingredients are considered consumed. Cancellation does not put
  prepared food or drinks back into stock.
- **Out for Delivery, Arrived or Completed:** cancellation is rejected.
- A recipe or unit conversion edited later never changes a historical return.
- Canceling GCash does not issue a refund. It flags the payment for staff review.

## Starter assumptions approved for setup

These are estimates, not measurements from the shop. The Inventory page labels
them **STARTER ESTIMATE**. Use **Measured conversions** to replace each one.

| Ingredient | Recipe amount | Equivalent stock amount |
| --- | --- | --- |
| Chicken wing | 1 piece | 50 g |
| Chicken finger | 1 piece | 35 g |
| Condensed milk | 20 ml | 26 g |
| Garlic parmesan glaze | 20 g | 20 ml |
| Cheese sauce | 50 g | 50 ml |
| Bangus | 350 g | 1 piece |

Seven previously missing supplies are added: oat milk, white chocolate sauce,
salted caramel sauce, chocolate sauce, strawberry jam topping, grated-cheese
snack topping mix, and nacho salsa. Their package sizes are starter assumptions
(1 L, 1 L, 750 ml, 1 L, 1 kg, 500 g, and 1 L respectively).
They start with **zero available stock**. Add the quantities actually on hand.
Existing stock counts and custom recipe edits are preserved.

Recipes & unit setup lets you change ingredients or portions. Water is treated
as an untracked shop utility because it is not in the supplied inventory list.

## Checks

From the backend folder:

```powershell
npm.cmd test
node tools/check-inventory.js
```

Tests use separate in-memory databases. They do not create real orders, consume
shop inventory or transfer money. The readiness check is read-only.

Restart the backend after installing code changes with `npm.cmd run start`.
Reports, account management and deployment hardening are outside this phase.

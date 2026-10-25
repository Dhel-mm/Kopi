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
- Low stock: available stock at or below the ingredient's **reorder level**.
  The reorder level uses four parameters: the package baseline (25% of one
  package; one package for Sugar, Condensed Milk and Sprite), average daily
  order usage over the last 14 days, lead time in days (default 2) and safety
  stock days (default 1). Reorder level = the higher of the baseline and
  daily usage × (lead time + safety days). Admin can change lead time and
  safety days, or save a manual reorder level, with the sliders button.
- Zero is out of stock. Orders that need it are blocked.
- The history button shows every recorded addition, deduction and stock return.

## Cancellation rules

- **New:** ingredients are reserved. The customer or an Admin can cancel.
  Cancellation returns the exact allocations recorded for that order, once only.
- **Preparing:** ingredients are considered consumed. Customers can no longer
  cancel online; an Admin can cancel from **Operations** (for example, if the
  customer calls). Cancellation does not put prepared food or drinks back into stock.
- A canceled order gives its one-time voucher back, so the customer can use it again.
- Manual discounts are not accepted. Use vouchers for every price reduction.
- Senior Citizen and PWD discount: 20% plus VAT exemption on the cardholder's
  own order (one drink and one food item). The ID number and name are saved
  on the order; cashiers must check the physical ID, and riders check it on
  delivery. It cannot be combined with a voucher. If the shop is not
  VAT-registered, set `vatRegistered: false` in `services/pricing.js`.
- ID checks:
  - **ID number format.** PWD IDs follow the NCDA/DOH format
    `RR-PPMM-BBB-NNNNNNN` (Philippine Standard Geographic Code region,
    province, city/municipality and barangay, then the sequence number), e.g.
    `04-3405-012-0001234` for Calamba City, Laguna. A 5-digit sequence is also
    accepted because some LGUs use it, and the region code must be 01 to 18.
    Senior Citizen (OSCA) IDs have no single nationwide format, so any control
    number of 4 to 30 letters and numbers with at least 3 digits is accepted.
  - **Online orders: ID photo checked by staff.** The customer must upload a
    photo of the ID before applying the discount. The order is saved with the
    ID status "Pending verification" and cannot be prepared until Admin
    (Operations > order details > Senior Citizen / PWD discount box) or Staff
    (Preparation Queue card) opens **View ID**, compares the photo with the name
    and ID number, and clicks **ID is valid**. **Not approved** keeps the order but removes the
    discount: the order goes back to its normal price, the customer gets a
    "Discount not approved" notice, and for a GCash order (already paid at the
    discounted price) the rider collects the difference in cash. In Operations,
    orders still waiting for this check show a **Verify Order** button. Riders still
    check the physical ID on delivery.
  - **In-store orders: unchanged.** The cashier checks the physical ID and
    ticks "I checked the physical ID"; the POS also checks the ID against the
    simulated OSCA/NCDA registry (`services/idRegistry.js`, seven sample records
    such as `OSCA-CAL-2016-00123` Juan Dela Cruz). The registry no longer has an
    admin screen.
- **Online pickup:** at checkout the customer chooses Delivery or Pickup. Pickup
  needs no address. The customer pays at the store (cash) or prepays by GCash;
  paying at the store has the same ₱1,500 / 10-item limit and phone-check flags
  as cash on delivery. Steps: New → Preparing → **Ready for Pickup** (the
  customer gets a "ready for pickup" notice with the amount to pay) →
  Completed (Staff confirm the customer picked it up and paid). An
  administrator can cancel a ready order that was never collected; the
  prepared items stay deducted.
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

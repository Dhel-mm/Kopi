# Manual GCash checkout

Customers choose **GCash** from the Payment Method selector in checkout.
They can open/download the supplied QR, copy **+639551778760**, and enter
the reference number from their GCash receipt. Cash remains available.

This integration does not connect to GCash or verify a transfer automatically.
The customer must check the recipient and final total in GCash before sending.
If the amount or cart changes, it must be checked again.

## Staff verification

Admin or Staff can confirm a GCash payment.

1. **Admin:** open **Admin > Operations > Online Orders** and click **Update**.
   **Staff:** open **Preparation** and find the order card.
2. Compare the order's amount and reference with the transaction actually
   received in the shop's GCash account.
3. Only when both match, click **Confirm GCash received** and confirm.
4. The order can now be marked **Preparing**.

Only an Admin can mark a payment as **not received** (this cancels the order).

Until staff confirms receipt, the payment is **Pending verification**.
Submitting a reference or receiving an order receipt is not proof of payment.
Duplicate GCash references are rejected. The database records who confirmed
receipt and when. Canceling an order does not send a refund; staff must handle
any refund separately.

## Reference number format

GCash receipts show a purely numeric **13-digit** Ref. No. The checkout and the
cashier screen accept numbers only (letters and spaces are removed as you type)
and require exactly 13 digits. The same reference cannot be used on two orders.

## Delayed payments and fake orders

- A GCash order stays **Pending verification** until staff see the money in the
  shop's GCash history. It cannot be prepared before that, so a delayed
  transfer costs nothing: the order simply waits. The customer is told not to
  send the payment again.
- Staff and Admin see how long each payment has waited. After 5 minutes the
  card turns orange: check the GCash history again, then call the customer.
  Admin can mark **GCash not received**, which cancels the order and notifies
  the customer.
- Customers may attach a GCash receipt screenshot (optional). It helps staff
  find the transaction, but a screenshot can be edited, so it is never proof.
- Online Senior Citizen / PWD discounts work the same way: the customer uploads
  a photo of the ID, and Admin or Staff open **View ID** and verify it before the
  order can be prepared. If the ID is not approved, the order is not canceled:
  the discount is removed, the order continues at the normal price and the
  customer is notified. For a GCash order the rider collects the difference in cash.
- Cash on delivery (and paying at the store for a pickup order) is limited to ₱1,500 and 10 items. Larger online orders must
  be paid by GCash before they are prepared.
- Online orders show checks: first order, large order, earlier orders the shop
  rejected, and a phone number different from the account. A flagged cash order
  can only be started after staff call or text the customer to confirm it.
- Admin or Staff can **Reject** a new online order with a reason (unreachable
  phone, fake address, duplicate, suspicious, other). Reserved ingredients are
  returned and the customer sees the reason. Repeat offenders can be set to
  Inactive in **Users**.

## Local development

Restart the backend after deploying these changes:

```powershell
npm.cmd run start
```

Run from the backend folder. On startup, the database adds the payment fields
without deleting existing orders. No payment-provider keys are needed.

Run isolated tests (they do not write to the real database or send payments):

```powershell
node --test tests/manual-payment.test.js
```

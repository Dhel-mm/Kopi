# Manual GCash checkout

Customers choose **GCash** from the Payment Method selector in checkout.
They can open/download the supplied QR, copy **+639551778760**, and enter
the reference number from their GCash receipt. Cash remains available.

This integration does not connect to GCash or verify a transfer automatically.
The customer must check the recipient and final total in GCash before sending.
If the amount or cart changes, it must be checked again.

## Staff verification

1. Open **Admin > Operations > Online Orders** and click **Update**.
2. Compare the order's amount and reference with the transaction actually
   received in the shop's GCash account.
3. Only when both match, click **Confirm GCash received** and confirm.
4. The order can now be marked **Preparing**.

Until staff confirms receipt, the payment is **Pending verification**.
Submitting a reference or receiving an order receipt is not proof of payment.
Duplicate GCash references are rejected. The database records who confirmed
receipt and when. Canceling an order does not send a refund; staff must handle
any refund separately.

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

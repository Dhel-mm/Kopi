# School demonstration setup

This opt-in setup supplies demonstration inventory and creates one Customer
account. These quantities are sample data, not a record of actual shop stock.
No customer password belongs in this document or in GitHub.

## Render

After pushing this code to the service's linked branch, set these Environment
variables on the existing Render web service:

- `DEMO_SETUP_ENABLED=true`
- `DEMO_CUSTOMER_EMAIL`: an unused email for the demo customer
- `DEMO_CUSTOMER_PASSWORD`: a password of at least 8 characters (maximum 72 UTF-8 bytes)

Save the variables and deploy the latest commit. The startup log confirms when
demo initialization succeeds, without printing the email or password.

The email must not belong to an existing account. If it does, choose a different
demo email. The initializer will not reset that account or change its role.

## Behavior

- Runs after normal inventory and account initialization.
- Uses the CSV's opening stock; supplies missing from the CSV get ten packages.
- Ensures active ingredients exceed their configured low-stock thresholds.
- Keeps existing quantities when they are higher; archived ingredients are untouched.
- Logs each top-up in inventory movements.
- Creates an Active Customer named Demo Customer, with a hashed password.
- Leaves previous customers, orders, transactions, recipes and prices intact.
- Records completion in `demo_setup_runs`. Further restarts do not refill consumed
  stock, recreate deleted accounts, or overwrite changed passwords.
- Disabling the flag prevents future setup; it does not undo already-created data.

If Render Free loses its local SQLite database, the setup runs again against the
new empty database while enabled. It does not recover lost orders or accounts.
Use persistent storage and backups for real operations. Turn off this flag when
switching to real shop data.

## Check after deployment

1. Sign in as Admin and inspect Inventory: all active ingredients should be In Stock.
2. Inspect Users: the new account must have Customer access, never Admin access.
3. Sign in as the demo customer and test a Cash order without sending real payment.
4. Confirm normal inventory deductions and order-status updates still work.

# Kopi; Calamba: reports, accounts, and launch

## Current status

The backend supports reporting, account changes, photos, staff-assisted password recovery, access management, backup/restore, and launch checks. This is not a public deployment. Run the checks below and resolve their findings before accepting real customer traffic.

No real account password or JWT secret was changed for you. The existing database and shop records were preserved. The older shared placeholder administrator password is unsafe for public use.

## Open the website locally

In the first PowerShell window:

```powershell
cd "C:\Users\Marquez Family\Documents\Print\Dhel\codes\Kopi; Calamba\backend"
npm.cmd run start
```

Keep that window running, then open http://localhost:3000 in your browser. Use that address for both the customer and admin pages; do not double-click HTML files or use a separate Live Server port. Keep using the same hostname: localhost and 127.0.0.1 have separate browser sign-in storage.

If the port is already in use, find the PowerShell window running the old backend and press Ctrl+C there, then restart. After changing backend JavaScript, stop and restart it. Refresh the browser after changing frontend code. Shutting down the PC stops the website but does not erase the database.

Use a second PowerShell window in the backend folder for these checks:

```powershell
npm.cmd test
npm.cmd run check:inventory
npm.cmd run check:launch
```

The launch check intentionally returns a failure while unsafe settings remain. Passing tests does not mean the public website is deployed.

## Reports

- All report date filters and day/week/month boundaries use Asia/Manila. Stored timestamps are UTC.
- Today's sales and monthly sales count Completed orders using their completion date, not the date they were placed.
- Canceled orders appear in Transactions but never increase sales. Refund status is shown separately; cancellation does not transfer money.
- Total transactions counts both completed and canceled records. The three summary cards remain today/all records/current month when table filters change.
- Table search, date/status/type/payment filters, pagination, and CSV export use the backend records. Export follows the current filters and is limited to 10,000 rows; narrow the date range for larger histories. CSV timestamp columns are explicitly UTC.
- Dashboard chart selectors work independently. Daily sales figures provide a text alternative if the chart CDN is unavailable.
- The order summary counts non-canceled orders by placement date. Served This Week counts completed orders from Monday through today.
- Top products show completed item sales before order-level discounts and delivery fees. They are not profit figures.
- Historical completed records without a completion timestamp are flagged and excluded from dated sales rather than assigned invented dates. Old cash records may still display Unpaid if no payment evidence was recorded; they are not silently rewritten.
- Customer feedback is available under Admin > Users (latest 100 submissions).

## Account features

Customers use Account. Administrators click their name in the header, then open Profile details & password.

Names and an optional 11-digit phone number beginning with 09 can be saved. Changing the email address or password requires the current password. New passwords require at least 8 characters and cannot exceed 72 UTF-8 bytes. Profile changes are saved together: a rejected password/email change does not partially change the name.

PNG/JPEG profile photos up to 250 KB are stored in the database and included in backups. The Remove control removes the current photo.

Changing an email/password, completing password recovery, or changing account access invalidates older sessions. Logout signs out all server sessions for that account. Remember me stores the session in this browser for up to seven days; otherwise it is a tab session with a 12-hour token lifetime. Shared devices should leave Remember me unchecked and log out.

Admin > Users can add accounts or manage roles/status. These operations require the acting administrator's current password. An administrator cannot deactivate/demote themselves or remove the final active administrator through this page.

### Forgotten password

**By email (self-service):** on Forgot password?, the owner types the email of their account and clicks **Send recovery code**. If an active, verified account uses that email, a single-use 6-digit code is emailed (one email per minute, valid for 15 minutes). The code works only together with the same email, and 5 wrong tries cancel it. If no account uses the email, the page says so. The owner then enters the code and a new password on the same page. This needs email set up in backend/.env (SMTP_USER and SMTP_PASS, or Brevo); without it, local development prints the code in the server window.

**Staff-assisted, when the owner cannot open their email:**

1. Staff independently verify the account owner's identity; knowing an email alone is not enough.
2. An administrator opens Users > Recovery code for the correct account.
3. They confirm identity verification and enter their own administrator password.
4. Share the resulting code privately with that account owner. Do not put it in a public chat, screenshot, or URL.
5. The owner follows Forgot password? on the login page, enters the code, and chooses their own new password.

Codes expire in 15 minutes, work once, and are stored only as hashes. A new code invalidates the previous code. Staff should never ask customers to disclose their password.

If the sole administrator is locked out, the trusted server operator can run this from the backend folder:

```powershell
npm.cmd run recover:admin -- "the-current-admin-email@example.com"
```

Replace the sample email with the actual account email. This issues a recovery code, not a new password. The operator must have authorized access to the private server/database. Open /reset.html and finish recovery privately.

## Back up and restore

Run:

```powershell
npm.cmd run backup
```

This uses SQLite's online backup API, checks integrity and foreign keys, and creates a timestamped file in a backups directory next to the database. It works while the server is running. Do not just copy kopi.db while the server is writing: committed changes may be in its WAL file.

Copy completed backups to protected off-machine storage. Backups contain customer information and password hashes; restrict access, encrypt stored copies where available, and never publish them. No recurring backup job has been enabled automatically. Make a backup before upgrades and regularly during operation.

To recover, stop the backend with Ctrl+C. Restore to a NEW file:

```powershell
npm.cmd run restore -- "C:\KopiBackups\chosen-backup.db" "C:\KopiData\restored-kopi.db"
```

Substitute your actual paths. The tool refuses to overwrite an existing file. After it reports successful verification, set DATABASE_PATH in the private .env to the new absolute path, then restart. Verify sign-in, order counts, stock, and reports before reopening ordering. Keep the original database for rollback; do not delete it while checking the restored copy.

## Before public launch

1. Back up the current database.
2. In the admin profile, change the shared placeholder password to a unique private password. Changing ADMIN_PASSWORD in .env alone DOES NOT change an existing account.
3. Remove the obsolete ADMIN_PASSWORD bootstrap value from .env after the first administrator exists, or replace it with a different private bootstrap password. It is only used when no administrator exists. Do not share credentials here.
4. Generate a private JWT secret locally:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Put that output in JWT_SECRET in the private .env. Do not paste it into chat or commit it. Restarting with a new secret signs everyone out.

5. Choose a host that runs Node.js continuously and provides persistent storage. Keep DATABASE_PATH outside public asset directories. Run one app instance for this SQLite setup; do not use an ephemeral/serverless filesystem or share the database over a network filesystem.
6. Configure a real HTTPS domain and a reverse proxy. Set NODE_ENV=production and APP_ORIGIN to the exact HTTPS origin, with no path or trailing slash. Keep HOST=127.0.0.1 when the proxy is on the same machine. Set TRUST_PROXY=loopback only for that trusted same-machine proxy arrangement; other hosting arrangements need review rather than trusting all forwarded headers.
7. Serve the application through backend/server.js. Do not upload the whole project folder to a public static web directory: .env, database files, backups, and old Workflow.js must remain private.
8. Run npm.cmd run check:launch, npm.cmd test, and npm.cmd audit --omit=dev. Resolve every blocking issue. Review warnings too: starter recipe conversions require shop measurements; out-of-stock ingredients correctly block affected orders.
9. Configure protected off-machine backups, test recovery, and verify process restart after machine/server restart. Neither hosting nor an automatic restart/backup service has been configured for you.
10. Perform an end-to-end acceptance check on a separate test database: customer sign-up/login, all product options, order placement and retry, stock deduction, eligible cancellation, in-store order completion, reports/CSV, feedback, account updates, and recovery. Do not generate test payments or orders in the live shop database.
11. Check both a phone and the admin desktop layout, plus slow/offline behavior. Confirm the health endpoint at /api/health and monitor server errors and available disk space.

GCash is MANUAL: staff must verify the actual transfer before marking it verified. A reference number alone is not proof. Refunds require a separate staff action in GCash. No payment-provider automatic verification has been installed.

Email address ownership verification and automatic recovery email delivery are not enabled. Add a transactional email service if these are launch requirements. Review the shop's privacy/retention policies before collecting real customer data.

Production validation prevents obvious unsafe configuration; it cannot prove that your hosting, domain, reverse proxy, privacy practices, and backups are correctly operated.

References: [Express production security](https://expressjs.com/en/advanced/best-practice-security/), [SQLite online backup](https://www.sqlite.org/backup.html).

# Email verification

New customers must verify their email before they can log in:

1. The customer signs up.
2. The system emails a 6-digit code and opens the **Verify your email** page (`verify.html`).
3. The customer types the code. A correct code verifies the email and signs them in.

Rules:
- A code expires after **10 minutes**.
- After **5 wrong codes**, the customer must request a new one.
- **Resend code** works once every **60 seconds**, up to **5 emails per hour**.
- If someone logs in before verifying, they are sent back to the verify page.
- An unverified sign-up can be done again with the same email (for example, after a typo in the password). Once an email is verified, nobody else can sign up with it.
- Existing accounts, and accounts the administrator creates in Users, do not need verification.
- Codes are stored only as a hash.

## Running on your computer without email

If no email is set up, the code is **printed in the server window** (the terminal running `npm start`):

```
[Email not configured: development only, nothing was sent]
To: juan@example.com
Subject: Your Kopi; Calamba verification code: 123456
```

## Sending real emails from Gmail

1. Use the Gmail account the shop will send from.
2. Turn on 2-Step Verification: Google Account → **Security** → **2-Step Verification**.
3. Create an App password at https://myaccount.google.com/apppasswords. Name it "Kopi", click **Create**, and copy the 16-letter password.
4. Add these lines to `backend/.env` (never commit this file):

   ```
   SMTP_USER=yourshop@gmail.com
   SMTP_PASS=abcd efgh ijkl mnop
   ```

5. Restart the server. It should say: `Email verification: ON. Codes are emailed through Gmail (SMTP).`

If the server window says *"Gmail refused the login"*, `SMTP_PASS` is not a valid App password. Your normal Gmail password does not work here.

Emails sometimes land in **Spam** or **Promotions**. The verify page reminds customers to check those folders.

## Hosting later (Render)

Render's free plan blocks SMTP, so Gmail sending will not work there. Use Brevo instead: set `BREVO_API_KEY` and `MAIL_FROM` (a sender address verified in Brevo). If no email is set up in production, verification is turned **off** so sign-ups keep working, and `npm run check:launch` shows a warning.

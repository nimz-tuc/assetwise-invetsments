# AssetWise Investments

## Run it
1. `cd backend` then `npm install` (adds jsonwebtoken to the backend; root package.json is no longer needed).
2. Keep your existing `backend/.env` and add the new lines from `backend/.env.example`.
3. The database upgrades itself when the server starts (or run `npm run migrate`). It sets packages to 5 / 10 / 20 days.
4. Register an account on the site, then make it an admin: `npm run make-admin -- you@example.com`
5. `npm start` and open **http://localhost:5000** (the server serves the website itself).

## How money moves (all real, nothing simulated)
- **Deposit**: customer sends USDT to your address and submits the transaction hash. It stays *pending* until an admin confirms it (Admin > Deposits & Withdrawals). The same code can never be credited twice. The Daraja callback will call the same `confirmDeposit()` in `backend/services/ledger.js`.
- **Withdraw**: amount is taken from the wallet immediately and held. Admin marks it paid, or rejects it and the money returns to the wallet.
- **Invest**: debits the wallet, locks the package terms. When the term ends the server pays principal + return into the wallet automatically (checked every minute).
- **Customer care**: customers write in Support; admins reply in Admin > Customer Care; replies show in the customer's chat within seconds and on the bell.
- Admin actions are recorded in the `audit_log` table.

## Paystack (online card deposits, USD)
1. In `backend/.env` set `PAYSTACK_SECRET_KEY` (start with the `sk_test_...` key) and `PUBLIC_URL`.
2. In the Paystack dashboard (Settings > API Keys & Webhooks) set the **Webhook URL** to `https://YOUR-DOMAIN/api/webhooks/paystack`. It must be public https; for local testing use a tunnel such as ngrok and put its address in `PUBLIC_URL` too.
3. Deposit > **Pay online**: the customer is sent to Paystack, pays by card, and returns to the site. The wallet is credited only after the server asks Paystack to confirm the payment (amount and currency checked), exactly once, even if the webhook and the return page arrive together.
4. Admin > Deposits & Withdrawals: a "Confirm" on an online payment re-checks with Paystack, so an admin cannot credit an unpaid one by accident.
5. To go live: activate your Paystack account, replace the key with `sk_live_...`, and test with a small amount first.
Withdrawals are still paid out by an admin (Mark paid). Paystack payouts can be added later.

## Opening the site on a phone / other devices
You only need **one** tunnel, to port 5000 (the server serves both the website and the API). Don't use VS Code Live Server for this.
1. Start the server: `cd backend` then `node server.js`.
2. Start a tunnel in a second window, for example:
   - Cloudflare (no sign-up, no warning page): `cloudflared tunnel --url http://localhost:5000`
   - or ngrok: `ngrok http 5000`
3. Open the https address the tunnel prints, on any phone or computer.
Same Wi-Fi only? You can skip the tunnel and open `http://YOUR-PC-IP:5000` (find the IP with `ipconfig`); allow port 5000 in Windows Firewall if asked.
Leave `PUBLIC_URL` blank while testing: Paystack then returns the customer to whatever address they opened. Set it once you have a real domain.

## Changing packages
Admin > Packages (minimum, maximum, days, return %, active). Existing investments keep the terms they were bought on.

## Before taking real customers' money
This is working software, but you also need the legal side: licensing/registration for taking investments, KYC/AML, terms of service, and an independent security review. Returns of 10-15% in 5-20 days are far above normal market returns; regulators and customers will treat "guaranteed" language very seriously, so the app calls them "expected returns".

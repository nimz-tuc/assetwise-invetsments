# AssetWise Investments

## Run it
1. `cd backend` then `npm install` (adds jsonwebtoken to the backend; root package.json is no longer needed).
2. Keep your existing `backend/.env` and add the new lines from `backend/.env.example`.
3. The database upgrades itself when the server starts (or run `npm run migrate`). It sets packages to 5 / 10 / 20 days.
4. Register an account on the site, then make it an admin: `npm run make-admin -- you@example.com`
5. `npm start` and open **http://localhost:5000** (the server serves the website itself).

## How money moves (all real, nothing simulated)
- **Deposit (USDT only)**: the customer opens Deposit and taps *Contact customer care for the deposit address*. An admin replies in Admin > Customer Care with the address. After sending, the customer submits the amount and transaction hash; it stays *pending* until an admin confirms it on the blockchain (Admin > Deposits & Withdrawals). Admins can **Edit** a pending deposit (e.g. correct the amount to what was really received; a reason is required and logged) and then Confirm. Completed transactions cannot be edited, and the wallet is only credited by confirming a deposit. The same hash can never be credited twice.
- **Withdraw**: amount is taken from the wallet immediately and held. Admin marks it paid, or rejects it and the money returns to the wallet.
- **Invest**: debits the wallet, locks the package terms. When the term ends the server pays principal + return into the wallet automatically (checked every minute).
- **Customer care**: customers write in Support; admins reply in Admin > Customer Care; replies show in the customer's chat within seconds and on the bell.
- Admin actions are recorded in the `audit_log` table.

## Opening the site on a phone / other devices
You only need **one** tunnel, to port 5000 (the server serves both the website and the API). Don't use VS Code Live Server for this.
1. Start the server: `cd backend` then `node server.js`.
2. Start a tunnel in a second window, for example:
   - Cloudflare (no sign-up, no warning page): `cloudflared tunnel --url http://localhost:5000`
   - or ngrok: `ngrok http 5000`
3. Open the https address the tunnel prints, on any phone or computer.
Same Wi-Fi only? You can skip the tunnel and open `http://YOUR-PC-IP:5000` (find the IP with `ipconfig`); allow port 5000 in Windows Firewall if asked.

## Changing packages
Admin > Packages (minimum, maximum, days, return %, active). Existing investments keep the terms they were bought on.

## Before taking real customers' money
This is working software, but you also need the legal side: licensing/registration for taking investments, KYC/AML, terms of service, and an independent security review. Returns of 10-15% in 5-20 days are far above normal market returns; regulators and customers will treat "guaranteed" language very seriously, so the app calls them "expected returns".

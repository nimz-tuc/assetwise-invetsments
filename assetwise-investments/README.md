# AssetWise Investments

## Run it
1. `cd backend` then `npm install` (adds jsonwebtoken to the backend; root package.json is no longer needed).
2. Keep your existing `backend/.env` and configure the required database and JWT settings there.
3. The database upgrades itself when the server starts (or run `npm run migrate`). It sets packages to 5 / 10 / 20 days.
4. Register an account on the site, then make it an admin: `npm run make-admin -- you@example.com`
5. `npm start` and open **http://localhost:5000** (the server serves the website itself).

## How money moves (all real, nothing simulated)
- **Deposit**: customers choose USDT (TRC20) or USDC (ERC20) and are redirected to Customer Care to request the correct wallet address. After sending crypto, they submit the amount and transaction hash. Deposits stay *pending* until an admin confirms them (Admin > Deposits & Withdrawals); admins can edit pending crypto deposit details before confirming. A transaction hash cannot be credited twice.
- **Withdraw**: amount is taken from the wallet immediately and held. While pending, an admin can edit its amount, method, payout reference, and destination; amount changes are reconciled against the wallet. Admin marks it paid, or rejects it and the reserved amount returns to the wallet.
- **Admin wallet credits**: an admin can add funds to a customer's wallet from Admin > Customers. Each credit is recorded as a transaction and in the audit log.
- **Invest**: debits the wallet, locks the package terms. When the term ends the server pays principal + return into the wallet automatically (checked every minute).
- **Customer care**: customers write in Support; admins reply in Admin > Customer Care; replies show in the customer's chat within seconds and on the bell.
- Admin actions are recorded in the `audit_log` table.

## Crypto
Deposits and withdrawals support USDT (TRC20) and USDC (ERC20). Deposit customers request addresses through Customer Care; provide the correct address and network instructions in the reply. Verify the destination network for all transfers.

## Opening the site on a phone / other devices
You only need **one** tunnel, to port 5000 (the server serves both the website and the API). Don't use VS Code Live Server for this.
1. Start the server: `cd backend` then `node server.js`.
2. Start a tunnel in a second window, for example:
   - Cloudflare (no sign-up, no warning page): `cloudflared tunnel --url http://localhost:5000`
   - or ngrok: `ngrok http 5000`
3. Open the https address the tunnel prints, on any phone or computer.
Same Wi-Fi only? You can skip the tunnel and open `http://YOUR-PC-IP:5000` (find the IP with `ipconfig`); allow port 5000 in Windows Firewall if asked.
Set `PUBLIC_URL` to your public https domain when deploying.

## Changing packages
Admin > Packages (minimum, maximum, days, return %, active). Existing investments keep the terms they were bought on.

## Before taking real customers' money
This is working software, but you also need the legal side: licensing/registration for taking investments, KYC/AML, terms of service, and an independent security review. Returns of 10-15% in 5-20 days are far above normal market returns; regulators and customers will treat "guaranteed" language very seriously, so the app calls them "expected returns".

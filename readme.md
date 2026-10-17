# Discord Apirone Litecoin Middleman Bot

Advanced non-custodial Discord trade workflow using Apirone Litecoin invoices, PostgreSQL, and Railway.

## Commands

- `/ltc-create seller amount item`
- `/ltc-info id`
- `/ltc-release id`
- `/ltc-dispute id reason`
- `/ltc-cancel id`

## Setup

1. Deploy the project to Railway.
2. Add a Railway PostgreSQL service.
3. Add all values from `.env.example`.
4. Deploy and copy the Railway public domain.
5. Set `PUBLIC_BASE_URL` to that domain, with no trailing slash.
6. In Apirone, configure the webhook/callback URL as:

```text
https://YOUR-RAILWAY-DOMAIN.up.railway.app/webhooks/apirone
```

7. Configure the same webhook secret in Apirone and Railway.
8. Confirm the Apirone API endpoint and invoice request format for your account. Apirone may require an API key or account-specific authentication.

## Security

This bot is non-custodial. It never requests seed phrases or private keys, and it cannot reverse Litecoin transactions. Keep Discord tokens, database URLs, API keys, and webhook secrets private.

## Railway variables

```env
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_application_id
DISCORD_GUILD_ID=your_discord_server_id
DATABASE_URL=${{Postgres.DATABASE_URL}}
PORT=3000
STAFF_ROLE_ID=your_staff_role_id
PUBLIC_BASE_URL=https://your-railway-domain.up.railway.app
APIRONE_API_URL=https://api.apirone.com/v2
APIRONE_API_KEY=your_apirone_key_if_required
APIRONE_WEBHOOK_SECRET=long_random_secret
APIRONE_CURRENCY=LTC
INVOICE_LIFETIME_SECONDS=3600
MIN_ACCOUNT_AGE_DAYS=7
```

The integration deliberately does not include wallet private keys or seed phrases.

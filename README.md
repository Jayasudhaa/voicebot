# Vapi Restaurant Starter (Vercel)

Serverless endpoints for Vapi tools:

- `GET /api/menu` → returns a simple menu JSON
- `POST /api/place_order` → prices items, logs an order, and (optionally) sends an SMS receipt via Twilio

## Deploy

1. Create a new GitHub repo with these files (or upload the ZIP).
2. Import into Vercel → Deploy.
3. (Optional) In Vercel → Settings → Environment Variables:
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_SMS_FROM` (e.g., `+18885551234`, Toll-Free verified or A2P 10DLC)

Endpoints will be available at:
- `https://YOUR-APP.vercel.app/api/menu`
- `https://YOUR-APP.vercel.app/api/place_order`

## Using with Vapi

- Add a tool **get_menu** → GET → URL `/api/menu` → empty schema.
- Add a tool **place_order** → POST → URL `/api/place_order` → use the JSON schema from ChatGPT.
- Paste a system prompt instructing the agent to collect items, confirm, then call `place_order`.

## Notes

- This starter logs orders to the function logs. Add a DB later (DynamoDB, Postgres).
- SMS is optional and only sent if Twilio env vars are configured and the number is verified.

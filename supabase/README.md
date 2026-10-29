# Solana bot engine

The panel calls the `solana-bot-engine` Supabase Edge Function. It uses Jupiter Swap API V2 on Solana Mainnet Beta. The service is isolated in `solana_bot_*` database objects; the existing booking app tables are untouched.

## Required server secrets

Add these values in Supabase Dashboard → Edge Functions → Secrets. Never commit them or enter them into the public source code.

- `BOT_CONTROL_TOKEN`: a long random control token. Enter this in the panel after deployment; the page keeps it only for the current tab session.
- `SOLANA_BOT_KEYPAIR`: a dedicated Solana bot wallet keypair, encoded as a base58 secret key or a JSON array of 64 bytes. The Edge Function uses it to sign only when a confirmed trade or enabled automatic exit is requested.
- `JUPITER_API_KEY` is optional for low-volume use; Jupiter supports keyless requests at a lower rate. Keep it server-side if added.

The configured limits start at `0.05 SOL` per buy and `0.10 SOL` total buys per UTC day. Trading and automatic exits both start disabled. Stop-loss, take-profit, and trailing exits are per-position and remain unset until configured.

Fund only the dedicated bot wallet address shown by the panel. The function does not return or log its private key.


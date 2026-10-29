# Solana bot engine

The panel calls the `solana-bot-engine` Supabase Edge Function. It uses Jupiter Swap API V2 on Solana Mainnet Beta. The service is isolated in `solana_bot_*` database objects; the existing booking app tables are untouched.

## Required server secrets

Use **Utwórz portfel i pobierz klucz (.txt)** on the public panel to create a dedicated wallet in the browser and download `solana-bot-wallet-secrets.txt`. The file contains the wallet address, private key, and control token. The private key is generated locally and is not sent to the panel backend. Add only the two secret values below in Supabase Dashboard → Edge Functions → Secrets; never commit or send the file to anyone.

- `BOT_CONTROL_TOKEN`: the control token from the downloaded file. Enter the same value in the panel to connect.
- `SOLANA_BOT_KEYPAIR`: a dedicated Solana bot wallet keypair, encoded as a base58 secret key or a JSON array of 64 bytes. The Edge Function uses it to sign only when a confirmed trade or enabled automatic exit is requested.
- `JUPITER_API_KEY` is optional for low-volume use; Jupiter supports keyless requests at a lower rate. Keep it server-side if added.

The configured limits start at `0.05 SOL` per buy and `0.10 SOL` total buys per UTC day. Trading and automatic exits both start disabled. Stop-loss, take-profit, and trailing exits are per-position and remain unset until configured.

Fund only the dedicated bot wallet address shown by the panel. The function does not return or log its private key.


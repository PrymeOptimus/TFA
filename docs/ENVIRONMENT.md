# Environment Variables

Full list also lives in `.env.example` (copy it to `.env` for local dev).

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string (use a pooled connection in serverless deployments). |
| `NEXTAUTH_URL` | ✅ | Public base URL of the app (e.g. `http://localhost:3000` or `https://hearth.example.com`). |
| `NEXTAUTH_SECRET` | ✅ | Random 32+ byte secret for session/JWT signing. `openssl rand -base64 32`. |
| `GOOGLE_CLIENT_ID` | ✅ | Google OAuth client ID (login + Calendar API). |
| `GOOGLE_CLIENT_SECRET` | ✅ | Google OAuth client secret. |
| `TOKEN_ENCRYPTION_KEY` | ✅ | Base64, must decode to exactly 32 bytes. Encrypts stored Calendar OAuth tokens. `openssl rand -base64 32`. |
| `WEATHER_PROVIDER` | ✅ | Currently only `openweathermap` is implemented. |
| `OPENWEATHER_API_KEY` | ✅ (if weather enabled) | OpenWeatherMap API key — needs a plan covering the One Call API 3.0 endpoint. |
| `STORAGE_DRIVER` | ✅ | `local` (dev default), `supabase`, or `s3`. Only `local` is implemented out of the box — see `docs/DEPLOYMENT.md` §5. |
| `SUPABASE_URL` | if `STORAGE_DRIVER=supabase` | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | if `STORAGE_DRIVER=supabase` | Service role key (server-only, never expose to the client). |
| `SUPABASE_STORAGE_BUCKET` | if `STORAGE_DRIVER=supabase` | Bucket name for photo uploads. |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | if `STORAGE_DRIVER=s3` | Standard S3-compatible object storage credentials. |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` / `MICROSOFT_TENANT_ID` | Phase 3 | Reserved for Outlook Calendar integration — not yet wired up. |
| `RATE_LIMIT_MAX` | optional | Requests per window before a 429 (default `60`). |
| `RATE_LIMIT_WINDOW_MS` | optional | Rate-limit window in ms (default `60000`). |
| `NEXT_PUBLIC_APP_URL` | ✅ | Public app URL, exposed to the client (used for building shareable display links, etc.). |
| `CRON_SECRET` | ✅ | Bearer token required by `/api/cron/sync`. `openssl rand -hex 24`. |

Anything prefixed `NEXT_PUBLIC_` is bundled into client JavaScript — never put
a secret behind that prefix. Every other variable here is server-only.

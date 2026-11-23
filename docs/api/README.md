# API endpoints

One page per serverless function in `api/`. All of them need a signed-in user (a Supabase access token in `Authorization: Bearer …`), except the Stripe webhook, which Stripe calls with a signed body. Shared request helpers are described in [../modules/server-http.md](../modules/server-http.md).

| endpoint | guide |
|---|---|
| `POST /api/ask` | [ask.md](ask.md) |
| `GET/POST /api/insights` | [insights.md](insights.md) |
| `POST /api/tools` | [tools.md](tools.md) |
| `POST /api/across` | [across.md](across.md) |
| `POST /api/billing` | [billing.md](billing.md) |

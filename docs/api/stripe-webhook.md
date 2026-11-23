# `POST /api/stripe-webhook`

Source: `api/stripe-webhook.js`. Called by Stripe only. Event handling is `handleEvent` in `server/billing/service.js`.

## Checks, in order
| check | answer |
|---|---|
| method is not `POST` | `405 method_not_allowed` |
| `STRIPE_WEBHOOK_SECRET` or `STRIPE_SECRET_KEY` missing | `503 billing_not_configured` |
| no `Stripe-Signature` header | `400 missing_signature` |
| body larger than 512 KB | rejected as too large (counted as an invalid signature) |
| signature does not verify | `400 invalid_signature` (logged as `webhook_rejected`, reason only) |
| handler throws | `500 processing_failed` (logged with the event id, type and error kind) |
| otherwise | the status and body returned by `handleEvent` |

## Why the body is read by hand
The signature covers the exact bytes Stripe sent. `req.body` is never touched: on Vercel it is a getter that parses the JSON and loses those bytes. The handler reads the stream into a buffer instead, with a 512 KB cap.

## Verification
`constructEventAsync` is used (not the sync version) so it also runs where only Web Crypto exists, such as Workers. The default tolerance of 5 minutes applies, so a captured request cannot be replayed later.

Nothing is read from the event until the signature has verified; unsigned, badly signed, stale or other-mode events change nothing.

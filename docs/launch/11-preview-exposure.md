# Preview exposure audit and Deployment Protection (read-only audit, 2026-10-13)

Nothing was changed in Vercel. The setting below is project-level and yours to switch.

## What is publicly reachable today

| Item | Finding |
|---|---|
| Deployment Protection (`vercel project protection sparkscribe`) | **Vercel Authentication off** (`ssoProtection: null`); Git fork protection on |
| Deployments | 40 for `sparkscribe` (every branch push), plus 2 old ones under the former `neuralscribe` name. **All open to anyone with the URL** |
| Search engines | Previews send `X-Robots-Tag: noindex` (Vercel); production has none |
| Source code / source maps | no source maps published; the "view source" page (`/_src`) requires a Vercel login |
| Old `neuralscribe` deployments (`…-ap6jzx53e`, `…-i1lgx22wj`, 2026-10-07) | their build **source** contains a private test recording (uploaded by the CLI before `.vercelignore` existed). It is **not served** (`/accuracy/testset/private/meeting5.m4a` → 404) and the source view needs a Vercel login, but the deployments still exist |
| Older Preview builds | still run their older code, including bugs fixed since (e.g. the open redirect on sign-in) |
| Data | every Preview uses the **production Supabase project**: sign-up on a Preview creates a real (unconfirmed) production account; saved data goes to production |
| What a stranger can do on the `prelaunch/dev` Preview | use the app on their device; create an unconfirmed account (can't sign in: confirmation emails don't reach non-team addresses yet); nothing else. AI needs a confirmed account; payments are off on the server; account deletion is hidden; the database only shows each account its own rows |
| Automation bypass secret | one exists (created earlier). Harmless while protection is off; once protection is on, anyone holding it can skip protection. Rotate it when enabling |

## Turn on protection (you, about 2 minutes)

1. vercel.com → team **moerizz** → project **sparkscribe** → **Settings** → **Deployment Protection**.
2. **Vercel Authentication** → **Enabled** → scope **Standard Protection** → **Save**.
   - Protected: every Preview and every deployment URL, which now asks for a Vercel login (you and your team).
   - Stays public: the production domain `sparkscribe-moerizz.vercel.app` (and later `sparkscribe.ai`).
3. Same page → **Protection Bypass for Automation** → regenerate (or delete) the existing secret.
   Stripe test-mode webhooks to a Preview will need a bypass secret later; create a fresh one then.
4. Optional, if you want someone outside the team to test: use a Preview's **Share** button (a time-limited
   link) rather than turning protection off.

CLI equivalent (from this repo, logged in as the owner):

```bash
vercel project protection enable sparkscribe --sso
```

Check afterwards: `curl -I https://sparkscribe-git-prelaunch-dev-moerizz.vercel.app/` should answer **401** (or redirect to
Vercel login); `curl -I https://sparkscribe-moerizz.vercel.app/` should still answer **200**.

Effect on testing: email links in sign-up/reset emails that point at a Preview will first ask for your Vercel login, which
is fine for you. Supabase and the app's server are unaffected (the server never fetches its own Preview URL).

## Optional clean-up (destructive: needs your explicit approval)

- Delete the two old `neuralscribe` deployments that carry the private recording in their source:

  ```bash
  vercel remove dpl_A3dYbxVpPJmPVKSVSEHEeCQg91th dpl_3ucvd34pwnb5p4osLMF2PpwZPXBH
  ```

  (A deployment can't be restored once removed.)
- Delete old Preview deployments you don't need: Vercel → Deployments → filter Preview → "…" → Delete.

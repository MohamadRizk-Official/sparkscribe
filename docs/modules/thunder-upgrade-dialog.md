# Thunder upgrade dialog (`src/electric/thunder.js`)

Thunder is the top plan. Asking across recordings and combined study guides are Thunder features (`billing_plans.features`); the server refuses them for other plans ([entitlements.md](entitlements.md)). This module is the browser side of that refusal: instead of an error, a person on another plan sees what the feature does, with an example, and a way to the Pricing page. It is shared by Ask, the Library and `/across`. Browser only, so no unit test.

## Exports
| export | what it does |
|---|---|
| `thunderMark(label = 'Thunder')` | HTML for the mark: a violet bolt and the plan name. On hover or focus of the control that holds it, a short current (`.tm-arc`) runs through. The SVG is `aria-hidden` |
| `thunderPricingUrl(back)` | `/pricing?highlight=thunder`, plus `&next=<encoded back>` when `back` is given. Pricing highlights Thunder and, after upgrading, returns the student to where they wanted to go (kept in `sessionStorage` as `afterUpgrade`) |
| `openThunderDialog({ feature, back, planName })` | opens the dialog and returns it |

## `openThunderDialog`
- `feature` is `'ask'` or `'guide'`; any other value uses the `ask` copy. Each has a title, a sentence about what it does (up to 12 recordings for Ask, up to 10 for guides, matching `ASK_MAX_RECORDINGS` and `GUIDE_MAX_RECORDINGS`), and a made-up example labelled **Example** so nobody mistakes it for their own data.
- `back` defaults to the current path and query string; it becomes the `next` parameter of the pricing link.
- `planName`, when given, adds "You're on <plan>." to "Available with Thunder."
- The dialog always says "Everything you've saved stays on every plan": saved answers and guides remain readable and deletable after a downgrade.
- Buttons: **Not now** (dismisses) and **Explore Thunder** (a link to the pricing URL). Focus starts on the call to action.
- The dialog itself is built by `makeDialog('thunder-dlg', …)` from `src/library/dialogs.js`.

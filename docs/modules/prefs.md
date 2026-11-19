# Preferences (`src/lib/prefs.js`)

Display preferences from Settings → Preferences: the mascot and Appearance. Covered by `tests/prefs-test.mjs`.

## Values
- Mascot (`MASCOT_MODES`): `on` (default), `quiet`, `off`. Stored in `localStorage` under `sparkscribe.mascot`.
- Appearance: the modes and key come from `src/lib/theme.js` (`THEME_MODES`, `THEME_KEY`).
- `getMascotPref()` returns `on` for a missing or invalid stored value, and when storage throws.

## Saving
- `setMascotPref(v)` and `setThemePref(v)` ignore values that are not in their mode list.
- Both write to `localStorage` first (private mode: a failed write only affects this page).
- `setMascotPref` dispatches a `sparkscribe:mascot-pref` event with the new value; `setThemePref` calls `applyTheme`.
- When signed in (and Supabase is configured) the value is also stored in the account's auth user metadata under
  `sparkscribe_mascot` / `sparkscribe_theme`, so it follows the person to other browsers. No table or schema is
  involved. The update is skipped if the account already holds that value, and a failed sync leaves the local value.
- `{ sync: false }` skips the account write.

## Following the account
`adoptAccountPrefs(user)`: if the account holds a valid value that differs from this browser's, the account wins and
is applied locally with `sync: false` (so it does not write back). Invalid account values are ignored.

These are display preferences only: nothing private and nothing billing-related.

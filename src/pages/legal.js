// Privacy Policy and Terms pages: static text (generated from docs/launch by scripts/build-legal.mjs) plus the account menu.
import { mountAccountMenu } from '../lib/account.js';
import { isConfigured } from '../lib/supabase.js';

if (isConfigured) mountAccountMenu(document.getElementById('accountSlot'));

// Privacy Policy and Terms pages: static text (generated from docs/launch by scripts/build-legal.mjs) plus the account menu.
import { mountAccountMenu } from '../lib/account.js';

mountAccountMenu(document.getElementById('accountSlot')); // theme switch always; the account menu when accounts are configured

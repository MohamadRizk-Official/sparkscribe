// Applies the SparkScribe auth email templates (docs/auth/email-templates, from scripts/build-email-templates.mjs) to the
// Supabase project through the Management API. Run it yourself with your own access token; it never leaves your machine.
//
//   $env:SUPABASE_ACCESS_TOKEN = "<token from supabase.com/dashboard/account/tokens>"   (PowerShell; bash: export …)
//   node scripts/apply-email-templates.mjs            # dry run: shows the current state and what would change
//   node scripts/apply-email-templates.mjs --apply    # backs up the current templates, then applies
//   node scripts/apply-email-templates.mjs --restore <backup.json>   # puts a backup back
//
// It changes only email subjects, template HTML and the three security-notification switches. It never reads, prints or
// writes SMTP passwords or any other secret (only non-secret SMTP fields are shown, to confirm the sender).
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEMPLATES } from './build-email-templates.mjs';

const REF = 'strkrrdndoofpcenopxk';
const API = `https://api.supabase.com/v1/projects/${REF}/config/auth`;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { console.error('Set SUPABASE_ACCESS_TOKEN first (see the top of this file).'); process.exit(1); }
const HERE = dirname(fileURLToPath(import.meta.url));

// our file name -> Supabase config keys
const MAP = {
  'confirm-signup': ['mailer_subjects_confirmation', 'mailer_templates_confirmation_content'],
  'reset-password': ['mailer_subjects_recovery', 'mailer_templates_recovery_content'],
  'magic-link': ['mailer_subjects_magic_link', 'mailer_templates_magic_link_content'],
  'change-email': ['mailer_subjects_email_change', 'mailer_templates_email_change_content'],
  invite: ['mailer_subjects_invite', 'mailer_templates_invite_content'],
  reauthentication: ['mailer_subjects_reauthentication', 'mailer_templates_reauthentication_content'],
  'password-changed': ['mailer_subjects_password_changed_notification', 'mailer_templates_password_changed_notification_content', 'mailer_notifications_password_changed_enabled'],
  'email-changed': ['mailer_subjects_email_changed_notification', 'mailer_templates_email_changed_notification_content', 'mailer_notifications_email_changed_enabled'],
  'identity-linked': ['mailer_subjects_identity_linked_notification', 'mailer_templates_identity_linked_notification_content', 'mailer_notifications_identity_linked_enabled'],
};
const KEYS = Object.values(MAP).flat();

async function api(method, body) {
  const r = await fetch(API, { method, headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${method} ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}
const pick = (cfg) => Object.fromEntries(KEYS.map((k) => [k, cfg[k] ?? null]));

const cfg = await api('GET');
console.log('Project', REF);
console.log('Site URL:', cfg.site_url);
console.log('Custom SMTP:', cfg.smtp_host ? `on — ${cfg.smtp_sender_name || '(no name)'} <${cfg.smtp_admin_email}> via ${cfg.smtp_host}:${cfg.smtp_port} as ${cfg.smtp_user}` : 'OFF (Supabase built-in mailer)');
console.log('Email rate limit per hour:', cfg.rate_limit_email_sent);
console.log('Email OTP / link lifetime (s):', cfg.mailer_otp_exp);
console.log('CAPTCHA:', cfg.security_captcha_enabled ? `on (${cfg.security_captcha_provider})` : 'off');

const arg = process.argv[2];
if (arg === '--restore') {
  const backup = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  await api('PATCH', pick(backup));
  console.log('Restored from', process.argv[3]);
  process.exit(0);
}

const want = {};
for (const [name, [subjectKey, htmlKey, enableKey]] of Object.entries(MAP)) {
  want[subjectKey] = TEMPLATES[name].subject;
  want[htmlKey] = TEMPLATES[name].html;
  if (enableKey) want[enableKey] = true;
}
console.log('\nPlanned changes:');
for (const [name, [subjectKey, htmlKey, enableKey]] of Object.entries(MAP)) {
  const same = cfg[subjectKey] === want[subjectKey] && cfg[htmlKey] === want[htmlKey] && (!enableKey || cfg[enableKey] === true);
  console.log(`  ${same ? '=' : '~'} ${name.padEnd(17)} "${want[subjectKey]}"${enableKey ? ` (notification ${cfg[enableKey] ? 'on' : 'off → on'})` : ''}`);
}
for (const [name, t] of Object.entries(TEMPLATES)) {
  if (!/{{ \.(TokenHash|Token|Email) }}|auth\?mode=forgot/.test(t.html)) throw new Error(`${name}: no Supabase variable/link found`);
}
if (arg !== '--apply') { console.log('\nDry run. Add --apply to apply.'); process.exit(0); }

const file = resolve(HERE, `../qa/out/supabase-email-templates-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
try { writeFileSync(file, JSON.stringify(pick(cfg), null, 2)); } catch { writeFileSync(file.replace(/.*[\\/]/, ''), JSON.stringify(pick(cfg), null, 2)); }
console.log('\nBackup of the current templates:', file);
await api('PATCH', want);
const after = pick(await api('GET'));
const bad = Object.keys(want).filter((k) => after[k] !== want[k]);
console.log(bad.length ? `Applied, but these differ when read back: ${bad.join(', ')}` : 'Applied and read back: all 9 templates, subjects and notification switches match.');

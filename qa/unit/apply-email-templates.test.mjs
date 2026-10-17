// Runs scripts/apply-email-templates.mjs against a local stand-in for the Supabase Management API:
// dry run changes nothing; --apply sends only template/subject/notification keys, keeps a backup without secrets,
// reads back; --restore puts the backup back. Never prints the SMTP password.   node qa/unit/apply-email-templates.test.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SECRET = 'smtp-password-that-must-never-appear';
let cfg = { site_url: 'https://www.spark-scribe.com', smtp_host: 'smtp.resend.com', smtp_port: '465', smtp_user: 'resend', smtp_pass: SECRET, smtp_admin_email: 'no-reply@spark-scribe.com', smtp_sender_name: 'SparkScribe', rate_limit_email_sent: 30, mailer_otp_exp: 3600, security_captcha_enabled: false, mailer_subjects_recovery: 'Reset Your Password', mailer_templates_recovery_content: '<h2>Reset Password</h2><a href="{{ .ConfirmationURL }}">Reset</a>' };
const patches = [];
const server = http.createServer((req, res) => {
  assert.equal(req.headers.authorization, 'Bearer test-token');
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.method === 'PATCH') { const b = JSON.parse(body); patches.push(b); cfg = { ...cfg, ...b }; }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(cfg));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const env = { ...process.env, SUPABASE_ACCESS_TOKEN: 'test-token', SUPABASE_API_BASE: `http://127.0.0.1:${server.address().port}` };
const run = (...args) => new Promise((resolveRun, reject) => {
  import('node:child_process').then(({ execFile }) => execFile(process.execPath, ['scripts/apply-email-templates.mjs', ...args], { cwd: ROOT, env }, (e, out, err) => (e ? reject(new Error(err || e.message)) : resolveRun(out))));
});

const dry = await run();
assert.equal(patches.length, 0, 'dry run sends nothing');
assert.match(dry, /Custom SMTP: on — SparkScribe <no-reply@spark-scribe.com> via smtp\.resend\.com:465 as resend/);
assert.ok(!dry.includes(SECRET), 'dry run never prints the SMTP password');
console.log('ok - dry run: shows the sender, changes nothing, no secret printed');

const out = await run('--apply');
assert.equal(patches.length, 1);
const sent = patches[0];
assert.ok(Object.keys(sent).every((k) => /^mailer_(subjects|templates|notifications)_/.test(k)), `only template keys: ${Object.keys(sent).filter((k) => !/^mailer_/.test(k))}`);
assert.equal(Object.keys(sent).filter((k) => k.startsWith('mailer_templates_')).length, 9, 'nine templates');
assert.equal(sent.mailer_subjects_recovery, 'Reset your SparkScribe password');
assert.equal(sent.mailer_subjects_confirmation, 'Verify your email address — SparkScribe');
assert.match(sent.mailer_templates_recovery_content, /https:\/\/www\.spark-scribe\.com\/auth\/callback#token_hash=\{\{ \.TokenHash \}\}&amp;type=recovery/);
assert.match(sent.mailer_templates_confirmation_content, /#token_hash=\{\{ \.TokenHash \}\}&amp;type=email"/);
assert.match(sent.mailer_templates_reauthentication_content, /\{\{ \.Token \}\}/);
assert.ok(!/ConfirmationURL|supabase/i.test(Object.values(sent).filter((v) => typeof v === 'string').join('')), 'no Supabase link or branding');
assert.equal(sent.mailer_notifications_password_changed_enabled, true);
assert.match(out, /all 9 templates, subjects and notification switches match/);
assert.ok(!out.includes(SECRET), 'apply never prints the SMTP password');
const dir = resolve(ROOT, 'qa/out');
const backup = readdirSync(dir).filter((f) => f.startsWith('supabase-email-templates-backup-')).map((f) => resolve(dir, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
const saved = readFileSync(backup, 'utf8');
assert.ok(!saved.includes(SECRET) && !saved.includes('smtp_'), 'the backup holds no SMTP settings');
assert.equal(JSON.parse(saved).mailer_subjects_recovery, 'Reset Your Password', 'backup = the previous templates');
console.log('ok - apply: only the 9 templates, subjects and notification switches; read back; backup without secrets');

await run('--restore', backup);
assert.equal(cfg.mailer_subjects_recovery, 'Reset Your Password');
console.log('ok - restore puts the previous templates back');
server.close();

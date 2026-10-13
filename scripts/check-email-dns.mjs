// Read-only email DNS check for any domain: who answers for it, existing mail (MX/SPF/DMARC/Microsoft 365 DKIM), and
// whether the records SparkScribe's transactional email needs (Resend on <sub>.<domain>) are present. Changes nothing.
//   node scripts/check-email-dns.mjs <domain> [--sub auth]
// Exit code 0 when everything needed for sending auth emails is in place, 1 otherwise.
import { Resolver } from 'node:dns/promises';

const args = process.argv.slice(2);
const domain = (args.find((a) => !a.startsWith('--')) || '').toLowerCase().replace(/\.$/, '');
const sub = args.includes('--sub') ? args[args.indexOf('--sub') + 1] : 'auth';
if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) { console.error('usage: node scripts/check-email-dns.mjs <domain> [--sub auth]'); process.exit(2); }

const r = new Resolver(); r.setServers(['8.8.8.8', '1.1.1.1']);
const q = async (fn, name) => { try { return await r[fn](name); } catch (e) { return e.code === 'ENOTFOUND' || e.code === 'ENODATA' ? [] : { error: e.code }; } };
const txt = async (name) => { const v = await q('resolveTxt', name); return Array.isArray(v) ? v.map((p) => p.join('')) : []; };
const ok = (c) => (c ? 'OK  ' : 'MISSING');
// does this SPF record (or one it includes, up to 3 levels, as receivers evaluate it) include `target`?
async function spfReaches(record, target, depth = 0) {
  if (!record || depth > 3) return false;
  const incs = [...record.matchAll(/include:([^\s]+)/gi)].map((m) => m[1].toLowerCase());
  if (incs.includes(target)) return true;
  for (const inc of incs) {
    const sub = (await txt(inc)).find((t) => /^v=spf1/i.test(t));
    if (await spfReaches(sub, target, depth + 1)) return true;
  }
  return false;
}
const lines = [];
let ready = true;
const need = (cond, what, fix) => { lines.push(`${ok(cond)}  ${what}${cond ? '' : `\n          → ${fix}`}`); if (!cond) ready = false; };
const info = (what) => lines.push(`info  ${what}`);

const ns = await q('resolveNs', domain);
info(`nameservers: ${Array.isArray(ns) && ns.length ? ns.join(', ') : 'none (domain not delegated?)'}${Array.isArray(ns) && ns.some((n) => /domaincontrol\.com$/.test(n)) ? ' (GoDaddy DNS)' : ''}`);
const mx = await q('resolveMx', domain);
info(`MX: ${Array.isArray(mx) && mx.length ? mx.map((m) => `${m.exchange} (${m.priority})`).join(', ') : 'none'}`);
const m365 = Array.isArray(mx) && mx.some((m) => /mail\.protection\.outlook\.com$/.test(m.exchange));
const google = Array.isArray(mx) && mx.some((m) => /google(mail)?\.com$/.test(m.exchange));
const rootTxt = await txt(domain);
const spf = rootTxt.filter((t) => /^v=spf1\b/i.test(t));
const dmarc = (await txt(`_dmarc.${domain}`)).filter((t) => /^v=DMARC1/i.test(t));
info(`DMARC: ${dmarc[0] || 'none'}`);
const strict = dmarc[0] && /p=(reject|quarantine)/i.test(dmarc[0]);

lines.push('', '— company mail on the domain itself —');
if (m365 || google) {
  need(spf.length === 1 && await spfReaches(spf[0], m365 ? 'spf.protection.outlook.com' : '_spf.google.com'),
    `SPF at ${domain} authorises ${m365 ? 'Microsoft 365' : 'Google Workspace'}`,
    `add TXT @  "v=spf1 include:${m365 ? 'spf.protection.outlook.com' : '_spf.google.com'} -all"  (exactly one v=spf1 record)`);
  if (m365) {
    const s1 = await q('resolveCname', `selector1._domainkey.${domain}`), s2 = await q('resolveCname', `selector2._domainkey.${domain}`);
    need(Array.isArray(s1) && s1.length && Array.isArray(s2) && s2.length, 'Microsoft 365 DKIM (selector1/selector2 CNAMEs)', 'Microsoft Defender → Email authentication → DKIM: add the two CNAMEs it shows, then enable');
  }
  if (strict) info(`DMARC is ${/p=reject/i.test(dmarc[0]) ? 'reject' : 'quarantine'}: mail that fails SPF/DKIM alignment is ${/p=reject/i.test(dmarc[0]) ? 'refused' : 'spam-foldered'} by receivers`);
} else info('no Microsoft 365 / Google Workspace MX: skipping company-mail checks');
if (spf.length > 1) need(false, 'only one SPF record at the root', 'merge the v=spf1 records into one');

lines.push('', `— SparkScribe auth emails from ${sub}.${domain} (Resend) —`);
const bounceMx = await q('resolveMx', `send.${sub}.${domain}`);
need(Array.isArray(bounceMx) && bounceMx.some((m) => /amazonses\.com$/.test(m.exchange)), `MX send.${sub} → feedback-smtp.us-east-1.amazonses.com`, `add MX  host "send.${sub}"  value "feedback-smtp.us-east-1.amazonses.com"  priority 10`);
need((await txt(`send.${sub}.${domain}`)).some((t) => /^v=spf1 .*include:amazonses\.com/i.test(t)), `TXT send.${sub} (SPF for bounces)`, `add TXT  host "send.${sub}"  value "v=spf1 include:amazonses.com ~all"`);
need((await txt(`resend._domainkey.${sub}.${domain}`)).some((t) => /p=/.test(t)), `TXT resend._domainkey.${sub} (DKIM)`, `add TXT  host "resend._domainkey.${sub}"  value = the DKIM key Resend shows for ${sub}.${domain}`);
if (!dmarc.length) need(false, `DMARC at ${domain}`, `add TXT  host "_dmarc"  value "v=DMARC1; p=none; rua=mailto:dmarc@${domain}"`);

console.log(`Email DNS for ${domain} (read-only, via 8.8.8.8 / 1.1.1.1)\n`);
console.log(lines.join('\n'));
console.log(`\n${ready ? 'READY: DNS for company mail and auth emails is in place.' : 'NOT READY: add the MISSING records above (GoDaddy → DNS), then run this again.'}`);
process.exit(ready ? 0 : 1);

// Renders every redesigned email to a local HTML file so it can be
// inspected in a browser, and checks the rules the design promises.
//
//   npm run email:previews        -> writes email-previews/*.html
//
// Nothing is sent: the Resend SDK is replaced by a stub that records the
// message. Sample names/addresses below are fictional.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';

const sent = [];
vi.mock('resend', () => ({
  Resend: class {
    constructor() {
      this.emails = { send: async (msg) => { sent.push(msg); return { data: { id: 'preview' }, error: null }; } };
    }
  },
}));
vi.mock('../../src/app/firebase/adminApp', () => ({ adminDb: {}, adminAuth: {} }));

const OUT = join(process.cwd(), 'email-previews');
const WRITE = process.env.EMAIL_PREVIEWS === '1';

const ACTIVATE = 'https://premarket.homes/activate?t=SAMPLE-TOKEN-NOT-REAL';
const ACCEPT = 'https://premarket.homes/office-invite?token=SAMPLE-TOKEN-NOT-REAL';

// One page that shows every email, with phone/desktop and light/dark
// switches. Dark mode is previewed by turning the email's own
// prefers-color-scheme rules on; real inboxes that support dark mode do
// the same automatically.
function viewerHtml(rows) {
  const data = JSON.stringify(rows).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Premarket email previews</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#e2e8f0;color:#0f172a;display:flex;height:100vh}
nav{width:330px;background:#fff;border-right:1px solid #cbd5e1;overflow:auto;padding:18px 14px;flex-shrink:0}
nav h1{font-size:16px;margin:0 0 4px}nav p{font-size:12px;color:#64748b;margin:0 0 14px;line-height:1.5}
.item{display:block;width:100%;text-align:left;border:1px solid #e2e8f0;background:#fff;border-radius:10px;padding:10px 12px;margin-bottom:8px;cursor:pointer;font:inherit}
.item.on{border-color:#ea580c;background:#fff7ed}.item b{display:block;font-size:13px}.item span{font-size:11px;color:#64748b}
.tag{display:inline-block;font-size:10px;font-weight:700;padding:2px 6px;border-radius:6px;margin-top:5px;background:#e2e8f0;color:#334155}.tag.fn{background:#fef3c7;color:#92400e}
main{flex:1;display:flex;flex-direction:column;min-width:0}
.bar{display:flex;gap:8px;align-items:center;padding:10px 16px;background:#fff;border-bottom:1px solid #cbd5e1;flex-wrap:wrap}
.bar button{border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:6px 12px;cursor:pointer;font:inherit;font-size:13px}.bar button.on{background:#0f172a;color:#fff;border-color:#0f172a}
.meta{font-size:12px;color:#475569;margin-left:auto;max-width:520px;line-height:1.4}
.stage{flex:1;overflow:auto;display:flex;justify-content:center;padding:20px}iframe{border:0;background:#fff;border-radius:10px;box-shadow:0 4px 24px rgba(15,23,42,.15);height:100%;min-height:600px}
</style></head><body><nav><h1>Premarket email previews</h1><p>Local previews with sample data. Nothing here was sent. Orange tag = sent by a Firebase function; grey = sent by the website.</p><div id="list"></div></nav>
<main><div class="bar"><button id="b-desk" class="on">Desktop</button><button id="b-mob">Phone</button><span style="width:12px"></span><button id="b-light" class="on">Light</button><button id="b-dark">Dark</button><span style="width:12px"></span><button id="b-new" class="on">Refined</button><button id="b-old">Previous</button><div class="meta" id="meta"></div></div>
<div class="stage"><iframe id="f" style="width:680px"></iframe></div></main>
<script>const D=${data};let cur=0,mob=false,dark=false,old=false;
const $=id=>document.getElementById(id);
function draw(){let h=(old&&D[cur].prev)?D[cur].prev:D[cur].html;if(dark)h=h.replace(/@media \(prefers-color-scheme: dark\)/g,'@media all');
$('f').srcdoc=h;$('f').style.width=mob?'390px':'680px';
$('meta').innerHTML='<b>'+D[cur].title+'</b><br>Subject: '+D[cur].subject.replace(/</g,'&lt;')+'<br>Trigger: '+D[cur].trigger;
document.querySelectorAll('.item').forEach((e,i)=>e.classList.toggle('on',i===cur));
$('b-desk').classList.toggle('on',!mob);$('b-mob').classList.toggle('on',mob);$('b-new').classList.toggle('on',!old);$('b-old').classList.toggle('on',old);$('b-light').classList.toggle('on',!dark);$('b-dark').classList.toggle('on',dark);}
D.forEach((r,i)=>{const b=document.createElement('button');b.className='item';const fn=/Firebase/.test(r.owner);b.innerHTML='<b>'+r.title+'</b><span>'+r.trigger+'</span><br><span class="tag'+(fn?' fn':'')+'">'+(fn?'Firebase function':'Website')+'</span>';b.onclick=()=>{cur=i;draw()};$('list').appendChild(b)});
$('b-new').onclick=()=>{old=false;draw()};$('b-old').onclick=()=>{old=true;draw()};$('b-desk').onclick=()=>{mob=false;draw()};$('b-mob').onclick=()=>{mob=true;draw()};$('b-light').onclick=()=>{dark=false;draw()};$('b-dark').onclick=()=>{dark=true;draw()};draw();</script></body></html>`;
}

const catalogue = [];
const add = (id, title, owner, trigger, fn) => catalogue.push({ id, title, owner, trigger, fn });

let svc;
beforeAll(async () => {
  process.env.RESEND_API_KEY = 're_preview_stub';
  svc = await import('../../src/app/api/services/resendService');
  const news = await import('../../src/app/api/services/newsletterService');
  const require = createRequire(import.meta.url);
  const welcome = require(join(process.env.HOME, 'premarket-functions/welcome/agentWelcomeEmail.js'));

  add('office-invite', 'Office invitation: new agent account', 'Website', 'Office admin adds / imports / sends an invitation', () =>
    svc.sendOfficeInviteEmail('sam.example@example.com', 'Sam', 'Harcourts Property Hub', ACTIVATE));
  add('office-join-invite', 'Office invitation: existing Premarket user', 'Website', 'Office admin adds someone who already has an account', () =>
    svc.sendOfficeJoinInviteEmail('sam.example@example.com', 'Sam', 'Harcourts Property Hub', ACCEPT));
  add('agent-welcome', 'Agent welcome (independent agents only)', 'Firebase function (new "welcome" codebase, not yet deployed)', 'A new independent agent signs up. Never sent to office-invited agents', async () => {
    const html = welcome.buildAgentWelcomeHtml({ agentEmail: 'sam.example@example.com', agentFirstName: 'Sam' });
    sent.push({ subject: 'Welcome to Premarket', html });
  });
  add('password-reset', 'Password reset', 'Website', 'User asks to reset their password', () =>
    svc.sendPasswordResetEmailTemplate('sam.example@example.com', 'Sam', 'https://premarket.homes/reset?oobCode=SAMPLE'));
  add('property-live', 'Property is live', 'Website', 'A property goes live', () =>
    svc.sendPropertyLiveEmail('sam.example@example.com', 'Sam', '12 Example Street, Sampleton QLD', false));
  add('new-prospect', 'New prospect added (to agent)', 'Website', 'A vendor adds a property to an agent profile', () =>
    svc.sendPropertyAgentEmail('sam.example@example.com', 'Sam', '12 Example Street, Sampleton QLD'));
  add('buyer-interest', 'New buyer registration (to agent)', 'Website', 'A buyer registers interest', () =>
    svc.sendNewBuyerInterestEmail({
      agentEmail: 'sam.example@example.com', agentFirstName: 'Sam', propertyAddress: '12 Example Street, Sampleton QLD',
      propertyId: 'sample', buyerName: 'Alex Buyer', buyerEmail: 'alex.buyer@example.com', buyerPhone: '0400 000 000',
      nextAction: 'inspection', timeframe: '1_3_months', buyerType: 'approved_finance', isFirstHomeBuyer: true, isInvestor: false,
    }));
  add('property-link', 'Property link to share', 'Website', 'An agent requests their share link', () =>
    svc.sendLink('https://premarket.homes/find-property?propertyId=sample', 'sam.example@example.com'));
  add('followup', 'Listing follow-up (14 / 30 days)', 'Website', 'Daily follow-up cron', () =>
    svc.sendPropertyFollowUpEmail('sam.example@example.com', 'Sam', '12 Example Street, Sampleton QLD', 'sample', 14));
  add('newsletter', 'Weekly buyer newsletter (website version)', 'Website', 'Weekly newsletter', async () => {
    const html = news.generateNewsletterHTML({ email: 'alex.buyer@example.com', firstName: 'Alex' }, [
      { id: 'a', title: 'Renovated family home', address: '12 Example Street, Sampleton QLD', price: '$1,275,000', bedrooms: 4, bathrooms: 2, carSpaces: 2 },
      { id: 'b', title: 'Modern townhouse', address: '3 Sample Lane, Exampleton QLD', price: '$890,000', bedrooms: 3, bathrooms: 2, carSpaces: 1 },
    ]);
    sent.push({ subject: 'New Pre-Market Properties This Week', html });
  });
});

describe('redesigned emails', () => {
  it('render without gradients, app promotions or template leaks', async () => {
    mkdirSync(OUT, { recursive: true });
    const index = [];
    for (const item of catalogue) {
      sent.length = 0;
      await item.fn();
      const msg = sent[0];
      expect(msg, item.id).toBeTruthy();
      const html = msg.html;
      expect(html, item.id).not.toMatch(/linear-gradient/i);
      expect(html, item.id).not.toMatch(/app store|google play|apps\.apple|play\.google|download the (premarket )?app|premarket app/i);
      expect(html, item.id).not.toMatch(/fastest-growing|best in|number one|#1 /i);
      expect(html, item.id).not.toMatch(/undefined|\[object Object\]|NaN/);
      expect(html, item.id).toMatch(/alt="Premarket"/);
      if (msg.text !== undefined) expect(msg.text.length, item.id).toBeGreaterThan(20);
      index.push({ ...item, subject: msg.subject, file: `${item.id}.html` });
      if (WRITE) writeFileSync(join(OUT, `${item.id}.html`), html);
    }
    if (WRITE) {
      // Optional: the previous round's renders (email-previews/previous/*.html)
      // for side-by-side comparison. Anything only present there was removed.
      const prevOf = (file) => (existsSync(join(OUT, 'previous', file)) ? readFileSync(join(OUT, 'previous', file), 'utf8') : null);
      const rows = index.map(({ fn, ...r }) => ({ ...r, html: readFileSync(join(OUT, r.file), 'utf8'), prev: prevOf(r.file) }));
      if (existsSync(join(OUT, 'previous'))) {
        for (const f of readdirSync(join(OUT, 'previous'))) {
          if (f.endsWith('.html') && !rows.some((r) => r.file === f)) {
            rows.push({ id: f, title: 'Vendor invitation (REMOVED)', owner: 'Website', trigger: 'No longer offered \u2014 template and route deleted', subject: "You've been invited to join Premarket", html: '<body style="font-family:Arial;padding:40px;color:#475569"><h2>Removed</h2><p>This email no longer exists. Previous design is under the Previous toggle.</p></body>', prev: prevOf(f), removed: true });
          }
        }
      }
      writeFileSync(join(OUT, 'index.html'), viewerHtml(rows));
    }
    expect(index.length).toBe(catalogue.length);
  });

  it('keeps the activation and join links exactly as supplied', async () => {
    sent.length = 0;
    await svc.sendOfficeInviteEmail('a@example.com', 'A', 'Test Office', ACTIVATE);
    expect(sent[0].html).toContain(`href="${ACTIVATE}"`);
    expect(sent[0].text).toContain(ACTIVATE);
    expect(sent[0].html).toMatch(/14 days/);
    sent.length = 0;
    await svc.sendOfficeJoinInviteEmail('a@example.com', 'A', 'Test Office', ACCEPT);
    expect(sent[0].html).toContain(`href="${ACCEPT}"`);
  });

  it('escapes the office name everywhere it is shown', async () => {
    sent.length = 0;
    await svc.sendOfficeInviteEmail('a@example.com', 'A', '<img src=x onerror=alert(1)>', ACTIVATE);
    expect(sent[0].html).not.toContain('<img src=x');
    expect(sent[0].html).toContain('&lt;img src=x');
  });
});

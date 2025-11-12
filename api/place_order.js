// /api/place_order.js  — Vercel/Next API route (CommonJS)

// Guarded Twilio import (prevents cold-start crash if not installed)
let twilioLib = null;
try { twilioLib = require('twilio'); } catch {}

const path = require('path');
const https = require('https');

const {
  // SMS (optional)
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_SMS_FROM,
  TWILIO_MESSAGING_SERVICE_SID,

  // Email (Resend)
  RESEND_API_KEY,
  DEFAULT_EMAIL_TO,             // e.g., "t.n.jayasudhaa@gmail.com"
  EMAIL_FROM,                   // e.g., "Order Bot <onboarding@resend.dev>"

  // Menu + pricing
  MENU_URL,                     // e.g., "https://voicebot-zeta.vercel.app/menu_categorized.json"
  TAX_RATE,                     // e.g., "0.085"
  VERCEL_URL,                   // provided by Vercel at runtime
} = process.env;

const smsClient =
  (twilioLib && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN)
    ? twilioLib(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    : null;

/* -------------------------------------------
   MENU LOADING (URL → local → embedded)
--------------------------------------------*/

// tiny https JSON fetcher (avoids Node fetch inconsistencies)
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
      })
      .on('error', reject);
  });
}

// embedded minimal fallback so totals never return 0
const EMBEDDED_MENU = [
  { name: 'Fresh Lime Soda - Salt', price: 4,   sku: 'FRESH-LIME-SODA-SALT' },
  { name: 'Garlic Naan',            price: 4,   sku: 'GARLIC-NAAN' },
  { name: 'Veg Dum Biryani',        price: 16,  sku: 'VEG-DUM-BIRYANI' },
  { name: 'Butter Naan',            price: 3.5, sku: 'BUTTER-NAAN' },
];

// Single authoritative declarations (do NOT redeclare later)
let MENU = [];                        // flattened [{ name, price, sku }]
let MENU_MAP = Object.create(null);   // fast lookup index

const ALIASES = {
  'roti': 'tandoori roti',
  'tandoori-roti': 'tandoori roti',
  'tandoori  roti': 'tandoori roti', // double-space variant
};

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function rebuildIndex() {
  MENU_MAP = Object.create(null);
  for (const m of MENU) {
    MENU_MAP[norm(m.name)] = m;
    MENU_MAP[norm(m.sku)]  = m;
  }
}

async function ensureMenuLoaded() {
  if (MENU.length) return;

  // 1) URL (explicit or derived)
  const host = VERCEL_URL || 'voicebot-zeta.vercel.app';
  const url = MENU_URL || `https://${host}/menu_categorized.json`;
  try {
    const data = await fetchJson(url);
    if (Array.isArray(data?.categories)) {
      MENU = data.categories.flatMap((cat) =>
        (cat.items || []).map((it) => ({
          name: it.name,
          price: Number(it.price),
          sku: (it.name || '')
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, '-')
            .replace(/(^-|-$)/g, ''),
        }))
      );
      if (MENU.length) {
        rebuildIndex();
        console.log('[MENU] Loaded from URL:', url, 'size=', MENU.length);
        return;
      }
    }
    console.error('[MENU] URL returned unexpected shape:', url);
  } catch (e) {
    console.error('[MENU] URL fetch error:', url, e.message);
  }

  // 2) Local file bundled with the function: api/menu_categorized.json
  try {
    const local = require(path.join(__dirname, 'menu_categorized.json'));
    if (Array.isArray(local?.categories)) {
      MENU = local.categories.flatMap((cat) =>
        (cat.items || []).map((it) => ({
          name: it.name,
          price: Number(it.price),
          sku: (it.name || '')
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, '-')
            .replace(/(^-|-$)/g, ''),
        }))
      );
      if (MENU.length) {
        rebuildIndex();
        console.log('[MENU] Loaded local fallback: api/menu_categorized.json size=', MENU.length);
        return;
      }
    }
    console.error('[MENU] Local fallback had unexpected shape');
  } catch (e) {
    console.error('[MENU] Local fallback require failed:', e.message);
  }

  // 3) Embedded minimal
  MENU = EMBEDDED_MENU.slice();
  rebuildIndex();
  console.warn('[MENU] Using EMBEDDED_MENU fallback size=', MENU.length);
}

/* -------------------------------------------
   HELPERS
--------------------------------------------*/

function lookup(item) {
  let key = norm(item?.sku || item?.name || '');
  if (ALIASES[key]) key = norm(ALIASES[key]);
  return MENU_MAP[key] || null;
}

function price(items = []) {
  let subtotal = 0;
  const lines = (items || []).map((it) => {
    const found = lookup(it);
    const name = found?.name || it.name || it.sku || 'Item';
    const sku =
      found?.sku ||
      (it.sku
        ? String(it.sku).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/(^-|-$)/g, '')
        : String(name).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/(^-|-$)/g, ''));
    const qty = Math.max(1, Number(it.qty) || 1);
    const unit = Number(found?.price ?? it.unitPrice ?? it.price ?? 0);
    const lineTotal = +(qty * unit).toFixed(2);
    subtotal += lineTotal;
    return { name, sku, qty, unitPrice: unit, options: it.options || {}, lineTotal };
  });
  subtotal = +subtotal.toFixed(2);
  const taxRate = Number(TAX_RATE ?? 0.085);
  const tax = +(subtotal * taxRate).toFixed(2);
  const total = +(subtotal + tax).toFixed(2);
  return { lines, subtotal, tax, total };
}

function isE164(p) { return /^\+?[1-9]\d{1,14}$/.test((p || '').trim()); }

function parseBody(req) {
  let b = req.body;
  if (!b) return {};
  if (typeof b === 'string') { try { return JSON.parse(b); } catch { return {}; } }
  if (typeof b === 'object' && typeof b.json === 'string') {
    try { return JSON.parse(b.json); } catch { return {}; }
  }
  return b;
}

/* -------------------------------------------
   EMAIL (Resend) — lazy require, won’t crash
--------------------------------------------*/

async function sendEmailReceipt({ orderId, customer, fulfillment, lines, subtotal, tax, total, notes }) {
  try {
    if (!RESEND_API_KEY) return { success: false, error: 'missing_RESEND_API_KEY' };

    let ResendCtor;
    try {
      ResendCtor = require('resend').Resend;
    } catch {
      return { success: false, error: 'resend_module_not_installed' };
    }

    const resend = new ResendCtor(RESEND_API_KEY);
    const to = (customer?.email && String(customer.email).trim()) || DEFAULT_EMAIL_TO || 't.n.jayasudhaa@gmail.com';
    const from = EMAIL_FROM || 'Order Bot <onboarding@resend.dev>';

    const rows = lines.map(li => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${li.qty} × ${li.name}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">$${(li.unitPrice * li.qty).toFixed(2)}</td>
      </tr>
    `).join('');

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;">
        <h2 style="margin:0 0 8px;">Thanks for your order!</h2>
        <p style="margin:0 0 16px;">Hi ${customer?.name || 'Guest'}, your order has been received.</p>
        <p style="margin:0 0 6px;"><strong>Order ID:</strong> ${orderId}</p>
        <p style="margin:0 0 6px;"><strong>Fulfillment:</strong> ${fulfillment?.type || ''} — ${fulfillment?.when || ''}${fulfillment?.address ? ` — ${fulfillment.address}` : ''}</p>
        <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:12px 0 8px;">
          <tbody>${rows}</tbody>
          <tfoot>
            <tr><td style="padding:6px 8px;text-align:right;"><strong>Subtotal</strong></td><td style="padding:6px 8px;text-align:right;">$${subtotal.toFixed(2)}</td></tr>
            <tr><td style="padding:6px 8px;text-align:right;"><strong>Tax</strong></td><td style="padding:6px 8px;text-align:right;">$${tax.toFixed(2)}</td></tr>
            <tr><td style="padding:6px 8px;text-align:right;"><strong>Total</strong></td><td style="padding:6px 8px;text-align:right;"><strong>$${total.toFixed(2)}</strong></td></tr>
          </tfoot>
        </table>
        ${notes ? `<p style="margin:8px 0 0;"><strong>Notes:</strong> ${notes}</p>` : ''}
      </div>
    `;

    await resend.emails.send({ from, to, subject: `Order Confirmation – ${orderId}`, html });
    return { success: true };
  } catch (e) {
    return { success: false, error: e?.message || 'email_error' };
  }
}

/* -------------------------------------------
   HANDLER
--------------------------------------------*/

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

    const body = parseBody(req);
    const { customer = {}, fulfillment = {}, items = [], notes = '' } = body || {};
    const phone = (customer.phone || '').trim();
    const orderId = `ord_${Date.now()}`;

    // Load menu (URL → local → embedded)
    await ensureMenuLoaded();

    // Price the order
    const priced = price(items);

    // Build SMS (compliance: STOP/HELP)
    const smsLines = priced.lines.map(
      (li) => `${li.qty}x ${li.name}` + (li.options?.spice ? ` (${li.options.spice})` : '') + ` - $${li.lineTotal.toFixed(2)}`
    );
    const smsText =
      `Paradise Tavern\nOrder ${orderId}\n` +
      smsLines.join('\n') +
      `\nSubtotal: $${priced.subtotal}\nTax: $${priced.tax}\nTotal: $${priced.total}` +
      `\n${fulfillment?.type === 'delivery' ? 'Delivery' : 'Pickup'}: ${fulfillment?.when || 'ASAP'}` +
      (notes ? `\nNotes: ${notes}` : '') +
      `\nReply STOP to opt out. HELP for help.`;

    // Try SMS if configured & number is valid E.164
    let sms = { success: false, sid: null, error: 'not_configured' };
    if (smsClient && isE164(phone)) {
      try {
        const params = { to: phone, body: smsText };
        if (TWILIO_MESSAGING_SERVICE_SID) params.messagingServiceSid = TWILIO_MESSAGING_SERVICE_SID;
        else if (TWILIO_SMS_FROM) params.from = TWILIO_SMS_FROM;
        const r = await smsClient.messages.create(params);
        sms = { success: true, sid: r.sid };
      } catch (e) {
        sms = {
          success: false,
          error: e && e.code === 30034 ? 'Sender not A2P/TF verified yet' : (e?.message || 'sms_error'),
        };
      }
    } else if (smsClient && !isE164(phone)) {
      sms = { success: false, error: 'invalid_phone' };
    }

    // Email receipt (safe: won’t crash if missing)
    const email = await sendEmailReceipt({
      orderId,
      customer,
      fulfillment,
      lines: priced.lines,
      subtotal: priced.subtotal,
      tax: priced.tax,
      total: priced.total,
      notes,
    });

    const spokenSummary =
      `Order ${orderId} placed. Total ${priced.total} dollars. ` +
      `${fulfillment?.type === 'delivery' ? 'Delivery' : 'Pickup'} ${fulfillment?.when || 'ASAP'}. ` +
      (sms.success ? `I've texted your receipt. ` : `I couldn't text the receipt. `) +
      (email.success ? `I've also emailed it.` : `Email not sent.`);

    console.log('ORDER', { orderId, customer, fulfillment, items: priced.lines, ...priced, notes, sms, email });

    res.status(200).json({ ok: true, orderId, ...priced, sms, email, spokenSummary });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
};

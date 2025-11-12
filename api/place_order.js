// /api/place_order.js  — Vercel/Next API route (CommonJS)

// Guard Twilio import so missing package won't crash cold starts
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

  // Branding
  RESTAURANT_NAME,              // e.g., "Paradise Tavern"
  RESTAURANT_PHONE,             // optional, e.g., "(719) 555-1212"

  // Menu + pricing
  MENU_URL,                     // e.g., "https://<your-app>.vercel.app/menu_categorized.json"
  TAX_RATE,                     // e.g., "0.085"
  VERCEL_URL,                   // provided by Vercel at runtime
} = process.env;

const RESTO = RESTAURANT_NAME || 'Paradise Tavern';

const smsClient =
  (twilioLib && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN)
    ? twilioLib(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    : null;

/* -------------------------------------------
   Tiny JSON fetcher (stable on Node runtimes)
--------------------------------------------*/
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

/* -------------------------------------------
   FULL EMBEDDED MENU (categorized) + flattener
--------------------------------------------*/
const EMBEDDED_MENU_CATEGORIZED = {
  categories: [
    {
      name: "Popular Items",
      items: [
        { name: "Chicken Tikka Masala", price: 17.0 },
        { name: "Butter Naan",          price: 3.5  },
        { name: "Garlic Naan",          price: 4.0  },
        { name: "Veg Samosa (2)",       price: 7.0  },
        { name: "Veg Dum Biryani",      price: 16.0 },
        { name: "Tandoori Chicken",     price: 19.0 },
        { name: "Paneer Tikka Masala",  price: 17.0 }
      ]
    },
    {
      name: "Curries",
      items: [
        { name: "Chicken Makhani",                    price: 16.0 },
        { name: "Chicken Korma",                      price: 17.0 },
        { name: "Chicken Rogan Josh",                 price: 17.0 },
        { name: "Chicken Chettinad",                  price: 17.0 },
        { name: "Andhra Chicken Curry",               price: 16.0 },
        { name: "Chicken Tikka Masala",               price: 17.0 },
        { name: "Kadai Chicken",                      price: 17.0 },
        { name: "Lamb Makhani",                       price: 20.0 },
        { name: "Lamb Korma",                         price: 20.0 },
        { name: "Lamb Rogan Josh",                    price: 20.0 },
        { name: "Lamb Chettinad",                     price: 20.0 },
        { name: "Kadai Lamb",                         price: 20.0 },
        { name: "Goat Curry",                         price: 18.0 },
        { name: "Goat Korma",                         price: 20.0 },
        { name: "Goat Rogan Josh",                    price: 20.0 },
        { name: "Goat Chettinad",                     price: 20.0 },
        { name: "Kadai Goat",                         price: 20.0 },
        { name: "Saag (Spinach) Goat",                price: 20.0 },
        { name: "Shrimp Curry",                       price: 21.0 },
        { name: "Shrimp Makhani",                     price: 20.0 },
        { name: "Kadai Shrimp",                       price: 21.0 },
        { name: "Fish Moilee",                        price: 20.0 },
        { name: "Dal Makhani",                        price: 16.0 },
        { name: "Dal Tadka",                          price: 16.0 },
        { name: "Channa Masala",                      price: 16.0 },
        { name: "Aloo Gobi Curry",                    price: 16.0 },
        { name: "Bagara Baingan",                     price: 16.0 },
        { name: "Punjabi Saag (Spinach) Paneer",      price: 17.0 },
        { name: "Kashmiri Malai Kofta",               price: 17.0 },
        { name: "Veg Korma",                          price: 14.0 },
        { name: "Vegetable Chettinad",                price: 14.0 },
        { name: "Signature Mango Curry - Veg",        price: 16.0 },
        { name: "Signature Mango Curry - Chicken",    price: 17.0 },
        { name: "Signature Mango Curry - Lamb",       price: 20.0 },
        { name: "Signature Mango Curry - Goat",       price: 20.0 },
        { name: "Signature Mango Curry - Fish",       price: 20.0 },
        { name: "Telangana Gongura Chicken Curry",    price: 17.0 },
        { name: "Telangana Gongura Lamb Curry",       price: 20.0 },
        { name: "Telangana Gongura Mutton Curry",     price: 20.0 },
        { name: "Telangana Gongura Shrimp Curry",     price: 21.0 },
        { name: "Fiery Goan Vindaloo - Chicken",      price: 17.0 },
        { name: "Fiery Goan Vindaloo - Lamb",         price: 20.0 },
        { name: "Fiery Goan Vindaloo - Goat",         price: 20.0 },
        { name: "Fiery Goan Vindaloo - Shrimp",       price: 20.0 },
        { name: "Fiery Goan Vindaloo - Fish",         price: 20.0 },
        { name: "Nadan Curry - Chicken",              price: 16.0 },
        { name: "Nadan Curry - Goat",                 price: 20.0 },
        { name: "Nellore Chepala Pulusu",             price: 22.0 }
      ]
    },
    {
      name: "Breads",
      items: [
        { name: "Plain Naan",             price: 3.0 },
        { name: "Butter Naan",            price: 3.5 },
        { name: "Garlic Naan",            price: 4.0 },
        { name: "Tikka Naan",             price: 4.0 },
        { name: "Tandoori Roti",          price: 4.0 },
        { name: "Chapathi",               price: 3.5 },
        { name: "Pulka",                  price: 4.0 },
        { name: "Malabar Parotta (2)",    price: 6.0 }
      ]
    },
    {
      name: "Biryanis",
      items: [
        { name: "Veg Dum Biryani",                         price: 16.0 },
        { name: "Vijayawada Chicken (BoneOut) Biryani",    price: 19.0 },
        { name: "Konaseema Goat Biryani",                  price: 21.0 },
        { name: "Lamb Biryani",                            price: 20.0 },
        { name: "Shrimp Biryani",                          price: 20.0 },
        { name: "Goat Dum Biryani",                        price: 20.0 }
      ]
    },
    {
      name: "Drinks",
      items: [
        { name: "Fresh Lime Soda - Salt",  price: 4.0  },
        { name: "Coffee (Hot)",            price: 2.99 },
        { name: "Masala Chai",             price: 3.49 },
        { name: "Sweet Lassi",             price: 4.99 },
        { name: "Salt Lassi",              price: 4.99 },
        { name: "Mango Lassi",             price: 5.49 },
        { name: "Fresh Juice - Orange",    price: 5.99 },
        { name: "Fresh Juice - Pineapple", price: 5.99 },
        { name: "Fresh Juice - Watermelon",price: 5.99 },
        { name: "Cocktail Special - Mango Mule",           price: 12.00 },
        { name: "Cocktail Special - Tamarind Margarita",   price: 12.00 },
        { name: "Cocktail Special - Masala Old Fashioned", price: 13.00 }
      ]
    },
    {
      name: "Desserts",
      items: [
        { name: "Black Forest Pastry", price: 4.0 }
      ]
    }
  ]
};

const ALIASES = {
  // breads & common variants
  'roti': 'tandoori roti',
  'tandoori-roti': 'tandoori roti',
  'garlic-naan': 'garlic naan',
  'butter-naan': 'butter naan',
  'tikka-naan': 'tikka naan',
  // drinks / lassi variants
  'mango-lassi': 'mango lassi',
  'lassi-mango': 'mango lassi',
  'sweet-lassi': 'sweet lassi',
  'salt-lassi': 'salt lassi',
  // biryani short
  'veg biryani': 'veg dum biryani',
};

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// flat menu + fast index
let MENU = [];                        // flattened [{ name, price, sku }]
let MENU_MAP = Object.create(null);   // norm(name/sku) -> item

function flattenMenuCategories(data) {
  const out = [];
  for (const cat of (data?.categories || [])) {
    for (const it of (cat.items || [])) {
      out.push({
        name: it.name,
        price: Number(it.price),
        sku: (it.name || '')
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, '-')
          .replace(/(^-|-$)/g, ''),
      });
    }
  }
  // de-dup by normalized name
  const seen = new Map();
  for (const m of out) {
    const key = norm(m.name);
    if (!seen.has(key)) seen.set(key, m);
  }
  return [...seen.values()];
}

function rebuildIndex() {
  MENU_MAP = Object.create(null);
  for (const m of MENU) {
    MENU_MAP[norm(m.name)] = m;
    MENU_MAP[norm(m.sku)]  = m;
  }
}

/* -------------------------------------------
   Load menu: URL → local file → embedded full
--------------------------------------------*/
async function ensureMenuLoaded() {
  if (MENU.length) return;

  // 1) URL (explicit or derived)
  const host = VERCEL_URL || 'voicebot-zeta.vercel.app';
  const url = MENU_URL || `https://${host}/menu_categorized.json`;
  try {
    const data = await fetchJson(url);
    if (Array.isArray(data?.categories)) {
      MENU = flattenMenuCategories(data);
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

  // 2) Local fallback next to this function: api/menu_categorized.json
  try {
    const local = require(path.join(__dirname, 'menu_categorized.json'));
    if (Array.isArray(local?.categories)) {
      MENU = flattenMenuCategories(local);
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

  // 3) Embedded full menu (never returns zero)
  MENU = flattenMenuCategories(EMBEDDED_MENU_CATEGORIZED);
  rebuildIndex();
  console.warn('[MENU] Using EMBEDDED full fallback size=', MENU.length);
}

/* -------------------------------------------
   Helpers: pricing & validation
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

function normalizePhone(p) {
  const raw = String(p || '').trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (/^\+?[1-9]\d{1,14}$/.test(raw)) return raw.startsWith('+') ? raw : `+${raw}`;
  return null;
}

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
   Email (Resend) — lazy require, won’t crash
--------------------------------------------*/
async function sendEmailReceipt({ orderId, customer, customerPhone, fulfillment, lines, subtotal, tax, total, notes }) {
  try {
    if (!RESEND_API_KEY) return { success: false, error: 'missing_RESEND_API_KEY' };

    let ResendCtor;
    try { ResendCtor = require('resend').Resend; }
    catch { return { success: false, error: 'resend_module_not_installed' }; }

    const resend = new ResendCtor(RESEND_API_KEY);
    const to = (customer?.email && String(customer.email).trim()) || DEFAULT_EMAIL_TO || 't.n.jayasudhaa@gmail.com';
    const from = EMAIL_FROM || 'Order Bot <onboarding@resend.dev>';

    // Build item rows (Item | Qty | Unit | Line)
    const rows = lines.map(li => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #eee;">${li.name}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">${li.qty}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">$${li.unitPrice.toFixed(2)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">$${li.lineTotal.toFixed(2)}</td>
      </tr>
    `).join('');

    const customerLine =
      (customer?.name ? `<strong>${customer.name}</strong>` : 'Guest') +
      (customerPhone ? ` — <a href="tel:${customerPhone}" style="color:#0a7;">${customerPhone}</a>` : '') +
      (customer?.email ? ` — <a href="mailto:${customer.email}" style="color:#0a7;">${customer.email}</a>` : '');

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;max-width:640px;">
        <h1 style="margin:0 0 6px;font-size:20px;">${RESTO}</h1>
        <p style="margin:0 0 14px;color:#555;">Order Confirmation</p>

        <p style="margin:0 0 6px;"><strong>Order ID:</strong> ${orderId}</p>
        <p style="margin:0 0 6px;"><strong>Customer:</strong> ${customerLine}</p>
        <p style="margin:0 0 14px;"><strong>${fulfillment?.type === 'delivery' ? 'Delivery' : 'Pickup'}:</strong> ${fulfillment?.when || 'ASAP'}${fulfillment?.address ? ` — ${fulfillment.address}` : ''}</p>

        <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:6px 0 12px;">
          <thead>
            <tr>
              <th align="left"  style="padding:8px;border-bottom:2px solid #ddd;">Item</th>
              <th align="center"style="padding:8px;border-bottom:2px solid #ddd;">Qty</th>
              <th align="right" style="padding:8px;border-bottom:2px solid #ddd;">Unit</th>
              <th align="right" style="padding:8px;border-bottom:2px solid #ddd;">Line</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr>
              <td colspan="3" style="padding:8px;text-align:right;"><strong>Subtotal</strong></td>
              <td style="padding:8px;text-align:right;">$${subtotal.toFixed(2)}</td>
            </tr>
            <tr>
              <td colspan="3" style="padding:8px;text-align:right;"><strong>Tax</strong></td>
              <td style="padding:8px;text-align:right;">$${tax.toFixed(2)}</td>
            </tr>
            <tr>
              <td colspan="3" style="padding:8px;text-align:right;"><strong>Total</strong></td>
              <td style="padding:8px;text-align:right;"><strong>$${total.toFixed(2)}</strong></td>
            </tr>
          </tfoot>
        </table>

        ${notes ? `<p style="margin:8px 0;"><strong>Notes:</strong> ${notes}</p>` : ''}

        ${RESTAURANT_PHONE ? `<p style="margin:12px 0 0;color:#555;">Questions? Call us at <strong>${RESTAURANT_PHONE}</strong>.</p>` : ''}
      </div>
    `;

    await resend.emails.send({
      from,
      to,
      subject: `${RESTO} — Order Confirmation ${orderId}`,
      html,
    });

    return { success: true };
  } catch (e) {
    return { success: false, error: e?.message || 'email_error' };
  }
}

/* -------------------------------------------
   Handler
--------------------------------------------*/
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

    const body = parseBody(req);
    const { customer = {}, fulfillment = {}, items = [], notes = '' } = body || {};

    // Enforce name + phone collection (bot must ask if missing)
    const phoneNorm = normalizePhone(customer.phone);
    if (!customer?.name || !phoneNorm) {
      const need = { name: !customer?.name, phone: !phoneNorm };
      const say =
        (!customer?.name && !phoneNorm)
          ? "I can place your order—what’s your name, and what phone number should I send the confirmation to? Please include country code, for example +1 719-555-1212."
          : (!customer?.name)
            ? "Got it. What name should I put on the order?"
            : "Thanks. What phone number should I send the confirmation to? Please include the country code, e.g., +1 719-555-1212.";
      return res.status(200).json({ ok: false, error: 'missing_contact', need, say });
    }
    const phone = phoneNorm;

    // Load menu (URL → local → embedded)
    await ensureMenuLoaded();

    // Price the order
    const priced = price(items);

    // Build SMS (compliance: STOP/HELP)
    const customerName = (customer?.name || 'Guest').trim();
    const customerPhoneForDisplay = phone || (customer?.phone || '').trim();

    const smsLines = priced.lines.map(
      (li) => `${li.qty} x ${li.name} @ $${li.unitPrice.toFixed(2)} = $${li.lineTotal.toFixed(2)}`
    );

    const smsText =
      `${RESTO}\n` +
      `Order ${orderId = `ord_${Date.now()}`}\n` + // define orderId while composing
      `Customer: ${customerName}\n` +
      (customerPhoneForDisplay ? `Phone: ${customerPhoneForDisplay}\n` : '') +
      `\nItems:\n${smsLines.join('\n')}\n` +
      `\nSubtotal: $${priced.subtotal.toFixed(2)}\n` +
      `Tax: $${priced.tax.toFixed(2)}\n` +
      `Total: $${priced.total.toFixed(2)}\n` +
      `${fulfillment?.type === 'delivery' ? 'Delivery' : 'Pickup'}: ${fulfillment?.when || 'ASAP'}\n` +
      (notes ? `Notes: ${notes}\n` : '') +
      (RESTAURANT_PHONE ? `\nQuestions? Call ${RESTAURANT_PHONE}\n` : '') +
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
      customerPhone: phone,
      fulfillment,
      lines: priced.lines,
      subtotal: priced.subtotal,
      tax: priced.tax,
      total: priced.total,
      notes,
    });

    const spokenSummary =
      `Order ${orderId} placed at ${RESTO}. ` +
      `Customer ${customerName}` + (customerPhoneForDisplay ? `, phone ${customerPhoneForDisplay}. ` : '. ') +
      `Total ${priced.total} dollars. ` +
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

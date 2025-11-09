const twilio = require('twilio');

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_SMS_FROM,
  TWILIO_MESSAGING_SERVICE_SID
} = process.env;

const smsClient = (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN)
  ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
  : null;

// Load the same menu the bot reads
let DATA;
try { DATA = require('../data/menu_categorized.json'); } catch (e) { DATA = { categories: [] }; }
const MENU = Array.isArray(DATA.categories)
  ? DATA.categories.flatMap(cat =>
      (cat.items || []).map(it => ({ name: it.name, price: Number(it.price), sku: (it.name || '').toUpperCase().replace(/[^A-Z0-9]+/g,'-') }))
    )
  : [];

// Helpers
function lookup(item) {
  const key = String(item?.sku || item?.name || '').toLowerCase();
  return MENU.find(m =>
    m.sku?.toLowerCase() === key ||
    m.name?.toLowerCase() === key
  ) || null;
}

function price(items = []) {
  let subtotal = 0;
  const lines = (items || []).map(it => {
    const base = lookup(it) || { name: it.name || 'Item', sku: it.sku || 'UNK', price: it.unitPrice || 0 };
    const qty = Math.max(1, Number(it.qty) || 1);
    const unit = Number(base.price || 0);
    const lineTotal = +(qty * unit).toFixed(2);
    subtotal += lineTotal;
    return { name: base.name, sku: base.sku, qty, unitPrice: unit, options: it.options || {}, lineTotal };
  });
  subtotal = +subtotal.toFixed(2);
  const tax = +(subtotal * 0.085).toFixed(2);
  const total = +(subtotal + tax).toFixed(2);
  return { lines, subtotal, tax, total };
}

function isE164(p){ return /^\+?[1-9]\d{1,14}$/.test((p||'').trim()); }

// Accept raw JSON or {"json":"<stringified>"} (what Vapi sometimes sends)
function parseBody(req) {
  let b = req.body;
  if (!b) return {};
  if (typeof b === 'string') {
    try { return JSON.parse(b); } catch { return {}; }
  }
  if (typeof b === 'object' && typeof b.json === 'string') {
    try { return JSON.parse(b.json); } catch { return {}; }
  }
  return b;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

    const body = parseBody(req);
    const { customer, fulfillment, items = [], notes = '' } = body || {};
    const phone = (customer?.phone || '').trim();
    const orderId = `ord_${Date.now()}`;

    const priced = price(items);

    // Build SMS text (compliance includes STOP/HELP)
    const smsLines = priced.lines.map(li =>
      `${li.qty}x ${li.name}` + (li.options?.spice ? ` (${li.options.spice})` : '') + ` - $${li.lineTotal.toFixed(2)}`
    );
    const smsText =
      `Paradise Tavern\nOrder ${orderId}\n` +
      smsLines.join('\n') +
      `\nSubtotal: $${priced.subtotal}\nTax: $${priced.tax}\nTotal: $${priced.total}` +
      `\n${fulfillment?.type === 'delivery' ? 'Delivery' : 'Pickup'}: ${fulfillment?.when || 'ASAP'}` +
      (notes ? `\nNotes: ${notes}` : '') +
      `\nReply STOP to opt out. HELP for help.`;

    // Try SMS if configured & number looks valid
    let sms = { success:false, sid:null, error:'not_configured' };
    if (smsClient && isE164(phone)) {
      try {
        const params = { to: phone, body: smsText };
        if (TWILIO_MESSAGING_SERVICE_SID) params.messagingServiceSid = TWILIO_MESSAGING_SERVICE_SID;
        else if (TWILIO_SMS_FROM) params.from = TWILIO_SMS_FROM;
        const r = await smsClient.messages.create(params);
        sms = { success:true, sid: r.sid };
      } catch (e) {
        sms = { success:false, error: e.code === 30034
          ? 'Sender not A2P/TF verified yet'
          : (e.message || 'sms_error') };
      }
    }

    const spokenSummary =
      `Order ${orderId} placed. Total ${priced.total} dollars. ` +
      `${fulfillment?.type === 'delivery' ? 'Delivery' : 'Pickup'} ${fulfillment?.when || 'ASAP'}. ` +
      (sms.success ? `I've texted your receipt.` : `I couldn't text the receipt.`);

    // Log for debugging
    console.log('ORDER', { orderId, customer, fulfillment, items: priced.lines, ...priced, notes, sms });

    res.status(200).json({ ok:true, orderId, ...priced, sms, spokenSummary });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
};

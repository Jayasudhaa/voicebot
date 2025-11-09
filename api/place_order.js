const twilio = require('twilio');

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_SMS_FROM
} = process.env;

const smsClient = (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN)
  ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
  : null;

const DATA = require('../data/menu.json');
const MENU = DATA.items || [];

function lookup(item) {
  const key = (item?.sku || item?.name || '').toLowerCase();
  return MENU.find(m =>
    (m.sku && m.sku.toLowerCase() === key) ||
    (m.name && m.name.toLowerCase() === key)
  ) || null;
}
function price(items = []) {
  let subtotal = 0;
  const lines = items.map(it => {
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
function isE164(p){return /^\+?[1-9]\d{1,14}$/.test((p||'').trim());}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

    const { customer, fulfillment, items = [], notes = '' } = req.body || {};
    const phone = (customer?.phone || '').trim();

    const orderId = `ord_${Date.now()}`;
    const priced = price(items);

    // Persist to a DB later; for now just log
    console.log('ORDER', { orderId, customer, fulfillment, items: priced.lines, ...priced, notes });

    // Build SMS text
    const smsLines = priced.lines.map(li =>
      `${li.qty}x ${li.name}` + (li.options?.spice ? ` (${li.options.spice})` : '') + ` - $${li.lineTotal.toFixed(2)}`
    );
    const smsText =
      `Paradise Tavern\nOrder ${orderId}\n` +
      smsLines.join('\n') +
      `\nSubtotal: $${priced.subtotal}\nTax: $${priced.tax}\nTotal: $${priced.total}` +
      `\n${fulfillment?.type === 'delivery' ? 'Delivery' : 'Pickup'}: ${fulfillment?.when || 'ASAP'}` +
      (notes ? `\nNotes: ${notes}` : '') +
      `\nThanks!`;

    // Try SMS if credentials present
    let sms = { success:false, sid:null, error:'not_configured' };
    if (smsClient && TWILIO_SMS_FROM && phone && isE164(phone)) {
      try {
        const r = await smsClient.messages.create({ to: phone, from: TWILIO_SMS_FROM, body: smsText });
        sms = { success:true, sid: r.sid };
      } catch (e) {
        sms = { success:false, error: e.message || 'sms_error' };
        console.error('SMS error:', e);
      }
    }

    const spokenSummary =
      `Order ${orderId} placed. Total ${priced.total} dollars. ` +
      `${fulfillment?.type === 'delivery' ? 'Delivery' : 'Pickup'} ${fulfillment?.when || 'ASAP'}. ` +
      (sms.success ? `I've texted your receipt.` : `I couldn't text the receipt, but I can read your details now.`);

    res.status(200).json({
      ok: true,
      orderId,
      ...priced,
      sms,
      spokenSummary
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
};

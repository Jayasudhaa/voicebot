const twilio = require('twilio');

// ⬇️ ADD: Resend email sender
const { Resend } = require('resend');
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const DEFAULT_EMAIL_TO = process.env.DEFAULT_EMAIL_TO || 't.n.jayasudhaa@gmail.com';
const EMAIL_FROM = process.env.EMAIL_FROM || 'Order Bot <onboarding@resend.dev>';
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

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

// ⬇️ ADD: email HTML renderer
function renderEmailHTML({ orderId, customer, fulfillment, lines, subtotal, tax, total, notes }) {
  const rows = lines.map(li =>
    `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;">${li.qty} × ${li.name}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">$${(li.unitPrice * li.qty).toFixed(2)}</td>
    </tr>`
  ).join('');

  return `
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
}

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
    const { customer = {}, fulfillment = {}, items = [], notes = '' } = body || {};
    const phone = (customer.phone || '').trim();
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

    // ⬇️ ADD: Email receipt (default to Jayasudhaa if customer.email not provided)
    let email = { success:false, error:'not_configured' };
    if (resend) {
      try {
        const to = (customer.email && String(customer.email).trim()) || DEFAULT_EMAIL_TO;
        const html = renderEmailHTML({
          orderId,
          customer,
          fulfillment,
          lines: priced.lines,
          subtotal: priced.subtotal,
          tax: priced.tax,
          total: priced.total,
          notes
        });
        await resend.emails.send({
          from: EMAIL_FROM,
          to,
          subject: `Order Confirmation – ${orderId}`,
          html
        });
        email = { success:true };
      } catch (e) {
        email = { success:false, error: e?.message || 'email_error' };
      }
    }

    const spokenSummary =
      `Order ${orderId} placed. Total ${priced.total} dollars. ` +
      `${fulfillment?.type === 'delivery' ? 'Delivery' : 'Pickup'} ${fulfillment?.when || 'ASAP'}. ` +
      (sms.success ? `I've texted your receipt. ` : `I couldn't text the receipt. `) +
      (email.success ? `I've also emailed it.` : `Email not sent.`);

    // Log for debugging
    console.log('ORDER', { orderId, customer, fulfillment, items: priced.lines, ...priced, notes, sms, email });

    res.status(200).json({ ok:true, orderId, ...priced, sms, email, spokenSummary });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
};

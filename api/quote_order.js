// api/quote_order.js
// Returns priced cart without placing/sending SMS
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

    const { items = [], fulfillment = {} } = req.body || {};

    // --- Same MENU and pricing logic as in place_order.js ---
    const MENU = [
      { sku:'CKTIKKA', name:'Chicken Tikka', price:12.99, options:{spice:['mild','medium','hot']} },
      { sku:'GNAAN',   name:'Garlic Naan',   price: 3.49 }
    ];
    function lookup(item) {
      const key = (item?.sku || item?.name || '').toLowerCase();
      return MENU.find(m => m.sku.toLowerCase() === key || m.name.toLowerCase() === key) || null;
    }
    function price(itemsArr = []) {
      let subtotal = 0;
      const lines = itemsArr.map(it => {
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

    const priced = price(items);
    const spokenSummary =
      `Current total ${priced.total} dollars. ` +
      `${fulfillment?.type === 'delivery' ? 'Delivery' : 'Pickup'} ${fulfillment?.when || 'ASAP'}. ` +
      `Should I place the order?`;

    res.status(200).json({ ok:true, ...priced, spokenSummary });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
};

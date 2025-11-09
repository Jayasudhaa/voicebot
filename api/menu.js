// api/menu.js
// Live menu fetcher for https://www.paradisetavern.com/store/20266
// Uses headless Chrome compatible with Vercel Lambdas

const chromium = require('@sparticuz/chromium-min');
const puppeteer = require('puppeteer-core');

const STORE_URL = 'https://www.paradisetavern.com/store/20266';

// simple sku generator
const slug = s => (s || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/(^-|-$)/g, '')
  .slice(0, 40)
  .toUpperCase();

async function fetchMenu() {
  const executablePath = await chromium.executablePath();

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 1280, height: 1800 },
    executablePath,
    headless: chromium.headless,
  });

  const page = await browser.newPage();
  await page.goto(STORE_URL, { waitUntil: 'networkidle2', timeout: 90000 });

  // Give any lazy sections a moment to render
  await page.waitForTimeout(1500);

  // Try to expand “View More” / “Load more” buttons if present
  try {
    const moreBtns = await page.$$('[aria-label*="more"], [data-testid*="more"], button:has(+*)');
    for (const b of moreBtns) { try { await b.click({ delay: 50 }); } catch(e){} }
    await page.waitForTimeout(800);
  } catch (e) {}

  const scraped = await page.evaluate(() => {
    // Try to capture sections (categories) and items with prices
    const sections = [];
    const candidates = Array.from(document.querySelectorAll('section, div'))
      .filter(el => el.querySelector('h2,h3') && el.querySelectorAll('article,li,[role="listitem"],[data-testid*="item"]').length > 0);

    const money = s => {
      const m = (s || '').match(/\$\s*\d+(?:\.\d{1,2})?/);
      return m ? parseFloat(m[0].replace(/[^0-9.]/g, '')) : null;
    };

    for (const sec of candidates) {
      const heading = (sec.querySelector('h2,h3')?.textContent || '').trim();
      const items = [];
      const rows = sec.querySelectorAll('article,li,[role="listitem"],[data-testid*="item"], .item');

      rows.forEach(row => {
        const name =
          (row.querySelector('h3,h4,strong,[data-testid*="name"],.name')?.textContent || '')
            .replace(/\s+/g, ' ')
            .trim();

        // price may be on the row or in a nested span
        let price = null;
        const priceEl = row.querySelector('[data-testid*="price"], .price, span, div');
        if (priceEl) price = money(priceEl.textContent);
        if (price == null) price = money(row.textContent);

        if (name && price != null) {
          items.push({ name, price });
        }
      });

      if (heading && items.length) {
        sections.push({ category: heading, items });
      }
    }

    // If nothing found (very JS-heavy sites), fallback: collect any “$” lines
    if (!sections.length) {
      const all = [];
      const money = s => {
        const m = (s || '').match(/\$\s*\d+(?:\.\d{1,2})?/);
        return m ? parseFloat(m[0].replace(/[^0-9.]/g, '')) : null;
      };
      document.querySelectorAll('body *').forEach(el => {
        const t = el.textContent?.trim() || '';
        const p = money(t);
        // crude heuristic: names are usually not just the price
        if (p != null && t.length < 120 && /[A-Za-z]/.test(t)) {
          all.push({ name: t.replace(/\s*\$.*$/, '').trim(), price: p });
        }
      });
      if (all.length) sections.push({ category: 'Menu', items: all });
    }

    return sections;
  });

  await browser.close();

  // Flatten + add SKUs
  const items = [];
  scraped.forEach(sec => {
    sec.items.forEach(it => {
      items.push({
        sku: slug(it.name),
        name: it.name,
        price: Number(it.price),
        category: sec.category
      });
    });
  });

  // De-dup by name
  const byName = new Map();
  items.forEach(i => { if (!byName.has(i.name)) byName.set(i.name, i); });
  return Array.from(byName.values());
}

module.exports = async (req, res) => {
  try {
    const items = await fetchMenu();

    // If we still failed, return a tiny fallback so the bot remains usable
    if (!items.length) {
      return res.status(200).json({ items: [
        { sku:'CKTIKKA', name:'Chicken Tikka', price:12.99, category:'Fallback' },
        { sku:'GNAAN',   name:'Garlic Naan',   price: 3.49, category:'Fallback' },
      ], source: 'fallback' });
    }

    res.status(200).json({ items, source: 'live', url: STORE_URL });
  } catch (e) {
    console.error('menu error:', e);
    res.status(200).json({ items: [
      { sku:'CKTIKKA', name:'Chicken Tikka', price:12.99, category:'Fallback' },
      { sku:'GNAAN',   name:'Garlic Naan',   price: 3.49, category:'Fallback' },
    ], source: 'error_fallback' });
  }
};

// api/menu.js
const path = require('path');

function slug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40)
    .toUpperCase();
}

module.exports = (req, res) => {
  try {
    // Load categorized data; flatten to items[]
    let data;
    try {
      data = require('../data/menu_categorized.json');
    } catch (e) {
      data = null;
    }

    let items = [];
    if (data && Array.isArray(data.categories) && data.categories.length) {
      items = data.categories.flatMap(cat =>
        (cat.items || []).map(it => ({
          sku: slug(it.name),
          name: it.name,
          price: Number(it.price),
          category: cat.name
        }))
      );
      return res.status(200).json({ source: 'categorized', items });
    }

    // Fallback if file not found
    items = [
      { sku: 'CHICKEN-TIKKA', name: 'Chicken Tikka', price: 12.99, category: 'Popular Items' },
      { sku: 'GARLIC-NAAN',   name: 'Garlic Naan',   price:  3.49, category: 'Breads' }
    ];
    return res.status(200).json({ source: 'fallback', items });
  } catch (err) {
    console.error('menu error:', err);
    return res.status(200).json({
      source: 'error_fallback',
      items: [
        { sku: 'CHICKEN-TIKKA', name: 'Chicken Tikka', price: 12.99, category: 'Popular Items' },
        { sku: 'GARLIC-NAAN',   name: 'Garlic Naan',   price:  3.49, category: 'Breads' }
      ]
    });
  }
};

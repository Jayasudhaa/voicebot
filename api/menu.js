// Returns your menu to Vapi's get_menu tool
module.exports = (req, res) => {
  const MENU = [
    { sku:'CKTIKKA', name:'Chicken Tikka', price:12.99, options:{spice:['mild','medium','hot']} },
    { sku:'GNAAN',   name:'Garlic Naan',   price: 3.49 }
  ];
  res.status(200).json({ items: MENU });
};

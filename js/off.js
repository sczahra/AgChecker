const OFF_BASE = 'https://world.openfoodfacts.org';

function simplifyOFFProduct(p){
  const ingredients = p.ingredients_text || p.ingredients_text_en || p.ingredients_text_fr || '';
  return {
    barcode: p.code || p._id || '',
    name: p.product_name || p.generic_name || '',
    brand: (Array.isArray(p.brands_tags) && p.brands_tags[0]) || p.brands || '',
    ingredients_raw: ingredients,
    last_updated: p.last_modified_t ? new Date(p.last_modified_t*1000).toISOString() : (p.last_modified_t_dt || new Date().toISOString())
  };
}

export async function fetchOFFByBarcode(barcode){
  try{
    const url = `${OFF_BASE}/api/v2/product/${encodeURIComponent(barcode)}.json`;
    const res = await fetch(url);
    if(!res.ok) return null;
    const j = await res.json();
    if(j && j.product){
      return simplifyOFFProduct(j.product);
    }
    return null;
  }catch(e){
    console.warn('OFF barcode fetch failed', e);
    return null;
  }
}

export async function searchOFFByText(q, limit=10){
  try{
    const url = `${OFF_BASE}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=${limit}`;
    const res = await fetch(url);
    if(!res.ok) return [];
    const j = await res.json();
    if(!j.products) return [];
    return j.products.map(simplifyOFFProduct).filter(p=>p.barcode);
  }catch(e){
    console.warn('OFF search failed', e);
    return [];
  }
}

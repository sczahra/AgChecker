const OFF_BASE = 'https://world.openfoodfacts.org';

function chooseDisplayField(preferred, fallback=''){
  return (preferred || fallback || '').trim();
}

function simplifyOFFProduct(p, options={}){
  const language = options.displayLanguage || 'auto';
  const englishOnly = language === 'en';

  const ingredientsSource = chooseDisplayField(
    p.ingredients_text,
    p.ingredients_text_en || p.ingredients_text_fr || ''
  );

  const ingredientsDisplay = englishOnly
    ? chooseDisplayField(p.ingredients_text_en, ingredientsSource)
    : chooseDisplayField(p.ingredients_text, p.ingredients_text_en || p.ingredients_text_fr || '');

  const name = englishOnly
    ? chooseDisplayField(p.product_name_en, p.product_name || p.generic_name_en || p.generic_name || '')
    : chooseDisplayField(p.product_name, p.product_name_en || p.generic_name || p.generic_name_en || '');

  const genericName = englishOnly
    ? chooseDisplayField(p.generic_name_en, p.generic_name || '')
    : chooseDisplayField(p.generic_name, p.generic_name_en || '');

  return {
    barcode: p.code || p._id || '',
    name: name || genericName || '',
    brand: (Array.isArray(p.brands_tags) && p.brands_tags[0]) || p.brands || '',
    ingredients_raw: ingredientsSource,
    ingredients_display: ingredientsDisplay,
    ingredients_language: p.ingredients_text_en ? 'en' : (p.lang || ''),
    english_available: !!p.ingredients_text_en,
    last_updated: p.last_modified_t ? new Date(p.last_modified_t*1000).toISOString() : (p.last_modified_t_dt || new Date().toISOString())
  };
}

export async function fetchOFFByBarcode(barcode, options={}){
  try{
    const params = new URLSearchParams();
    if(options.displayLanguage === 'en') params.set('lc', 'en');
    const qs = params.toString();
    const url = `${OFF_BASE}/api/v2/product/${encodeURIComponent(barcode)}.json${qs ? `?${qs}` : ''}`;
    const res = await fetch(url);
    if(!res.ok) return null;
    const j = await res.json();
    if(j && j.product){
      return simplifyOFFProduct(j.product, options);
    }
    return null;
  }catch(e){
    console.warn('OFF barcode fetch failed', e);
    return null;
  }
}

export async function searchOFFByText(q, limit=10, options={}){
  try{
    const params = new URLSearchParams({
      search_terms: q,
      search_simple: '1',
      action: 'process',
      json: '1',
      page_size: String(limit)
    });
    if(options.displayLanguage === 'en') params.set('lc', 'en');
    const url = `${OFF_BASE}/cgi/search.pl?${params.toString()}`;
    const res = await fetch(url);
    if(!res.ok) return [];
    const j = await res.json();
    if(!j.products) return [];
    return j.products.map(p => simplifyOFFProduct(p, options)).filter(p=>p.barcode);
  }catch(e){
    console.warn('OFF search failed', e);
    return [];
  }
}

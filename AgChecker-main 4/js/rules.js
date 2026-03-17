let RULES = null;

export async function loadRules(){
  if(RULES) return RULES;
  const res = await fetch('/rules.json');
  RULES = await res.json();
  return RULES;
}

function normalize(txt){
  return (txt || '')
    .toLowerCase()
    .replace(/[\(\)\[\]\.\;]/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function containsAny(txt, list){
  const hits = [];
  for(const raw of list){
    const term = raw.toLowerCase();
    // word-boundary-ish search
    const re = new RegExp(`\\b${escapeRegExp(term)}\\b`,'i');
    if(re.test(txt)) hits.push(raw);
  }
  return hits;
}

function escapeRegExp(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function rateProduct(ingredientsRaw, rules, opts){
  const { dairySensitive=false, strictMode=false } = opts || {};
  const txt = normalize(ingredientsRaw);
  const aliasHits = [];
  // expand alias_map
  if(rules.alias_map){
    for(const [k,v] of Object.entries(rules.alias_map)){
      const re = new RegExp(`\\b${escapeRegExp(k)}\\b`,'i');
      if(re.test(txt)) aliasHits.push(v);
    }
  }
  const avoidHits = new Set([...containsAny(txt, rules.avoid), ...aliasHits]);
  if(avoidHits.size>0){
    return {verdict:'AVOID', reasons:[...avoidHits]};
  }
  const dairyHits = containsAny(txt, rules.dairy_aliases || []);
  const cautionHits = containsAny(txt, rules.caution || []);
  if(dairySensitive && dairyHits.length>0){
    return {verdict:'AVOID', reasons:dairyHits};
  }
  if(cautionHits.length>0 || dairyHits.length>0){
    return {verdict: strictMode ? 'AVOID' : 'CAUTION', reasons:[...cautionHits, ...(!dairySensitive ? dairyHits : [])]};
  }
  return {verdict:'OK', reasons:[]};
}

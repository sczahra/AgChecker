export async function openDB(){
  const db = new Dexie('alpha_gal_db');
  db.version(1).stores({
    products: 'barcode, name, brand, last_updated',
    metadata: 'key',
    overrides: 'barcode'
  });
  return db;
}

import { openDB } from './db.js';
import { loadRules, rateProduct } from './rules.js';
import { fetchOFFByBarcode, searchOFFByText } from './off.js';
import { APP_VERSION, RELEASE_DATE } from './version.js';

const ZXING_CDN = 'https://unpkg.com/@zxing/browser@0.1.5/esm/index.js';
const QUAGGA_CDN = 'https://cdn.jsdelivr.net/npm/@ericblade/quagga2/dist/quagga.min.js';
const SCAN_HINTS = 'EAN-13, UPC, CODE-128, ITF';
const CACHE_PREFIX = 'ag-app-shell-';

const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.tabpanel');
tabs.forEach(btn => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab));
});

function activateTab(tabName){
  tabs.forEach(b=>b.classList.toggle('active', b.dataset.tab===tabName));
  panels.forEach(p=>p.classList.toggle('active', p.id===tabName));
}

const statusEl = document.getElementById('status');
const versionTextEl = document.getElementById('versionText');
const aboutVersionEl = document.getElementById('aboutVersion');
const footerVersionLineEl = document.getElementById('footerVersionLine');
const dairyToggle = document.getElementById('dairyToggle');
const strictToggle = document.getElementById('strictToggle');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const searchLoading = document.getElementById('searchLoading');
const resultsList = document.getElementById('resultsList');
const historyList = document.getElementById('historyList');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const forceRefreshBtn = document.getElementById('forceRefreshBtn');
const barcodeInput = document.getElementById('barcodeInput');
const barcodeLookupBtn = document.getElementById('barcodeLookupBtn');
const barcodeImageInput = document.getElementById('barcodeImageInput');
const barcodeImageBtn = document.getElementById('barcodeImageBtn');
const imageScanStatus = document.getElementById('imageScanStatus');

let db, rules;
let codeReader = null;
let controls = null;
let activeStream = null;

async function init(){
  db = await openDB();
  rules = await loadRules();
  const meta = await db.metadata.get('rules_version');
  if(!meta || String(meta.value) !== String(rules.version)){
    await db.metadata.put({key:'rules_version', value: String(rules.version)});
  }

  versionTextEl.textContent = `Version ${APP_VERSION}`;
  aboutVersionEl.textContent = `Version ${APP_VERSION} · Released ${RELEASE_DATE}`;
  if(footerVersionLineEl){
    footerVersionLineEl.innerHTML = `AG Checker v${APP_VERSION} • Created by <a href="https://github.com/sczahra" target="_blank" rel="noopener noreferrer">Seth Zahra</a> • Data from <a href="https://world.openfoodfacts.org/" target="_blank" rel="noopener noreferrer">Open Food Facts</a>`;
  }

  await handleVersionUpdate();

  const dairy = await db.metadata.get('dairy_sensitive');
  const strict = await db.metadata.get('strict_mode');
  dairyToggle.checked = !!(dairy && dairy.value === 'true');
  strictToggle.checked = !!(strict && strict.value === 'true');

  dairyToggle.addEventListener('change', async () => {
    await db.metadata.put({key:'dairy_sensitive', value: dairyToggle.checked ? 'true' : 'false'});
    rerateVisible();
    renderHistory();
  });
  strictToggle.addEventListener('change', async () => {
    await db.metadata.put({key:'strict_mode', value: strictToggle.checked ? 'true' : 'false'});
    rerateVisible();
    renderHistory();
  });

  searchBtn.addEventListener('click', () => doSearch());
  searchInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') doSearch(); });
  forceRefreshBtn.addEventListener('click', refreshCachedProducts);
  barcodeLookupBtn.addEventListener('click', useBarcodeInput);
  barcodeInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') useBarcodeInput(); });
  barcodeImageBtn.addEventListener('click', decodeUploadedBarcode);
  barcodeImageInput.addEventListener('change', () => { imageScanStatus.textContent = ''; });
  clearHistoryBtn?.addEventListener('click', clearHistory);
  historyList?.addEventListener('click', onHistoryClick);

  updateOnLaunch();
  updateOnlineStatus();
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);

  await registerServiceWorker();
  await renderHistory();
}
init();

async function handleVersionUpdate(){
  const seen = await db.metadata.get('app_version');
  if(!seen || seen.value !== APP_VERSION){
    if('caches' in window){
      try{
        const keys = await caches.keys();
        await Promise.all(keys.map(k => k.startsWith(CACHE_PREFIX) && !k.endsWith(APP_VERSION) ? caches.delete(k) : null));
      }catch(e){ console.warn('Cache cleanup failed', e); }
    }
    await db.metadata.put({ key: 'app_version', value: APP_VERSION });
    await db.metadata.put({ key: 'last_updated_notice', value: `${APP_VERSION}|${Date.now()}` });
    statusEl.textContent = `Updated to v${APP_VERSION}`;
  }
}

async function registerServiceWorker(){
  if(!('serviceWorker' in navigator)) return;
  try{
    const reg = await navigator.serviceWorker.register('/sw.js');
    try{ await reg.update(); }catch(_e){}
    if(reg.waiting){
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      setTimeout(() => window.location.reload(), 500);
    }
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if(!window.__agReloaded){
        window.__agReloaded = true;
        window.location.reload();
      }
    });
  }catch(e){ console.warn('SW failed', e); }
}

function updateOnlineStatus(){
  const base = navigator.onLine ? 'Online' : 'Offline';
  if(!statusEl.textContent || statusEl.textContent === 'Online' || statusEl.textContent === 'Offline'){
    statusEl.textContent = base;
  }
}

function setBusy(isBusy, text='Searching…'){
  if(searchLoading){
    searchLoading.hidden = !isBusy;
    const span = searchLoading.querySelector('span:last-child');
    if(span) span.textContent = text;
  }
  searchBtn.disabled = isBusy;
  barcodeLookupBtn.disabled = isBusy;
}

async function rerateVisible(){
  const items = resultsList.querySelectorAll('.result-item[data-barcode]');
  const dairy = dairyToggle.checked;
  const strict = strictToggle.checked;
  for(const li of items){
    const barcode = li.dataset.barcode;
    const product = await db.products.get(barcode);
    if(product){
      const verdict = rateProduct(product.ingredients_raw || '', rules, { dairySensitive: dairy, strictMode: strict });
      renderVerdict(li, verdict, product.ingredients_raw || '');
    }
  }
}

async function updateOnLaunch(){
  const recent = await db.products.orderBy('last_updated').reverse().limit(20).toArray();
  if(recent.length){
    clearResults();
    recent.slice(0,5).forEach(appendResult);
  } else {
    appendMessage('Search for a product or scan a barcode to get started.');
  }
}

async function refreshCachedProducts(){
  if(!navigator.onLine){ alert('You are offline.'); return; }
  const all = await db.products.toArray();
  let updated = 0;
  for(const p of all){
    const fresh = await fetchOFFByBarcode(p.barcode);
    if(fresh){
      await db.products.put(fresh);
      updated++;
    }
  }
  alert(`Refreshed ${updated} products.`);
  rerateVisible();
  renderHistory();
}

async function doSearch(inputValue, source='search'){
  const q = (typeof inputValue === 'string' ? inputValue : (searchInput.value || '')).trim();
  if(!q) return;
  setSearchValue(q);
  clearResults();
  setBusy(true, /^\d{8,14}$/.test(q) ? 'Looking up barcode…' : 'Searching products…');

  let historyPayload = { type: source, query: q, barcode: /^\d{8,14}$/.test(q) ? q : '', resultCount: 0 };

  try{
    if(/^\d{8,14}$/.test(q)){
      const local = await db.products.get(q);
      if(local){
        appendResult(local);
        historyPayload = { ...historyPayload, productName: local.name || '', barcode: local.barcode || q, resultCount: 1 };
        if(navigator.onLine){
          const fresh = await fetchOFFByBarcode(q);
          if(fresh){
            await db.products.put(fresh);
            replaceResult(q, fresh);
            historyPayload = { ...historyPayload, productName: fresh.name || local.name || '', barcode: fresh.barcode || q, resultCount: 1 };
          }
        }
      } else {
        const fetched = await fetchOFFByBarcode(q);
        if(fetched){
          await db.products.put(fetched);
          appendResult(fetched);
          historyPayload = { ...historyPayload, productName: fetched.name || '', barcode: fetched.barcode || q, resultCount: 1 };
        }
        else {
          appendMessage(`No product found for barcode ${q}.`);
        }
      }
    } else {
      const list = await searchOFFByText(q, 10);
      historyPayload = { ...historyPayload, resultCount: list.length, productName: list[0]?.name || '' };
      if(list.length===0){ appendMessage('No matches.'); }
      for(const p of list){
        await db.products.put(p);
        appendResult(p);
      }
    }
  } finally {
    await saveHistoryEntry(historyPayload);
    await renderHistory();
    setBusy(false);
  }
}

function clearResults(){ resultsList.innerHTML=''; }
function setSearchValue(value){
  searchInput.value = value;
  if(barcodeInput) barcodeInput.value = value;
}

function useBarcodeInput(){
  const value = (barcodeInput.value || '').trim();
  if(!value){
    imageScanStatus.textContent = 'Paste a barcode first.';
    return;
  }
  activateTab('results');
  doSearch(value, 'barcode_paste');
}

function appendMessage(text){
  const li = document.createElement('li');
  li.className='result-item';
  li.innerHTML = `<div class="meta"><div class="name">${text}</div></div>`;
  resultsList.appendChild(li);
}

function renderVerdict(li, verdict, ingredientsRaw){
  const badge = li.querySelector('.badge');
  badge.dataset.verdict = verdict.verdict;
  const verdictLabels = { OK: 'SAFE', CAUTION: 'CAUTION', AVOID: 'AVOID' };
  badge.textContent = verdictLabels[verdict.verdict] || verdict.verdict;
  const ing = li.querySelector('.ingredients');
  ing.textContent = ingredientsRaw || '(no ingredients listed)';
  const reasonsUL = li.querySelector('.reasons');
  reasonsUL.innerHTML = '';
  if(verdict.reasons && verdict.reasons.length){
    verdict.reasons.forEach(r=>{
      const liR = document.createElement('li');
      liR.textContent = r;
      reasonsUL.appendChild(liR);
    });
  } else {
    const liR = document.createElement('li');
    liR.textContent = verdict.verdict==='OK' ? 'No risky ingredients found.' : 'No specific matches (rule-based caution).';
    reasonsUL.appendChild(liR);
  }
}

function productSubtitle(p){
  const parts = [];
  if(p.brand) parts.push(p.brand);
  if(p.barcode) parts.push('#'+p.barcode);
  if(p.last_updated) parts.push(new Date(p.last_updated).toLocaleDateString());
  return parts.join(' · ');
}

function appendResult(p){
  const tpl = document.getElementById('resultItemTpl');
  const li = tpl.content.firstElementChild.cloneNode(true);
  li.dataset.barcode = p.barcode;
  li.querySelector('.name').textContent = p.name || '(no name)';
  li.querySelector('.sub').textContent = productSubtitle(p);
  const verdict = rateProduct(p.ingredients_raw || '', rules, { dairySensitive: dairyToggle.checked, strictMode: strictToggle.checked });
  renderVerdict(li, verdict, p.ingredients_raw || '');
  resultsList.appendChild(li);
}

function replaceResult(barcode, p){
  const li = resultsList.querySelector(`.result-item[data-barcode="${barcode}"]`);
  if(!li) return;
  li.querySelector('.name').textContent = p.name || '(no name)';
  li.querySelector('.sub').textContent = productSubtitle(p);
  const verdict = rateProduct(p.ingredients_raw || '', rules, { dairySensitive: dairyToggle.checked, strictMode: strictToggle.checked });
  renderVerdict(li, verdict, p.ingredients_raw || '');
}

async function saveHistoryEntry(entry){
  if(!db.history || !entry?.query) return;
  await db.history.add({
    ts: Date.now(),
    favorite: false,
    type: entry.type || 'search',
    query: entry.query,
    barcode: entry.barcode || '',
    productName: entry.productName || '',
    resultCount: typeof entry.resultCount === 'number' ? entry.resultCount : 0
  });
}

async function renderHistory(){
  if(!historyList || !db.history) return;
  const entries = await db.history.orderBy('ts').reverse().toArray();
  historyList.innerHTML = '';
  if(!entries.length){
    historyList.innerHTML = '<li class="history-empty">No searches or scans saved yet.</li>';
    return;
  }
  for(const item of entries){
    const li = document.createElement('li');
    li.className = 'history-item';
    li.dataset.id = item.id;
    const label = item.productName ? `${escapeHtml(item.productName)}` : `${escapeHtml(item.query)}`;
    const detailParts = [];
    detailParts.push(item.type === 'camera' ? 'Camera scan' : item.type === 'barcode_paste' ? 'Barcode paste' : item.type === 'image' ? 'Image barcode' : 'Search');
    if(item.query && item.productName && item.query !== item.productName) detailParts.push(`Query: ${escapeHtml(item.query)}`);
    if(item.barcode) detailParts.push(`#${escapeHtml(item.barcode)}`);
    if(typeof item.resultCount === 'number') detailParts.push(`${item.resultCount} result${item.resultCount===1?'':'s'}`);
    detailParts.push(new Date(item.ts).toLocaleString());
    li.innerHTML = `
      <div class="history-main">
        <div class="history-title">${label}</div>
        <div class="history-sub">${detailParts.join(' · ')}</div>
      </div>
      <div class="history-actions">
        <button class="icon-btn ${item.favorite ? 'favorited' : ''}" data-action="favorite" title="Favorite">${item.favorite ? '★' : '☆'}</button>
        <button class="secondary-btn" data-action="rerun">Run again</button>
        <button class="secondary-btn danger-btn" data-action="delete">Delete</button>
      </div>
    `;
    historyList.appendChild(li);
  }
}

async function onHistoryClick(event){
  const button = event.target.closest('button[data-action]');
  if(!button) return;
  const row = button.closest('.history-item');
  const id = Number(row?.dataset.id);
  if(!id) return;
  const item = await db.history.get(id);
  if(!item) return;
  const action = button.dataset.action;
  if(action === 'favorite'){
    await db.history.update(id, { favorite: !item.favorite });
    renderHistory();
    return;
  }
  if(action === 'delete'){
    await db.history.delete(id);
    renderHistory();
    return;
  }
  if(action === 'rerun'){
    activateTab('results');
    await doSearch(item.barcode || item.query, item.type || 'search');
  }
}

async function clearHistory(){
  if(!db.history) return;
  if(!confirm('Clear all saved searches and scans?')) return;
  await db.history.clear();
  renderHistory();
}

function escapeHtml(value=''){
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const startBtn = document.getElementById('startScanBtn');
const stopBtn = document.getElementById('stopScanBtn');
const video = document.getElementById('video');
const scanStatus = document.getElementById('scanStatus');

startBtn.addEventListener('click', startScanner);
stopBtn.addEventListener('click', () => stopScanner('Stopped.'));

async function startScanner(){
  startBtn.disabled = true;
  scanStatus.textContent = 'Starting camera…';

  if(!window.isSecureContext){
    scanStatus.textContent = 'Camera requires HTTPS or localhost.';
    startBtn.disabled = false;
    return;
  }
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    scanStatus.textContent = 'This browser does not support camera scanning.';
    startBtn.disabled = false;
    return;
  }

  try{
    stopScanner();

    activeStream = await requestRearCameraStream();
    video.srcObject = activeStream;
    await video.play();

    const mod = await import(ZXING_CDN);
    codeReader = new mod.BrowserMultiFormatReader(undefined, {
      delayBetweenScanAttempts: 250,
      delayBetweenScanSuccess: 750
    });

    controls = await codeReader.decodeFromStream(activeStream, video, async (result, err) => {
      if(result){
        const text = result.getText();
        scanStatus.textContent = `Scanned: ${text}`;
        setSearchValue(text);
        stopScanner('Barcode captured.');
        activateTab('results');
        await doSearch(text, 'camera');
        return;
      }
      if(err && err.name && err.name !== 'NotFoundException'){
        console.warn('Scan warning:', err);
      }
    });

    stopBtn.disabled = false;
    scanStatus.textContent = `Point camera at barcode (${SCAN_HINTS}).`;
  }catch(e){
    console.error(e);
    stopScanner();
    scanStatus.textContent = scannerErrorMessage(e);
    startBtn.disabled = false;
  }
}

function stopScanner(message=''){
  if(controls && typeof controls.stop === 'function') controls.stop();
  controls = null;

  if(codeReader && typeof codeReader.reset === 'function') codeReader.reset();
  codeReader = null;

  if(activeStream) activeStream.getTracks().forEach(track => track.stop());
  activeStream = null;

  if(video.srcObject) video.srcObject = null;
  video.pause();

  stopBtn.disabled = true;
  startBtn.disabled = false;
  if(message) scanStatus.textContent = message;
}

async function requestRearCameraStream(){
  const preferredConstraints = [
    { video: { facingMode: { ideal: 'environment' } }, audio: false },
    { video: { facingMode: 'environment' }, audio: false },
    { video: true, audio: false }
  ];

  let lastError = null;
  for(const constraints of preferredConstraints){
    try{
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const track = stream.getVideoTracks()[0];
      if(track && typeof track.getCapabilities === 'function'){
        const capabilities = track.getCapabilities();
        if(capabilities.focusMode && capabilities.focusMode.includes('continuous')){
          try{ await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); }catch(_e){}
        }
      }
      return stream;
    }catch(err){
      lastError = err;
    }
  }
  throw lastError || new Error('Unable to access camera.');
}

async function decodeUploadedBarcode(){
  const file = barcodeImageInput?.files?.[0];
  if(!file){
    imageScanStatus.textContent = 'Choose a barcode image first.';
    return;
  }

  imageScanStatus.textContent = 'Reading barcode from image…';
  barcodeImageBtn.disabled = true;

  try{
    const barcode = await decodeBarcodeFromImage(file);
    if(!barcode){
      imageScanStatus.textContent = 'Could not read a barcode from that image. Try a closer, brighter photo.';
      return;
    }
    imageScanStatus.textContent = `Read barcode: ${barcode}`;
    setSearchValue(barcode);
    activateTab('results');
    await doSearch(barcode, 'image');
  }catch(error){
    console.error(error);
    imageScanStatus.textContent = 'Image barcode reading failed. Try another photo or paste the barcode instead.';
  }finally{
    barcodeImageBtn.disabled = false;
  }
}

async function decodeBarcodeFromImage(file){
  if('BarcodeDetector' in window){
    try{
      const detector = new window.BarcodeDetector({ formats: ['ean_13','ean_8','upc_a','upc_e','code_128','code_39','codabar','itf'] });
      const bitmap = await createImageBitmap(file);
      const detected = await detector.detect(bitmap);
      if(bitmap && typeof bitmap.close === 'function') bitmap.close();
      const value = detected?.[0]?.rawValue?.trim();
      if(value) return value;
    }catch(_error){}
  }

  const Quagga = await loadQuagga();
  return await new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    Quagga.decodeSingle({
      src: objectUrl,
      numOfWorkers: 0,
      locate: true,
      inputStream: { size: 1200 },
      decoder: {
        readers: [
          'ean_reader',
          'ean_8_reader',
          'upc_reader',
          'upc_e_reader',
          'code_128_reader',
          'code_39_reader',
          'codabar_reader',
          'i2of5_reader'
        ]
      }
    }, result => {
      URL.revokeObjectURL(objectUrl);
      const value = result?.codeResult?.code?.trim();
      if(value) resolve(value);
      else resolve(null);
    });
  });
}

let quaggaPromise = null;
function loadQuagga(){
  if(window.Quagga) return Promise.resolve(window.Quagga);
  if(quaggaPromise) return quaggaPromise;
  quaggaPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = QUAGGA_CDN;
    script.async = true;
    script.onload = () => resolve(window.Quagga);
    script.onerror = () => reject(new Error('Failed to load image barcode reader.'));
    document.head.appendChild(script);
  });
  return quaggaPromise;
}

function scannerErrorMessage(error){
  if(!error) return 'Camera failed. Check permissions and try again.';
  if(error.name === 'NotAllowedError') return 'Camera permission was denied. Allow camera access and try again.';
  if(error.name === 'NotFoundError') return 'No camera was found on this device.';
  if(error.name === 'NotReadableError') return 'Camera is busy in another app or browser tab.';
  if(error.name === 'OverconstrainedError') return 'Camera settings were not supported. Please try again.';
  return 'Camera failed. Check permissions and try again.';
}

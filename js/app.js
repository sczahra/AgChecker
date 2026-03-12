import { openDB } from './db.js';
import { loadRules, rateProduct } from './rules.js';
import { fetchOFFByBarcode, searchOFFByText } from './off.js';
import { APP_VERSION, RELEASE_DATE } from './version.js';

const ZXING_CDN = 'https://unpkg.com/@zxing/browser@0.1.5/esm/index.js';
const SCAN_HINTS = 'EAN-13, UPC, CODE-128, ITF';
const DISPLAY_LANGUAGE_OPTIONS = {
  auto: 'Auto',
  en: 'English preferred'
};

const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.tabpanel');
tabs.forEach(btn => {
  btn.addEventListener('click', () => {
    tabs.forEach(b=>b.classList.remove('active'));
    panels.forEach(p=>p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

const statusEl = document.getElementById('status');
const versionTextEl = document.getElementById('versionText');
const aboutVersionEl = document.getElementById('aboutVersion');
const dairyToggle = document.getElementById('dairyToggle');
const strictToggle = document.getElementById('strictToggle');
const languageSelect = document.getElementById('languageSelect');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const resultsList = document.getElementById('resultsList');
const forceRefreshBtn = document.getElementById('forceRefreshBtn');
const sourceRegionNote = document.getElementById('sourceRegionNote');

let db, rules;
let codeReader = null;
let controls = null;
let activeStream = null;
let barcodeDetector = null;
let scanLoopToken = 0;

async function init(){
  db = await openDB();
  rules = await loadRules();
  const meta = await db.metadata.get('rules_version');
  if(!meta || String(meta.value) !== String(rules.version)){
    await db.metadata.put({key:'rules_version', value: String(rules.version)});
  }

  versionTextEl.textContent = `Version ${APP_VERSION}`;
  aboutVersionEl.textContent = `Version ${APP_VERSION} · Released ${RELEASE_DATE}`;
  if(sourceRegionNote){
    sourceRegionNote.textContent = 'Current data source region: global Open Food Facts catalog (not region-limited).';
  }

  const dairy = await db.metadata.get('dairy_sensitive');
  const strict = await db.metadata.get('strict_mode');
  const lang = await db.metadata.get('display_language');
  dairyToggle.checked = !!(dairy && dairy.value === 'true');
  strictToggle.checked = !!(strict && strict.value === 'true');
  languageSelect.value = (lang && DISPLAY_LANGUAGE_OPTIONS[lang.value]) ? lang.value : 'en';

  dairyToggle.addEventListener('change', async () => {
    await db.metadata.put({key:'dairy_sensitive', value: dairyToggle.checked ? 'true' : 'false'});
    rerateVisible();
  });
  strictToggle.addEventListener('change', async () => {
    await db.metadata.put({key:'strict_mode', value: strictToggle.checked ? 'true' : 'false'});
    rerateVisible();
  });
  languageSelect.addEventListener('change', async () => {
    await db.metadata.put({key:'display_language', value: languageSelect.value});
    await rerenderVisibleForLanguage();
  });

  searchBtn.addEventListener('click', doSearch);
  searchInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') doSearch(); });
  forceRefreshBtn.addEventListener('click', refreshCachedProducts);

  updateOnLaunch();

  updateOnlineStatus();
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);

  if('serviceWorker' in navigator){
    try{ await navigator.serviceWorker.register('/sw.js'); }catch(e){ console.warn('SW failed', e); }
  }
}
init();

function updateOnlineStatus(){
  statusEl.textContent = navigator.onLine ? 'Online' : 'Offline';
}

function currentDisplayLanguage(){
  return languageSelect?.value || 'en';
}

async function rerenderVisibleForLanguage(){
  const items = resultsList.querySelectorAll('.result-item[data-barcode]');
  for(const li of items){
    const barcode = li.dataset.barcode;
    if(!barcode) continue;
    const fresh = await fetchOFFByBarcode(barcode, { displayLanguage: currentDisplayLanguage() });
    if(fresh){
      await db.products.put(fresh);
      replaceResult(barcode, fresh);
    }
  }
}

async function rerateVisible(){
  const items = resultsList.querySelectorAll('.result-item');
  const dairy = dairyToggle.checked;
  const strict = strictToggle.checked;
  for(const li of items){
    const barcode = li.dataset.barcode;
    const product = await db.products.get(barcode);
    if(product){
      const verdict = rateProduct(product.ingredients_raw || '', rules, { dairySensitive: dairy, strictMode: strict });
      renderVerdict(li, verdict, product);
    }
  }
}

async function updateOnLaunch(){
  const cached = await db.products.toArray();
  if(!navigator.onLine || cached.length===0) return;
  let updated = 0;
  for(const p of cached.slice(0, 100)){
    const fresh = await fetchOFFByBarcode(p.barcode, { displayLanguage: currentDisplayLanguage() });
    if(fresh && fresh.last_updated !== p.last_updated){
      await db.products.put(fresh);
      updated++;
    }
  }
  if(updated>0){
    statusEl.textContent = `Updated ✅ (${updated} products)`;
    setTimeout(updateOnlineStatus, 3000);
  }
}

async function refreshCachedProducts(){
  if(!navigator.onLine){ alert('You are offline.'); return; }
  const cached = await db.products.toArray();
  let updated = 0;
  for(const p of cached){
    const fresh = await fetchOFFByBarcode(p.barcode, { displayLanguage: currentDisplayLanguage() });
    if(fresh && fresh.last_updated !== p.last_updated){
      await db.products.put(fresh);
      updated++;
    }
  }
  alert(`Refreshed ${updated} products.`);
  rerateVisible();
}

async function doSearch(){
  const q = (searchInput.value || '').trim();
  if(!q) return;
  clearResults();
  const opts = { displayLanguage: currentDisplayLanguage() };
  if(/^\d{8,14}$/.test(q)){
    const local = await db.products.get(q);
    if(local){
      appendResult(local);
      if(navigator.onLine){
        const fresh = await fetchOFFByBarcode(q, opts);
        if(fresh){ await db.products.put(fresh); replaceResult(q, fresh); }
      }
    } else {
      const fetched = await fetchOFFByBarcode(q, opts);
      if(fetched){ await db.products.put(fetched); appendResult(fetched); }
      else appendMessage(`No product found for barcode ${q}.`);
    }
  } else {
    const list = await searchOFFByText(q, 10, opts);
    if(list.length===0){ appendMessage('No matches.'); return; }
    for(const p of list){
      await db.products.put(p);
      appendResult(p);
    }
  }
}

function clearResults(){ resultsList.innerHTML=''; }
function appendMessage(text){
  const li = document.createElement('li');
  li.className='result-item';
  li.innerHTML = `<div class="meta"><div class="name">${text}</div></div>`;
  resultsList.appendChild(li);
}

function renderVerdict(li, verdict, product){
  const badge = li.querySelector('.badge');
  badge.dataset.verdict = verdict.verdict;
  const verdictLabels = { OK: 'SAFE', CAUTION: 'CAUTION', AVOID: 'AVOID' };
  badge.textContent = verdictLabels[verdict.verdict] || verdict.verdict;
  const ing = li.querySelector('.ingredients');
  const ingredientsText = product.ingredients_display || product.ingredients_raw || '(no ingredients listed)';
  ing.textContent = ingredientsText;

  let languageNote = li.querySelector('.language-note');
  if(!languageNote){
    languageNote = document.createElement('div');
    languageNote.className = 'language-note';
    ing.insertAdjacentElement('afterend', languageNote);
  }
  if(currentDisplayLanguage() === 'en' && product.english_available === false){
    languageNote.textContent = 'English translation was not available for this product, so the original label text is shown.';
  } else if(currentDisplayLanguage() === 'auto' && product.ingredients_language && product.ingredients_language !== 'en'){
    languageNote.textContent = 'Showing original label language from Open Food Facts.';
  } else {
    languageNote.textContent = '';
  }

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
  renderVerdict(li, verdict, p);
  resultsList.appendChild(li);
}

function replaceResult(barcode, p){
  const li = resultsList.querySelector(`.result-item[data-barcode="${barcode}"]`);
  if(!li) return;
  li.querySelector('.name').textContent = p.name || '(no name)';
  li.querySelector('.sub').textContent = productSubtitle(p);
  const verdict = rateProduct(p.ingredients_raw || '', rules, { dairySensitive: dairyToggle.checked, strictMode: strictToggle.checked });
  renderVerdict(li, verdict, p);
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
    video.setAttribute('playsinline', 'true');
    video.muted = true;
    await waitForVideoReady(video);

    if('BarcodeDetector' in window){
      await startNativeScanner();
      stopBtn.disabled = false;
      scanStatus.textContent = `Point camera at barcode (${SCAN_HINTS}).`;
      return;
    }

    const mod = await import(ZXING_CDN);
    codeReader = new mod.BrowserMultiFormatReader(undefined, {
      delayBetweenScanAttempts: 300,
      delayBetweenScanSuccess: 900
    });

    const deviceId = activeStream.getVideoTracks?.()[0]?.getSettings?.().deviceId;
    controls = await codeReader.decodeFromVideoDevice(deviceId, video, (result, err) => {
      if(result){
        onBarcodeDetected(result.getText());
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

async function startNativeScanner(){
  barcodeDetector = new window.BarcodeDetector({ formats: ['ean_13','ean_8','upc_a','upc_e','code_128','itf'] });
  scanLoopToken += 1;
  const token = scanLoopToken;

  const scan = async () => {
    if(token !== scanLoopToken || !barcodeDetector || !activeStream) return;
    try{
      if(video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA){
        const barcodes = await barcodeDetector.detect(video);
        if(barcodes && barcodes.length){
          const raw = barcodes[0].rawValue || barcodes[0].displayValue;
          if(raw){
            onBarcodeDetected(raw);
            return;
          }
        }
      }
    }catch(err){
      console.warn('Native barcode detector warning:', err);
    }
    requestAnimationFrame(scan);
  };
  requestAnimationFrame(scan);
}

function onBarcodeDetected(text){
  scanStatus.textContent = `Scanned: ${text}`;
  searchInput.value = text;
  stopScanner('Barcode captured.');
  doSearch();
}

function stopScanner(message=''){
  scanLoopToken += 1;
  barcodeDetector = null;

  if(controls && typeof controls.stop === 'function'){
    controls.stop();
  }
  controls = null;

  if(codeReader && typeof codeReader.reset === 'function'){
    codeReader.reset();
  }
  codeReader = null;

  if(activeStream){
    activeStream.getTracks().forEach(track => track.stop());
  }
  activeStream = null;

  if(video.srcObject){
    video.srcObject = null;
  }
  try{ video.pause(); }catch(_e){}

  stopBtn.disabled = true;
  startBtn.disabled = false;
  if(message) scanStatus.textContent = message;
}

async function requestRearCameraStream(){
  const isiPhone = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const preferredConstraints = isiPhone ? [
    { video: { facingMode: { exact: 'environment' } }, audio: false },
    { video: { facingMode: { ideal: 'environment' } }, audio: false },
    { video: true, audio: false }
  ] : [
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

function waitForVideoReady(el){
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = () => { if(!settled){ settled = true; cleanup(); resolve(); } };
    const fail = (err) => { if(!settled){ settled = true; cleanup(); reject(err); } };
    const onLoaded = async () => {
      try{
        await el.play();
        setTimeout(done, 250);
      }catch(err){
        fail(err);
      }
    };
    const cleanup = () => {
      el.removeEventListener('loadedmetadata', onLoaded);
      el.removeEventListener('canplay', onLoaded);
    };
    el.addEventListener('loadedmetadata', onLoaded, { once: true });
    el.addEventListener('canplay', onLoaded, { once: true });
    setTimeout(() => {
      if(el.readyState >= HTMLMediaElement.HAVE_METADATA){
        onLoaded();
      }
    }, 50);
    setTimeout(() => fail(new Error('Video stream timed out.')), 5000);
  });
}

function scannerErrorMessage(error){
  if(!error) return 'Camera failed. Check permissions and try again.';
  if(error.name === 'NotAllowedError') return 'Camera permission was denied. Allow camera access and try again.';
  if(error.name === 'NotFoundError') return 'No camera was found on this device.';
  if(error.name === 'NotReadableError') return 'Camera is busy in another app or browser tab.';
  if(error.name === 'OverconstrainedError') return 'Camera settings were not supported. Please try again.';
  if(error.message && /timed out/i.test(error.message)) return 'Camera started but did not stay active. Please try again.';
  return 'Camera failed. Check permissions and try again.';
}

import { openDB } from './db.js';
import { loadRules, rateProduct } from './rules.js';
import { fetchOFFByBarcode, searchOFFByText } from './off.js';
import { APP_VERSION, RELEASE_DATE } from './version.js';

const ZXING_CDN = 'https://unpkg.com/@zxing/browser@0.1.5/esm/index.js';
const SCAN_HINTS = 'EAN-13, UPC, CODE-128, ITF';

// Simple tab UI
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
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const resultsList = document.getElementById('resultsList');
const forceRefreshBtn = document.getElementById('forceRefreshBtn');

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

  const dairy = await db.metadata.get('dairy_sensitive');
  const strict = await db.metadata.get('strict_mode');
  dairyToggle.checked = !!(dairy && dairy.value === 'true');
  strictToggle.checked = !!(strict && strict.value === 'true');

  dairyToggle.addEventListener('change', async () => {
    await db.metadata.put({key:'dairy_sensitive', value: dairyToggle.checked ? 'true' : 'false'});
    rerateVisible();
  });
  strictToggle.addEventListener('change', async () => {
    await db.metadata.put({key:'strict_mode', value: strictToggle.checked ? 'true' : 'false'});
    rerateVisible();
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

async function rerateVisible(){
  const items = resultsList.querySelectorAll('.result-item');
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
  const cached = await db.products.toArray();
  if(!navigator.onLine || cached.length===0) return;
  let updated = 0;
  for(const p of cached.slice(0, 100)){
    const fresh = await fetchOFFByBarcode(p.barcode);
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
    const fresh = await fetchOFFByBarcode(p.barcode);
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
  if(/^\d{8,14}$/.test(q)){
    const local = await db.products.get(q);
    if(local){
      appendResult(local);
      if(navigator.onLine){
        const fresh = await fetchOFFByBarcode(q);
        if(fresh){ await db.products.put(fresh); replaceResult(q, fresh); }
      }
    } else {
      const fetched = await fetchOFFByBarcode(q);
      if(fetched){ await db.products.put(fetched); appendResult(fetched); }
      else appendMessage(`No product found for barcode ${q}.`);
    }
  } else {
    const list = await searchOFFByText(q, 10);
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

    controls = await codeReader.decodeFromStream(activeStream, video, (result, err) => {
      if(result){
        const text = result.getText();
        scanStatus.textContent = `Scanned: ${text}`;
        searchInput.value = text;
        stopScanner('Barcode captured.');
        doSearch();
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

function scannerErrorMessage(error){
  if(!error) return 'Camera failed. Check permissions and try again.';
  if(error.name === 'NotAllowedError') return 'Camera permission was denied. Allow camera access and try again.';
  if(error.name === 'NotFoundError') return 'No camera was found on this device.';
  if(error.name === 'NotReadableError') return 'Camera is busy in another app or browser tab.';
  if(error.name === 'OverconstrainedError') return 'Camera settings were not supported. Please try again.';
  return 'Camera failed. Check permissions and try again.';
}

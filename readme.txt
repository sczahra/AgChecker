# Alpha‑Gal Checker (PWA)

A tiny, free, offline‑first **web app** to check products for Alpha‑gal risk on your iPhone.

## Features
- Installable PWA (Add to Home Screen on iOS)
- Offline after first load (Service Worker caches app shell & rules)
- Barcode scan with iPhone camera (ZXing)
- Open Food Facts lookup (barcode or text)
- IndexedDB cache of looked‑up products
- Red/Yellow/Green verdicts with clear “Why?” reasons
- Dairy‑sensitive toggle & Strict mode

## How to run (free)
1. Download this folder and deploy it to **Netlify** or **Vercel** as a static site, or run locally with any static server.
2. Visit the URL on your iPhone (HTTPS is required for camera & install).
3. Safari → Share → **Add to Home Screen**.
4. Tap **Scan** to use the camera, or paste a barcode into the Search box.

### Local test
Use a simple static server, e.g. Python:
```bash
python -m http.server 8080
# then open http://localhost:8080
```

## Notes
- Data: **Open Food Facts** (ODbL). Show attribution in the About tab.
- Privacy: No logins; data lives in your browser (IndexedDB).
- Medical: This is informational only; always verify labels and follow medical advice.

## Customize rules
Edit `rules.json` to tune AVOID/CAUTION lists and synonyms.

# AG Checker

A lightweight static web app for checking foods for potential Alpha-gal risk.

## Live site
- Netlify: https://agchecker.netlify.app/

## Repository
- GitHub: https://github.com/sczahra/AgChecker

## Features
- Product search by name or barcode
- Camera barcode scanning
- Open Food Facts integration
- Rule-based Alpha-gal ingredient analysis
- Offline-first app shell with service worker caching
- IndexedDB product cache
- Dairy-sensitive and strict-mode toggles
- Versioned releases with a centralized changelog

## Main files
- `index.html` - UI shell
- `css/styles.css` - styling
- `js/app.js` - main UI, search, scanner, and app lifecycle
- `js/rules.js` - ingredient verdict engine
- `js/off.js` - Open Food Facts requests
- `js/db.js` - IndexedDB setup
- `js/version.js` - app version metadata
- `rules.json` - ingredient rules and aliases
- `sw.js` - service worker
- `CHANGELOG.md` - release history

## Local testing
For service worker and camera testing, run from a local web server instead of opening `index.html` directly.

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Deploying
This app is a plain static site. You can deploy it directly to Netlify or another static host.

## Release checklist
1. Update `js/version.js`
2. Add release notes to `CHANGELOG.md`
3. If cached assets changed materially, bump the cache version in `sw.js`
4. Commit and push to GitHub
5. Verify Netlify deployed the new version

## Notes
- Data source: Open Food Facts (ODbL)
- Privacy: no accounts, no backend, data stays in the browser
- Informational only, not medical advice

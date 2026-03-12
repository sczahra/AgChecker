# Changelog

All notable changes to AG Checker should be recorded here.

## [1.2.0] - 2026-03-12
### Added
- Display language setting with English-preferred and original-label modes.
- Visible note in Settings and About clarifying that product data comes from the global Open Food Facts catalog.
- Native BarcodeDetector camera scanning path when supported by the browser.

### Changed
- Product names and ingredient text now prefer English fields from Open Food Facts when English mode is selected.
- Barcode scanning now uses a more Safari-friendly camera startup flow and prefers the rear camera more aggressively on iPhone/iPad.
- Scanner now waits for the video stream to be ready before decoding and falls back more gracefully between scan engines.

### Fixed
- Improved iPhone Safari behavior where the camera permission prompt appears, the stream flashes on, and then the scanner fails.

# Changelog

All notable changes to AG Checker should be recorded here.

## [1.1.1] - 2026-03-12
### Added
- Global footer shown throughout the app with authorship, version, attribution, and a short reminder.

### Changed
- Result badges now display SAFE / CAUTION / AVOID instead of single-letter status markers.
- Footer version text updated to 1.1.1 for this release.


## [1.1.0] - 2026-03-12
### Added
- App version display in the header and About section.
- GitHub link in the About section.
- Centralized changelog file for releases, fixes, and updates.
- Safari-friendly barcode scanner startup flow with clearer status messages.

### Changed
- About section now reads: "Made by someone with Alpha Gal, for everyone else with Alpha Gal!"
- About section credits Seth Zahra with a GitHub link.
- Scanner now prefers the rear/environment camera when available.
- Scanner now stops automatically after a successful barcode scan.
- README rewritten for GitHub and release maintenance.

### Fixed
- Improved camera compatibility on Safari/iPhone by requesting camera access explicitly before barcode decoding.
- Added more robust scanner cleanup so camera streams stop cleanly across browsers.
- Added browser support checks and better permission/error messaging.

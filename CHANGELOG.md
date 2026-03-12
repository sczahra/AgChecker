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

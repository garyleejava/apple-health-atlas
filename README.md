# Apple Health Atlas

A privacy-first, browser-only visual explorer for Apple Health CSV exports.

Users can export their health data from the Apple Health app, open this web
application, and select the generated ZIP file. All parsing, aggregation, and
visualization happen locally in the browser. The ZIP file is never uploaded.

## Features

- Parse the standard `SimpleHealthExportCSV.zip` format without a server
- Process large exports in a background worker so the UI remains responsive
- Deduplicate multiple devices and select the most credible source per day
- Build daily, hourly, monthly, sleep, workout, measurement, and event views
- Visualize activity, energy, sleep stages, heart rate, recovery, mobility,
  body measurements, and data coverage
- Produce an observational health summary with explicit non-medical wording

## Run Locally

```bash
npm install
npm run vendor
npm test
npm start
```

Open <http://localhost:4173>.

The web app is a static site in `web/`. GitHub Actions can publish that
directory with GitHub Pages; see `.github/workflows/pages.yml`.

## Architecture

- `web/src/parser.js` reads Apple Health CSV records.
- `web/src/aggregator.js` applies timezone, source, sleep, workout, and
  coverage logic.
- `web/src/loader.js` reads the ZIP with JSZip in the browser.
- `web/index.html` owns the ECharts dashboard and file-selection UI.

The analyzer never receives the ZIP from a server. The application is a set of
static files plus local browser APIs.

## Try A Synthetic Export

The test fixture is generated data and contains no real health information:

```bash
python3 scripts/build_sample.py
```

Select `tests/fixtures/synthetic-health-export.zip` from the app to try it.

See [docs/data-format.md](docs/data-format.md) for the supported CSV layout,
signal groups, source-priority rules, and synthetic fixture policy.

## Privacy

See [PRIVACY.md](PRIVACY.md). The application has no telemetry, analytics,
cookies, server upload, or third-party request for user-provided data.

## License

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

This project is not a medical device and does not provide medical advice.

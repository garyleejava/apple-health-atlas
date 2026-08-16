# Contributing

The project is intentionally small and dependency-light. Before changing the
parser or aggregator, add a test that uses the synthetic fixture rather than a
real health export.

Useful commands:

```bash
npm install
npm run vendor
python3 scripts/build_sample.py
npm test
npm run check
npm start
```

Run the privacy check before every commit:

```bash
npm run check
```

Real Apple Health ZIP, CSV, Parquet, DuckDB, and SQLite files are never
committed. If you add a new test file, make sure it is generated data.

Pull requests should:

- Keep all processing in the browser.
- Avoid analytics, telemetry, cookies, and remote health-data requests.
- Avoid hardcoded values that can identify an individual health export.
- Keep the report wording observational and non-medical.

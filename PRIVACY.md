# Privacy

Apple Health Atlas is designed so that a health export remains under the
control of the person who opens it.

## Data Flow

1. The user selects a local Apple Health CSV ZIP file.
2. JavaScript in the browser parses the ZIP and its CSV members.
3. Rows are reduced immediately into aggregate arrays.
4. Charts and text are rendered from those aggregate arrays.

The application does not:

- upload the ZIP file
- upload individual health records
- store data in a server database
- send analytics or device identifiers
- use cookies or tracking pixels
- request remote APIs after the page is loaded

## Network Requests

The hosted application may make ordinary page requests for its own static
HTML, CSS, JavaScript, and vendor assets. No user health data is included in
those requests.

## Repository Hygiene

The repository must never contain a real Apple Health ZIP, CSV, Parquet,
SQLite, or DuckDB file. Test fixtures are generated synthetically and contain
fictional device names, dates, and measurements.

## Disclaimer

This project produces observational summaries. It does not diagnose, treat,
cure, or prevent any disease and is not a substitute for professional medical
advice.

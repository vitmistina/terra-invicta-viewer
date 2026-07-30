# Terra Invicta Influence Viewer

A local-first browser tool that reads a Terra Invicta save and attributes public-opinion Influence income to individual countries for every faction.

The default view targets **The Servants** so you can identify the countries currently funding them and model how much Influence a Public Campaign strategy could remove.

## Features

- Loads uncompressed JSON/JSON5 and gzip-compressed saves.
- Parses JSON5 safely without `eval` or third-party dependencies.
- Resolves Terra Invicta's relational `gamestates` object structure.
- Calculates population from region state objects, with nation-level fallback and diagnostics.
- Calculates country-level supporters, annual Influence, monthly Influence, and marginal value per percentage point.
- Switches between every public-opinion faction found in the save.
- Ranks countries by current contribution, population, support, or marginal value.
- Models a fixed percentage-point support reduction across selected countries.
- Exports the current faction breakdown as CSV.
- Processes the save entirely in the browser. No upload, backend, analytics, or network request is used.

## Influence formula

The application uses:

```text
annual influence = population in millions × support fraction × 0.5
monthly influence = annual influence ÷ 12
monthly influence removed per percentage point = population in millions ÷ 2400
```

The scenario modeller is an accounting tool, not a prediction of Public Campaign mission success. It caps the assumed reduction at the faction's current support in each selected country.

## Run locally

The app is static, but browser modules must be served over HTTP:

```bash
npm run serve
```

Then open <http://localhost:8080>.

No dependency installation is required.

## Tests

```bash
npm test
```

The test suite uses Node's built-in test runner and covers the JSON5 parser, relational region lookup, influence calculations, scenario calculations, and diagnostics.

## Supported save assumptions

The analyzer finds groups by suffix rather than requiring a full namespace:

- `TINationState`
- `TIRegionState`
- `TIControlPoint`
- `TIFactionState`

It supports both explicit nation-to-region references and region-to-nation backlinks. Known field aliases are deliberately narrow and visible in diagnostics. Unknown or malformed data is reported rather than silently normalized.

## Current limitations

- Nation names are taken from save fields such as `displayName`, `name`, or `templateName`; localization tokens are not translated.
- The tool calculates the public-opinion component of Influence. It does not yet reconcile organisations, councilor traits, hab modules, or Control Point Capacity penalties against total faction income.
- Gzip loading relies on the browser's native `DecompressionStream` API.
- Save editing is intentionally out of scope. The tool never writes to the source save.

# Audio Book

Audio Book is a proprietary app project.

Copyright notice:
Copyright (c) 2026 Gaida'a Belal. All rights reserved.

Ownership is claimed only in the original app code, original interface, and
bundled project assets in this repository.

External recordings, lyrics, cover art, service data, and any other third-party
content remain the property of their respective owners.

## Release As An App

Audio Book is set up to ship as an installable Progressive Web App (PWA).

To publish it:

1. Host the contents of the `music book/` folder as the site root on an HTTPS static host.
2. Open the deployed site once in Chrome, Edge, Safari, or another modern browser.
3. Use the in-app `Install Audio Book` button, or the browser's `Install App` / `Add to Home Screen` option.

Notes:

- PWA install works on `https://` sites and on `localhost`. It will not fully work from `file://`.
- On iPhone or iPad, use `Share` then `Add to Home Screen`.
- The app already includes a web manifest, offline shell caching, install metadata, and app icons.
- A root `index.html` redirect is included, so opening the repository root forwards people into the app.
- A `netlify.toml` file is included if you want a simple static deploy with extra security headers.

See [LICENSE.txt](LICENSE.txt) for the repository license terms.

# Finanzas

Private expense tracking that runs entirely on your phone.

* Imports bank CSV exports (Société Générale today, Hello bank next).
* All data is stored on the device, encrypted with AES GCM. The key comes from your passphrase (PBKDF2, 600 000 iterations), and a printed recovery key can unlock it too.
* Nothing is ever sent over the network. The site only serves the app's code, and the Content Security Policy only allows the app to talk to its own address.
* Optional fingerprint unlock: a passkey's PRF secret derives a key that wraps the data key, so the data stays encrypted without the passkey.
* Encrypted backup files can be exported and restored, and an encrypted copy can be kept in a file you choose.

## Development

```
npm install
npm run dev      # local development server
npm test         # unit tests
npm run check    # type checks
npm run build    # production build in dist
```

Test data in `test/` is invented. Never commit real bank files: `*.csv` is ignored on purpose.

## Deployment

Every push to `main` runs the tests and publishes `dist` to GitHub Pages through the workflow in `.github/workflows/deploy.yml`.

## Phone browser tests

`e2e/` holds Playwright scripts that run the whole app on a simulated Android phone with invented bank files:

```
node e2e/make_fixture.mjs e2e/sg_test.csv && node e2e/make_hb.mjs e2e/hb_test.csv
npm run build && python3 e2e/serve_cors.py dist 4173 &
npm run build -- --mode e2e   # test build that includes the demo
node e2e/make_fixture2.mjs e2e/sg_test2.csv
node e2e/run.cjs http://localhost:4173/  # and run2 to run5
```

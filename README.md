# Scoops & Scripture

A responsive church ice-cream preorder website, built with React, TypeScript, and Vite.

## Run locally

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. For a production build:

```sh
npm run build
npm run preview
```

Deploy the generated `dist/` folder to any static hosting service (Firebase Hosting, Netlify, Vercel, GitHub Pages with a suitable Vite base path, etc.). There is no backend server or secret API key to configure. The admin route is `/#admin`; hash routing does not need server rewrites.

## Ordering

- A name and a Bible verse are required; Unicode text in any language is supported.
- Guests choose a quantity, and can place additional reservations.
- Initial inventory is **30 ice creams**. Every reserved ice cream decreases stock, not just every order. Marking an order served or waiting does **not** return stock.
- The confirmation includes a reservation code. Guests identify themselves to the serving team by name.
- Reservations from the same browser are shown under “Your little moments of joy.”
- Firebase is the shared source of truth. The latest reservations and browser identity are cached in local storage. Local storage is device-specific; it is not how inventory is shared across phones.
- Orders are never confirmed offline. The interface reports connection problems and resumes automatically.
- An unconfirmed request retains the same ID in local storage so retrying after a lost response or a reload cannot reserve it twice.

## Serving-team dashboard

Open `/#admin`, or select **Serving team**. Password: **`JesusSavedMe`**.

The dashboard shows available, waiting, and served quantities. Search names, verses, or reservation codes; filter waiting/served/all orders; and mark an order served or waiting. Orders are listed oldest first. “Lock dashboard” signs out of the current view; reloads also require the password again.

## Firebase data isolation

The app connects to the supplied Realtime Database:

```text
https://church-calender-prayers-default-rtdb.firebaseio.com
```

It only reads/writes this dedicated node:

```text
church/icecreamPreorders_v1
```

It never writes to the database root, replaces the parent `church` node, or accesses the existing `questions`, `leaderboard`, or `match` nodes. The new node is created on the first real reservation, not when a page is opened. No sample orders are seeded.

The REST API is used with Firebase ETags and `If-Match` conditional writes. Concurrent reservations retry against the latest stock, preventing cooperating app clients from overselling. Existing data at the app node is validated before any write; unexpected data is not overwritten.

### Database rules

The supplied database was verified readable after the rules were published. The app path returned `null`, which is the expected empty state before the first order. No live test orders were created.

If access is denied later, confirm the correct database is selected in **Firebase Console → Realtime Database → Rules** and click **Publish** after changing its rules. The root-public rules supplied in the request allow this app, but expose the entire database.

For a **new, otherwise unused database**, the narrower equivalent is:

```json
{
  "rules": {
    "church": {
      "icecreamPreorders_v1": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

If the database already serves other apps, preserve their rules and merge this path instead of replacing their rules. A broad permission granted at a parent node cannot be restricted by a child rule. The app does not change Firebase rules itself.

## Important security and privacy limitations

The frontend password is a **convenience lock**, exactly as requested, not authentication. Anyone inspecting the source can find it or bypass it. Public database rules also allow anyone who knows the URL to read names/verses or modify reservations directly, including bypassing stock checks. Do not use this setup for sensitive information or a public production event without hardening it.

For stronger protection, use Firebase Authentication for admins, server-enforced database rules, and trusted server-side reservation handling. Only collect information guests are comfortable sharing. The local cache contains reservation data, so avoid leaving it on shared devices unnecessarily. The implementation intentionally has no destructive bulk-reset/delete button.

The hero picture is generated serving inspiration, not a guarantee of flavors or ingredients. Guests are prompted to ask the serving team about allergens. Fonts and images are self-hosted.

## Tests

```sh
npm test                 # 16 unit/transaction tests
npx playwright install chromium
npm run test:e2e          # 7 browser tests
npm run build
npm audit
```

Tests use an in-memory/mock Firebase endpoint: **they never write to the live database**. Coverage includes concurrency for the last scoop, sold-out handling, multilingual verses, local persistence, admin password/search/status controls, lost-response recovery, offline safety, HTML escaping, and mobile layout. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can optionally point to an existing Chromium executable.

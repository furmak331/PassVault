# Publishing the Chrome extension

How to get PassVaultify onto the Chrome Web Store, from a fresh developer
account to a published listing. Allow about an hour for the first submission,
then a few days for review.

## 1. Build the package

```bash
pnpm install
pnpm --filter @passvaultify/extension build
pnpm --filter @passvaultify/extension package
```

This writes `apps/extension/release/passvaultify-<version>.zip`.

Or skip the local build: every CI run on `main` has a
**passvaultify-extension-for-store** artifact. Download it from the run's
**Artifacts** section and upload that zip to the dashboard as it is, without
extracting it. It has `manifest.json` at its root, which is what the store
checks for.

The packaging script refuses an end-to-end test build (`build:e2e`), which
grants itself access to localhost and must never ship.

Before the first upload, load the build into Chrome yourself:

1. Open `chrome://extensions` and switch on **Developer mode**.
2. Choose **Load unpacked** and pick `apps/extension/dist`.
3. Open the settings page, restore a backup from the web vault (or create a
   vault), and try filling a login on a real site.

## 2. Register as a Chrome Web Store developer

1. Go to the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole)
   and sign in with the Google account that should own the listing. You can't
   move a listing to another account later without transferring the whole
   developer account, so pick deliberately.
2. Accept the developer agreement and pay the one-time US$5 registration fee.
3. In **Account**, set the publisher name (shown on the listing) and verify
   your contact email. The dashboard won't let you publish until the email is
   verified.

## 3. Create the item

1. In the dashboard, choose **New item** and upload the zip from step 1.
2. The dashboard opens the item's draft. It has four tabs to fill in:
   **Package**, **Store listing**, **Privacy practices** and **Distribution**.

Everything to paste is in [`apps/extension/store/listing.md`](../apps/extension/store/listing.md),
and the images are next to it in `apps/extension/store/`.

### Store listing

- Description, category and language from `listing.md`.
- Upload the store icon (`apps/extension/public/icons/icon-128.png`), the five
  screenshots in order, and the small promo tile. The marquee tile is optional
  and only used if Google features the extension.
- Homepage and support URLs from `listing.md`.

### Privacy practices

- Paste the single-purpose statement and each permission justification.
- Answer **No** to remote code.
- Tick the data types listed in `listing.md` and the three certifications.
- Privacy policy URL: `https://furmak331.github.io/PassVault/privacy.html`.
  It's deployed with the web vault, so make sure the latest `main` has gone out
  to GitHub Pages and the page loads before you submit.

### Distribution

- Free, all regions.
- **Unlisted** is a good first step: the listing works for anyone with the
  link, but doesn't show up in search. Switch to **Public** whenever you're
  ready, without another review.

## 4. Submit for review

Choose **Submit for review**. You can tick "publish automatically after
review", or publish by hand once it passes.

Reviews usually take from a day to a week. Password managers can be looked at
more closely because they ask for site access, which is why PassVaultify keeps
it optional. If a review is rejected, the email names the policy and the part
of the listing it applies to; fix that, upload again, and resubmit.

## 5. Ship updates

1. Bump `version` in `apps/extension/package.json` (the build copies it into
   the manifest). The store rejects a zip whose version isn't higher than the
   published one.
2. Build and package as in step 1.
3. In the dashboard, open the item, go to **Package**, choose **Upload new
   package**, then **Submit for review**.

Installed copies update themselves within a few hours of the new version
being published.

Changing permissions triggers a closer review, and if a new permission shows
a warning, Chrome disables the extension for existing users until they accept
it. Prefer optional permissions, requested at the moment they're needed.

## Checklist

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` pass
- [ ] Version bumped (updates only)
- [ ] Zip built with `build` (not `build:e2e`) and loaded unpacked once
- [ ] Privacy policy page is live
- [ ] Listing text and screenshots match what the version does

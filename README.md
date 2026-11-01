# DropLab

A product research and experiment workspace for ecommerce. DropLab helps you decide **what deserves a small test**, then compare actual results against your costs. It does not promise that an ad, trend, or high score is a winning product.

## Windows desktop app

Get the portable Windows build from the [latest GitHub release](https://github.com/DavidPu4/DropLab/releases/latest). This repository and its releases are private; access requires permission from the owner.

Extract the complete `DropLab-0.2.0-Windows-x64.zip` into a folder, then open **DropLab.exe**. The ZIP includes its own runtime; Node.js, a running development server, and ChatGPT sign-in are not required. Live product discovery still needs an internet connection and your own Apify token.

The desktop app loads its bundled interface from `droplab://app` and stores its workspace in your Windows profile at `%APPDATA%\DropLab`. That stable app origin preserves saved work across restarts and ZIP updates. Tokens remain in memory for the current app session and are excluded from backups, releases, and source code. The ZIP contains no personal research or credentials.

To move a browser workspace into the desktop app, use **Settings → Export backup** on the web app, then **Settings → Restore backup** in the desktop app. The two apps have separate local storage; the JSON backup transfers research, experiments, the discovery snapshot, and recorded observation history.

The desktop layout uses a compact product table, a filter sidebar, sortable columns, selection and batch actions, CSV export, and optional product cards. It uses DropLab branding with a blue-and-white research workspace. Observed dates describe when data was recorded, not a sales attribution window.

## Use it

1. Open **Discover**, connect your Apify API token, and choose **Find US bestsellers**. No product link, keyword, or CSV is needed.
2. Browse the returned TikTok Shop listings. Review price, seller, ratings, reviews, and platform-reported cumulative units sold. Save promising leads to **My research** or your shortlist.
3. In My research, enter your planned selling price, unit cost, shipping, payment fees, and expected refund rate. Unknown values stay blank. The observed marketplace price is a reference, not a verified supplier quote or your revenue.
4. Compare the evidence and economics before deciding what deserves a small test. Manual products, CSV imports, and clearly labeled fictional examples remain available in My research.
5. After running your own test, record spend, orders, revenue, refunds, and traffic. Review contribution profit alongside CPA and ROAS.
6. Export a JSON backup regularly. Saved research, test results, and the latest discovery snapshot are stored in this browser; another browser, localhost, and the published site each have separate storage.

All money fields currently use USD. Percentage fields use whole percentages: `2.9` means 2.9%. Example records and test results are fictional and are labeled in the interface. Real imports do not receive made-up cost or sales data.

## Automatic product discovery

DropLab uses the community-maintained [`wheaten_steelpan/tiktok-shop-scraper`](https://apify.com/wheaten_steelpan/tiktok-shop-scraper) actor in `bestsellers` mode for the US market. The default request asks for 30 products from the whole market. It requires no product to be identified first. This connector is experimental: the actor is independently maintained, has limited adoption, and may stop returning data if its upstream source changes. Failed or empty runs show errors or warnings rather than manufactured product recommendations.

Create an [Apify free account](https://console.apify.com/sign-up), open [Settings → Integrations](https://console.apify.com/settings/integrations), and enter your API token in DropLab's discovery connection form. According to [Apify's current pricing](https://apify.com/pricing), Free includes $5/month in usage credits with no credit card required; the platform blocks free-account usage when those credits are exhausted. Each actor has its own pricing and limits. The chosen actor currently limits free runs to 100 product rows; DropLab requests fewer and asks the provider to cap each run at $0.25. Check provider pricing before starting. DropLab does not upgrade your account or select a paid subscription.

No discovery run starts on page load or automatically retries after an ambiguous failure. The user explicitly accepts possible credit usage and starts or refreshes the feed. The token stays in the current React session, is sent through this app's server to Apify as a bearer credential, and is excluded from browser storage, backups, URLs, source code, and logs. Reloading clears the token; cached results remain available with their observation dates. Provider run and dataset ownership are checked before reading results or cancelling a run.

Reported units sold are **cumulative/lifetime counts**, not sales in the last day, week, or month. One snapshot cannot establish sales growth or revenue. Repeated real observations can show the change since the first retained tracked observation; the app keeps up to 30 points per product for up to 100 products. Unknown counters, decreases, mixed sample/live provenance, or insufficient observations produce an unknown change rather than a misleading chart. No recent GMV, profit, or likelihood of success is invented. Discovery ranking and your later economic research score have separate purposes. Product photos are restricted to supported TikTok CDN hosts, and original listing links remain available for verification.

## Optional ad research

The live connector uses Apify's `apify/facebook-ads-scraper` actor with a Meta Ads Library search URL. An Apify account and token are required; actor availability and provider charges are controlled by Apify. No provider requests start until the user enters a token, accepts the possible charges, and explicitly starts a run.

Ad-research tokens also live only in the current UI session. They are sent over HTTPS to this app's server, then as a bearer token to the fixed Apify API host. Tokens are not saved in workspace backups or browser storage. Close the ad connector or reload the page to clear them. The server validates URL hosts, bounds request sizes and result counts, and returns sanitized errors.

Discovery returns **ad leads**, which may require manual product identification. An active advertisement is evidence that someone is advertising; it is not evidence of their sales or profit. Missing ad status stays unknown. Review original links and independently verify supplier quality, costs, delivery, and demand before spending money.

Manual entry, CSV imports, comparison, calculations, and experiment tracking work without an external account or subscription.

## Calculations

Estimated contribution before advertising per order:

```text
price × (1 − expected refund rate)
− unit cost − shipping − price × fee rate − fixed fee
```

This conservative estimate assumes costs and fees remain payable on refunded orders and assumes no recovered inventory. Break-even CPA equals that contribution; break-even ROAS is price divided by positive contribution. Fixed overhead, taxes, duties, and other costs must be considered separately. Blank assumptions produce incomplete economics rather than a fabricated result.

Experiment contribution uses actual revenue, refunds, advertising spend, orders, and the product's cost assumptions. The displayed minimum-order criterion is a screening rule, not a statistical proof of future profitability. Research scores are transparent heuristics based on evidence and economics, not success probabilities or AI predictions.

## Run locally

Requires Node.js 22.13 or newer. From this folder:

```sh
npm ci
npm run dev -- --hostname 127.0.0.1 --port 4338
```

Open the URL printed by the server. The app uses React, TypeScript, and Vinext, with a Worker-compatible server route. It does not require Firebase, a database subscription, or a payment account.

```sh
node --test tests/*.test.mjs
npx tsc --noEmit
npm run build
```

To build the Windows desktop version from source:

```sh
npm run desktop:build
npm run desktop:smoke
npm run desktop:package
```

The last command produces the Windows ZIP in `releases/`. Desktop smoke checks use an isolated temporary profile and make no provider requests that consume credits. Renderer code has no Node access; the sandboxed window talks to a bounded same-origin protocol handler. External HTTPS links open in the system browser.

The Sites framework integration in `vite.config.ts` and `.openai/hosting.json` is preserved for private publication. Source tokens, local environment files, generated bundles, and workspace data are excluded from Git.

## Main code

- `app/page.tsx`, `app/components/`: discovery feed, saved research, local persistence, and workflows
- `lib/discovery.js`: canonical marketplace leads, safe URLs, deduplication, and conversion to research products
- `lib/tiktok-provider.js`, `app/api/discovery/route.ts`: bounded automatic TikTok bestseller discovery
- `desktop/main.cjs`, `desktop/protocol.cjs`: native window, local application protocol, shared provider API, and desktop startup checks
- `desktop/build.mjs`, `electron-builder.yml`: standalone renderer staging and Windows ZIP packaging
- `lib/domain.js`: normalization, research scoring, economics, and experiment metrics
- `lib/importers.js`: CSV and validated JSON backup handling
- `lib/demo.js`: clearly labeled fictional sample records
- `lib/research-provider.js`: bounded Apify integration and ad normalization
- `app/api/research/route.ts`: same-origin, validated server API
- `tests/`: financial edge cases, imports, and mocked provider behavior

## Limits

This version has no unattended background crawler, automatic ad purchases, store integration, cross-device synchronization, or trained prediction model. It is not a replacement for a commercial platform's historical market database. Clearing app or browser data removes local records unless you exported a backup. Provider behavior has mocked and Workers-runtime regression coverage; the hosted connector was also verified with one real 30-product run. New runs using provider credits require your own credentials and explicit action. The app cannot independently verify marketplace-reported sales counts.

Source references: [Apify actor](https://apify.com/apify/facebook-ads-scraper), [Apify API](https://docs.apify.com/api/v2), [Meta Ads Library](https://www.facebook.com/ads/library/).

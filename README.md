# DropLab

A product research and experiment workspace for ecommerce. DropLab helps you decide **what deserves a small test**, then compare actual results against your costs. It does not promise that an ad, trend, or high score is a winning product.

## Use it

1. Explore the labeled sample workspace to understand the workflow.
2. Start an empty workspace, add a lead manually, or import a product CSV.
3. Open a product and enter its selling price, unit cost, shipping, payment fees, and expected refund rate. Unknown values stay blank.
4. Review the source evidence and compare research priorities. Move a promising product to your shortlist.
5. After running your own small test, record spend, orders, revenue, refunds, and traffic. Review contribution profit alongside CPA and ROAS.
6. Export a JSON backup regularly. Records are stored in this browser; another browser, localhost, and the published site each have separate storage.

All money fields currently use USD. Percentage fields use whole percentages: `2.9` means 2.9%. Example records and test results are fictional and are labeled in the interface. Real imports do not receive made-up cost or sales data.

## Optional live research

The live connector uses Apify's `apify/facebook-ads-scraper` actor with a Meta Ads Library search URL. An Apify account and token are required; actor availability and provider charges are controlled by Apify. No provider requests start until the user enters a token, accepts the possible charges, and explicitly starts a run.

Tokens live only in the current UI session. They are sent over HTTPS to this app's server, then as a bearer token to the fixed Apify API host. Tokens are not saved in workspace backups or browser storage. Close the connector or reload the page to clear them. The server validates URL hosts, bounds request sizes and result counts, and returns sanitized errors.

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

The Sites framework integration in `vite.config.ts` and `.openai/hosting.json` is preserved for private publication. Source tokens, local environment files, generated bundles, and workspace data are excluded from Git.

## Main code

- `app/page.tsx`, `app/components/`: interface, local persistence, and workflows
- `lib/domain.js`: normalization, research scoring, economics, and experiment metrics
- `lib/importers.js`: CSV and validated JSON backup handling
- `lib/demo.js`: clearly labeled fictional sample records
- `lib/research-provider.js`: bounded Apify integration and ad normalization
- `app/api/research/route.ts`: same-origin, validated server API
- `tests/`: financial edge cases, imports, and mocked provider behavior

## Limits

This first version has no background crawler, automatic ad purchases, store integration, cross-device synchronization, or trained prediction model. Clearing site data removes local records unless you exported a backup. Live provider behavior is tested with mocked responses; a real paid run requires your own credentials and explicit action.

Source references: [Apify actor](https://apify.com/apify/facebook-ads-scraper), [Apify API](https://docs.apify.com/api/v2), [Meta Ads Library](https://www.facebook.com/ads/library/).

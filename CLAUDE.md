# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A VS Code / Cursor extension that tracks Z.ai (GLM) Coding Plan quota usage. The entire logic lives in a single file: [src/extension.ts](src/extension.ts).

## Commands

- `npm run compile` — TypeScript build to `out/` (run this before testing/debugging)
- `npm run watch` — incremental compile during development
- `npm run lint` — ESLint over `src/**/*.ts`
- `npm run pretest` — compile + lint
- Package a `.vsix`: `npx vsce package` (`@vscode/vsce` is a devDependency)

There are no tests. To run/debug the extension: press F5 in VS Code (uses default Extension Development Host; no `.vscode/launch.json` is committed, so add one if launch fails).

## Architecture

Single-extension-entry design with no framework:

- **API layer** (`fetchUsageData`): raw `https` GET to `api.z.ai/api/monitor/usage/quota/limit` with the API key in the `Authorization` header. If a raw key returns 401, it retries once with a `Bearer ` prefix. No HTTP library — keep it that way.
- **Parsing** (`parseQuotaResponse`): the API returns `data.limits[]` with opaque `type` fields (`TOKENS_LIMIT` / `CREDIT_LIMIT` / `TIME_LIMIT`) and `unit`/`number` window encodings. The 5-hour vs weekly window is disambiguated via a minutes multiplier map (`unit 3 × 5 = 300min` session, `unit 6 = 10080min` weekly). If the API shape changes, this is the function to fix.
- **UI surfaces**: a right-aligned status bar item (percentage text + markdown tooltip) and a QuickPick details panel (`showDetailsQuickPick`) triggered by clicking it. State is cached in the module-level `lastParsedData` so the QuickPick can render without refetching.
- **API key storage**: `context.secrets` (SecretStorage), never settings. There is a one-time migration in `activate()` that moves a legacy plaintext `zaiUsageTracker.apiKey` setting into SecretStorage — don't reintroduce plaintext keys.
- **Config**: three settings under `zaiUsageTracker.*` (timezone, timeFormat, refreshIntervalMinutes). `onDidChangeConfiguration` refetches and reschedules the polling interval timer.
- **Packaging note**: `.vscodeignore` excludes `src/**` and `tsconfig.json`, so only compiled `out/extension.js` ships.

## Conventions

- TypeScript strict mode, target ES2022, module Node16.
- ESLint rules are warn-level: semicolons, `curly`, `eqeqeq`, `no-throw-literal`.
- New user-facing commands must be registered in three places: the `registerCommand` block in `activate()`, `context.subscriptions.push`, and the `contributes.commands` array in [package.json](package.json).

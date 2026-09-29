# Releasing

Both packages share one version and ship together. Versions are managed with
[Changesets](https://github.com/changesets/changesets); publishing is triggered by **pushing a
version tag**.

## One-time setup (repository owner)

1. **npm organisation.** The `oozkul` npm org exists (`clickflick` was taken); scoped public packages publish under it
   (scoped public packages need it): https://www.npmjs.com/org/create.
2. **npm token.** On npmjs.com → _Access Tokens_ → _Generate New Token_ → **Granular Access
   Token**: packages & scopes → _Read and write_ on the `@oozkul` scope (or "all
   packages"), _Bypass 2FA_ enabled (CI cannot answer 2FA prompts), expiry as you like.
3. **GitHub secret.** Repository → _Settings → Secrets and variables → Actions_ → new secret
   **`NPM_TOKEN`** with that token. The release workflow uses the `npm` environment; create it
   under _Settings → Environments_ (optional: add required reviewers there for an approval gate).
4. **GitHub Pages.** _Settings → Pages → Build and deployment → Source: GitHub Actions_. The
   `Demo (GitHub Pages)` workflow then publishes the demo on every push to `main` at
   https://clickflick.github.io/odontogram/.
5. After the first successful publish you can switch npm to **trusted publishing** (OIDC, no
   token): on each package page → _Settings → Trusted publisher_ → GitHub Actions, repository
   `ClickFlick/odontogram`, workflow `release.yml`, environment `npm`. Then delete the
   `NPM_TOKEN` secret; the workflow already requests `id-token: write` and passes
   `--provenance`.

## Every release

```sh
# 1. while working: describe each user-facing change
npm run changeset                # pick packages + bump, write a note (creates .changeset/*.md)

# 2. when ready to release
npm run version                  # applies changesets: bumps both package.json + CHANGELOG.md
git add -A && git commit -m "release: v0.2.0"

# 3. tag and push
npm run release:tag              # creates v<version> from packages/core/package.json (checks clean tree, no pending changesets)
git push origin main --follow-tags
```

Pushing the tag runs `.github/workflows/release.yml`, which:

1. checks the tag equals both package versions and there are no unapplied changesets,
2. builds, lints, typechecks and runs the full test suite (including headless Chromium),
3. publishes `@oozkul/dental-3d` then `@oozkul/dental-3d-angular` to npm with provenance,
4. creates a GitHub Release whose notes are the CHANGELOG sections for that version.

If step 2 fails nothing is published. If the npm publish of the second package fails after the
first succeeded, fix the cause and re-run the job; npm refuses to overwrite an existing version,
so the already-published package is simply skipped with an error you can ignore, or bump a
patch and tag again.

## Pre-releases

`npx changeset pre enter beta` → normal flow → versions like `0.2.0-beta.0`; the tag pattern
`v*.*.*` matches them. `npx changeset pre exit` when done.

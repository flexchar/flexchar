# flexchar/flexchar

GitHub profile README for `flexchar` (Lukas Vanagas). Goal: look senior, calm and clearly active, even though most work happens in private repos. Keep it minimal and self-hosted: no third-party stat image services, they die and leave broken images.

## Layout

- `README.md` - the profile page. Plain markdown plus `<picture>` elements for light and dark images. No HTML tables, they do not reflow on phones.
- `assets/banner-{light,dark}.svg` - static banner, hand-tuned. Colors match GitHub's own palette.
- `assets/activity-{light,dark}.svg` - generated, never edit by hand. Last 12 months of contributions, a weekly activity chart and the language mix, private repos included.
- `scripts/profile.ts` - Bun script, no dependencies. Queries the GitHub GraphQL API for the token owner's repos and contribution calendar, renders the activity cards, and rewrites the README between `<!-- BLOG:START -->` and `<!-- BLOG:END -->` with the latest posts from the Lukas' Notes RSS feed. Only totals are written, never repo names.
- `scripts/fixtures/` - fake viewer data and a fake feed for local rendering.
- `.github/workflows/profile.yml` - runs the script every Monday, on manual dispatch, and on pushes to main that touch the script or workflow. Commits only when something changed.

## Local preview

```
PROFILE_FIXTURES=scripts/fixtures bun run scripts/profile.ts
```

This writes fake numbers into the activity SVGs and fake posts into README.md. Never commit that output: `git checkout README.md && rm assets/activity-*.svg` afterwards.

## Secrets

Repository secret `GH_STATS_TOKEN`: a classic personal access token with scopes `repo` and `read:user`. The built-in Actions token only sees this repo.

## Conventions

- Plain hyphens, no em dashes. No manual line wrapping in prose.
- Hide languages from the chart via `EXCLUDED_LANGUAGES` at the top of the script.
- Update this file when the layout or the generation flow changes. Durable facts go in `MEMORY.md`.

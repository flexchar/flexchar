# flexchar/flexchar

GitHub profile README for `flexchar`. Goal: look senior, calm and clearly active, even though most work happens in private repos and AI sessions. Keep it minimal and self-hosted: no third-party stat image services, they die and leave broken images. Do not put the owner's full name on the public page; the blog's brand name "Lukas' Notes" is fine.

## Layout

- `README.md` - the profile page. Plain markdown plus `<picture>` elements for light and dark images. No HTML tables, they do not reflow on phones.
- `assets/banner-{light,dark}.svg` - static banner, hand-tuned, no name on it. Colors match GitHub's own palette.
- `assets/activity-{light,dark}.svg` - generated, never edit by hand. Last 12 months of GitHub activity (private repos included), a weekly chart, the language mix, and AI token usage from local Claude Code and Codex logs.
- `scripts/profile.ts` - Bun script, no dependencies, runs on the owner's Mac. See below.
- `scripts/install-launchd.sh` - installs a LaunchAgent that runs `profile.ts --publish` every Monday at 09:00. `--uninstall` removes it.
- `scripts/fixtures/` - fake GitHub data, fake Claude Code and Codex logs, and a fake feed for local rendering.

## How the generator works

- GitHub token: `GH_STATS_TOKEN` if set, otherwise `gh auth token`. No secret is stored in the repo or in Actions.
- GitHub data comes from the GraphQL API: owned repos for the language mix, the contribution calendar for the rest.
- Claude Code usage: every `*.jsonl` under `$CLAUDE_CONFIG_DIR`, `~/.claude/projects` and `~/.config/claude/projects`. Claude Code writes one record per content block with the same usage repeated, so records are deduped by `message.id` plus `requestId`. Tokens processed = input + output + cache creation + cache read. `<synthetic>` messages are skipped.
- Codex usage: every `*.jsonl` and zstd-compressed `*.jsonl.zst` under `~/.codex/sessions` and `~/.codex/archived_sessions` (or `$CODEX_HOME`). `token_count` events carry running totals and can repeat, so only growth between events is counted. The model comes from the latest `turn_context`.
- Cost at API prices: tokens are priced per exact model from `PRICES` (input, short and long cache writes, cache reads, output, public list prices). Unlisted models count as $0 and are printed as "No price for". Refresh `PRICES` when new models show up.
- Models are grouped into families (Claude Opus, Claude Fable, GPT-5.6 and so on) by `modelFamily`.
- Blog posts come from the Lukas' Notes RSS feed and replace the README between `<!-- BLOG:START -->` and `<!-- BLOG:END -->`.
- Only totals are written. Repo names, project paths and prompts never reach the output.
- `--publish` commits only README.md and the two activity cards, then pushes. It refuses to run in fixture mode.

## Local preview

```
PROFILE_FIXTURES=scripts/fixtures bun run scripts/profile.ts
```

This writes fake numbers into the activity SVGs and prints fake posts instead of touching README.md. Never commit the SVGs it produces: `rm assets/activity-*.svg` afterwards.

## Conventions

- Plain hyphens, no em dashes. No manual line wrapping in prose.
- Hide languages from the chart via `EXCLUDED_LANGUAGES` at the top of the script. Model colors live in `MODEL_COLORS`.
- Update this file when the layout or the generation flow changes. Durable facts go in `MEMORY.md`.

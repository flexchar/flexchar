// Regenerates the dynamic parts of the profile README, on my own machine:
//   assets/activity-{light,dark}.svg  - last 12 months of GitHub activity, the language mix
//                                      and AI token usage from local Claude Code and Codex logs
//   README.md between BLOG markers     - latest posts from Lukas' Notes
// Only totals are written. Repo names, project paths and prompts never leave this process.
//
//   bun run scripts/profile.ts             generate only
//   bun run scripts/profile.ts --publish   generate, then commit and push the generated files
//   PROFILE_FIXTURES=scripts/fixtures bun run scripts/profile.ts   fake data, never commit the output
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Notebook JSON (outputs, base64 images) inflates byte counts far beyond the code it holds.
const EXCLUDED_LANGUAGES = new Set(["Jupyter Notebook"]);
const TOP_LANGUAGES = 8;
const TOP_MODELS = 5;
const FEED_URL = "https://lukasnotes.dk/rss.xml";
const POST_COUNT = 3;

const ROOT = join(import.meta.dir, "..");
const README = join(ROOT, "README.md");
const CARDS = ["light", "dark"].map((name) => join(ROOT, "assets", `activity-${name}.svg`));
const FIXTURES = process.env.PROFILE_FIXTURES;
const PUBLISH = process.argv.includes("--publish");
// Fixtures are dated, so pin their window instead of sliding it with the clock.
const SINCE = FIXTURES ? new Date("2025-11-01") : new Date(Date.now() - 365 * 86_400_000);

type Theme = { surface: string; border: string; text: string; muted: string; empty: string; accent: string; other: string };
const THEMES: Record<"light" | "dark", Theme> = {
  light: { surface: "#f6f8fa", border: "#d0d7de", text: "#1f2328", muted: "#656d76", empty: "#d0d7de", accent: "#2da44e", other: "#8c959f" },
  dark: { surface: "#161b22", border: "#30363d", text: "#e6edf3", muted: "#8b949e", empty: "#30363d", accent: "#39d353", other: "#6e7681" },
};
// Claude families in warm clay tones, GPT in OpenAI green, anything else falls back to the palette.
const MODEL_COLORS: Record<string, string> = {
  "Claude Fable": "#a3492b",
  "Claude Mythos": "#7c3720",
  "Claude Opus": "#d97757",
  "Claude Sonnet": "#e9a06f",
  "Claude Haiku": "#f0c9a0",
};
const FALLBACK_COLORS = ["#10a37f", "#3fb8af", "#5b8def", "#a371f7", "#bf8700"];

type LanguageEdge = { size: number; node: { name: string; color: string | null } };
type Repo = { isPrivate: boolean; isArchived: boolean; languages: { edges: LanguageEdge[] } };
type Week = { contributionDays: { date: string; contributionCount: number }[] };
type Viewer = {
  repositories: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Repo[] };
  contributionsCollection: {
    totalCommitContributions: number;
    totalPullRequestContributions: number;
    totalRepositoriesWithContributedCommits: number;
    contributionCalendar: { totalContributions: number; weeks: Week[] };
  };
};
type Slice = { name: string; color: string; percent: number };
type Stats = {
  contributions: number;
  commits: number;
  pullRequests: number;
  repos: number;
  privateShare: number;
  weeks: { start: string; count: number }[];
  languages: Slice[];
};
type Usage = { tokens: number; output: number; sessions: number; activeDays: number; models: Slice[] };
type Post = { title: string; link: string; date: Date };

const QUERY = `query($cursor: String) {
  viewer {
    repositories(first: 100, after: $cursor, ownerAffiliations: [OWNER], isFork: false) {
      pageInfo { hasNextPage endCursor }
      nodes {
        isPrivate isArchived
        languages(first: 20, orderBy: {field: SIZE, direction: DESC}) { edges { size node { name color } } }
      }
    }
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      totalRepositoriesWithContributedCommits
      contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
    }
  }
}`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

// Prefer an explicit token, otherwise reuse the GitHub CLI login so no secret has to be stored anywhere.
function githubToken(): string {
  if (process.env.GH_STATS_TOKEN) return process.env.GH_STATS_TOKEN;
  const gh = Bun.spawnSync(["gh", "auth", "token"], { stderr: "ignore" });
  const token = gh.success ? gh.stdout.toString().trim() : "";
  if (!token) fail("No GitHub token: run `gh auth login`, or set GH_STATS_TOKEN to a token with the repo scope.");
  return token;
}

async function fetchViewer(): Promise<Viewer> {
  if (FIXTURES) return JSON.parse(readFileSync(join(FIXTURES, "viewer.json"), "utf8"));
  const token = githubToken();
  let cursor: string | null = null;
  let viewer: Viewer | null = null;
  const repos: Repo[] = [];
  do {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { Authorization: `bearer ${token}`, "User-Agent": "flexchar-profile", "Content-Type": "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { cursor } }),
    });
    const body = await res.text();
    if (!res.ok) fail(`GitHub API returned HTTP ${res.status}: ${body}`);
    const json = JSON.parse(body) as { data?: { viewer: Viewer }; errors?: unknown[] };
    if (json.errors?.length) fail(`GitHub GraphQL errors: ${JSON.stringify(json.errors)}`);
    if (!json.data?.viewer) fail("GitHub GraphQL response had no viewer");
    viewer = json.data.viewer;
    repos.push(...viewer.repositories.nodes);
    const { hasNextPage, endCursor } = viewer.repositories.pageInfo;
    cursor = hasNextPage ? endCursor : null;
  } while (cursor);
  viewer.repositories.nodes = repos;
  return viewer;
}

function aggregate(viewer: Viewer): Stats {
  const repos = viewer.repositories.nodes.filter((r) => !r.isArchived);
  const bytes = new Map<string, { color: string | null; bytes: number }>();
  for (const repo of repos) {
    for (const { size, node } of repo.languages.edges) {
      if (EXCLUDED_LANGUAGES.has(node.name)) continue;
      const entry = bytes.get(node.name) ?? { color: node.color, bytes: 0 };
      entry.bytes += size;
      bytes.set(node.name, entry);
    }
  }
  const languages = slices(new Map([...bytes].map(([name, v]) => [name, v.bytes])), TOP_LANGUAGES, (name) => bytes.get(name)?.color ?? "");
  const c = viewer.contributionsCollection;
  return {
    contributions: c.contributionCalendar.totalContributions,
    commits: c.totalCommitContributions,
    pullRequests: c.totalPullRequestContributions,
    repos: c.totalRepositoriesWithContributedCommits,
    privateShare: repos.length ? Math.round((repos.filter((r) => r.isPrivate).length / repos.length) * 100) : 0,
    weeks: c.contributionCalendar.weeks.map((w) => ({
      start: w.contributionDays[0]?.date ?? "",
      count: w.contributionDays.reduce((sum, d) => sum + d.contributionCount, 0),
    })),
    languages,
  };
}

// Top N by size plus an "Other" bucket, as percentages. An empty color means "use the theme's other color".
function slices(sizes: Map<string, number>, top: number, color: (name: string) => string): Slice[] {
  const sorted = [...sizes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = sorted.reduce((sum, [, n]) => sum + n, 0) || 1;
  const head = sorted.slice(0, top).map(([name, n]) => ({ name, color: color(name), percent: (n / total) * 100 }));
  const rest = sorted.slice(top).reduce((sum, [, n]) => sum + n, 0);
  if (rest > 0) head.push({ name: "Other", color: "", percent: (rest / total) * 100 });
  return head;
}

function jsonlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".jsonl") || f.endsWith(".jsonl.zst"))
    .map((f) => join(dir, f));
}

// Codex compresses older sessions to .jsonl.zst, which hold most of its history.
const readLog = (file: string) =>
  file.endsWith(".zst") ? new TextDecoder().decode(Bun.zstdDecompressSync(readFileSync(file))) : readFileSync(file, "utf8");

function* jsonLines(file: string, mustContain: string): Generator<any> {
  for (const line of readLog(file).split("\n")) {
    if (!line.includes(mustContain)) continue;
    try {
      yield JSON.parse(line);
    } catch {
      // A session that is still being written can end in a partial line.
    }
  }
}

function modelFamily(model: string): string {
  const m = model.toLowerCase();
  const claude = m.match(/^claude-(?:\d+(?:-\d+)?-)?([a-z]+)/);
  if (claude) return `Claude ${claude[1][0].toUpperCase()}${claude[1].slice(1)}`;
  const gpt = m.match(/^gpt-(\d+(?:\.\d+)?)/);
  if (gpt) return `GPT-${gpt[1]}`;
  return model;
}

// Reads Claude Code and Codex session logs from this machine. Only counts survive.
function collectUsage(): Usage {
  const home = homedir();
  const claudeRoots = FIXTURES
    ? [join(FIXTURES, "claude")]
    : [...new Set([process.env.CLAUDE_CONFIG_DIR, join(home, ".claude"), join(home, ".config", "claude")])]
        .filter((r): r is string => !!r)
        .map((r) => join(r, "projects"));
  const codexRoots = FIXTURES
    ? [join(FIXTURES, "codex")]
    : [process.env.CODEX_HOME ?? join(home, ".codex")].flatMap((r) => [join(r, "sessions"), join(r, "archived_sessions")]);

  const byModel = new Map<string, number>();
  const days = new Set<string>();
  const sessions = new Set<string>();
  const seen = new Set<string>();
  let tokens = 0;
  let output = 0;
  const count = (when: Date, model: string, total: number, out: number, session: string) => {
    if (when < SINCE || total <= 0) return;
    tokens += total;
    output += out;
    const family = modelFamily(model);
    byModel.set(family, (byModel.get(family) ?? 0) + total);
    days.add(when.toISOString().slice(0, 10));
    sessions.add(session);
  };

  // Claude Code logs one record per content block, all repeating the same usage, so dedupe by message id.
  for (const file of claudeRoots.flatMap(jsonlFiles)) {
    for (const o of jsonLines(file, '"usage"')) {
      const m = o.message;
      const u = m?.usage;
      if (o.type !== "assistant" || !u || !m.model || m.model === "<synthetic>") continue;
      const key = m.id ? `${m.id}:${o.requestId ?? ""}` : "";
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      const out = u.output_tokens ?? 0;
      const total = (u.input_tokens ?? 0) + out + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
      count(new Date(o.timestamp), m.model, total, out, `claude:${o.sessionId}`);
    }
  }

  // Codex reports running totals per session, sometimes repeated, so count the growth between events.
  for (const file of codexRoots.flatMap(jsonlFiles)) {
    let model = "Codex";
    let prevTotal = 0;
    let prevOutput = 0;
    for (const o of jsonLines(file, '"type"')) {
      if (o.type === "turn_context" && o.payload?.model) model = o.payload.model;
      const t = o.type === "event_msg" && o.payload?.type === "token_count" ? o.payload.info?.total_token_usage : null;
      if (!t || t.total_tokens <= prevTotal) continue;
      count(new Date(o.timestamp), model, t.total_tokens - prevTotal, (t.output_tokens ?? 0) - prevOutput, `codex:${file}`);
      prevTotal = t.total_tokens;
      prevOutput = t.output_tokens ?? 0;
    }
  }

  let fallback = 0;
  const colorFor = (name: string) => MODEL_COLORS[name] ?? FALLBACK_COLORS[fallback++ % FALLBACK_COLORS.length];
  return { tokens, output, sessions: sessions.size, activeDays: days.size, models: slices(byModel, TOP_MODELS, colorFor) };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (n: number) => n.toLocaleString("en-US");
const compact = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : num(n);
const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}...` : s);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function renderCard(stats: Stats, usage: Usage, t: Theme, date: string): string {
  const W = 800;
  const pad = 32;
  const inner = W - pad * 2;
  const parts: string[] = [];
  const text = (x: number, y: number, size: number, fill: string, body: string, extra = "") =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}"${extra}>${body}</text>`;
  const heading = (y: number, left: string, right: string) => {
    parts.push(text(pad, y, 15, t.text, left, ` font-weight="600"`));
    parts.push(text(W - pad, y, 14, t.muted, right, ` text-anchor="end"`));
  };
  const figures = (y: number, items: [string, string][]) =>
    items.forEach(([value, label], i) => {
      const x = pad + (i * inner) / items.length;
      parts.push(text(x, y, 34, t.text, value, ` font-weight="700" letter-spacing="-0.5"`));
      parts.push(text(x, y + 24, 15, t.muted, label));
    });
  // A rounded stacked bar with a 4-column legend under it. Returns the y just below the legend.
  const stackedBar = (y: number, id: string, items: Slice[]) => {
    const barH = 10;
    let x = pad;
    const segments = items.map((s, i) => {
      const w = (s.percent / 100) * inner;
      const drawn = i === items.length - 1 ? w : Math.max(w - 2, 1);
      const rect = `<rect x="${x.toFixed(2)}" y="${y}" width="${drawn.toFixed(2)}" height="${barH}" fill="${s.color || t.other}"/>`;
      x += w;
      return rect;
    });
    parts.push(`<defs><clipPath id="${id}"><rect x="${pad}" y="${y}" width="${inner}" height="${barH}" rx="${barH / 2}"/></clipPath></defs>`);
    parts.push(`<g clip-path="url(#${id})">${segments.join("") || `<rect x="${pad}" y="${y}" width="${inner}" height="${barH}" fill="${t.empty}"/>`}</g>`);
    const cols = 4;
    const rowH = 26;
    items.forEach((s, i) => {
      const lx = pad + (i % cols) * (inner / cols);
      const ly = y + barH + 30 + Math.floor(i / cols) * rowH;
      parts.push(`<circle cx="${lx + 5}" cy="${ly - 4}" r="5" fill="${s.color || t.other}"/>`);
      parts.push(text(lx + 16, ly, 15, t.text, `${esc(truncate(s.name, 18))} <tspan fill="${t.muted}">${s.percent.toFixed(1)}%</tspan>`));
    });
    return y + barH + 30 + (Math.max(1, Math.ceil(items.length / cols)) - 1) * rowH;
  };

  // GitHub
  heading(44, "Last 12 months on GitHub", `Private repos included (${stats.privateShare}% of mine)`);
  figures(98, [
    [num(stats.contributions), "contributions"],
    [num(stats.commits), "commits"],
    [num(stats.pullRequests), "pull requests"],
    [num(stats.repos), "repos touched"],
  ]);

  const chartTop = 152;
  const chartH = 64;
  const n = stats.weeks.length || 1;
  const gap = 3;
  const barW = (inner - gap * (n - 1)) / n;
  const max = Math.max(1, ...stats.weeks.map((w) => w.count));
  let lastLabelX = -Infinity;
  let lastMonth = -1;
  stats.weeks.forEach((w, i) => {
    const x = pad + i * (barW + gap);
    const h = w.count ? Math.max(4, (w.count / max) * chartH) : 2;
    const opacity = w.count ? (0.45 + 0.55 * (w.count / max)).toFixed(2) : "1";
    parts.push(`<rect x="${x.toFixed(2)}" y="${(chartTop + chartH - h).toFixed(2)}" width="${barW.toFixed(2)}" height="${h.toFixed(2)}" rx="${Math.min(2, barW / 2).toFixed(2)}" fill="${w.count ? t.accent : t.empty}" fill-opacity="${opacity}"/>`);
    const month = Number(w.start.slice(5, 7)) - 1;
    if (month !== lastMonth && i > 0 && x - lastLabelX > 40 && x < W - pad - 28) {
      parts.push(text(Math.round(x), chartTop + chartH + 22, 13, t.muted, MONTHS[month] ?? ""));
      lastLabelX = x;
    }
    lastMonth = month;
  });

  const langTop = chartTop + chartH + 64;
  parts.push(text(pad, langTop, 15, t.text, "Languages", ` font-weight="600"`));
  let y = stackedBar(langTop + 16, "langbar", stats.languages);

  // AI usage, only when this machine has logs
  if (usage.tokens > 0) {
    y += 34;
    parts.push(`<line x1="${pad}" y1="${y}" x2="${W - pad}" y2="${y}" stroke="${t.border}" stroke-width="1"/>`);
    y += 40;
    heading(y, "Last 12 months with AI", "Claude Code and Codex, from my local logs");
    figures(y + 54, [
      [compact(usage.tokens), "tokens processed"],
      [compact(usage.output), "tokens written"],
      [num(usage.sessions), "sessions"],
      [num(usage.activeDays), "active days"],
    ]);
    y = stackedBar(y + 108, "modelbar", usage.models);
  }

  const footerY = y + 40;
  parts.push(text(pad, footerY, 13, t.muted, `Totals only, no repo names. Updated ${date}.`));
  const H = footerY + 26;

  const ai = usage.tokens > 0 ? `, ${compact(usage.tokens)} AI tokens processed` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif">
<title id="t">Last 12 months: ${num(stats.contributions)} contributions, ${num(stats.commits)} commits, ${num(stats.pullRequests)} pull requests across ${num(stats.repos)} repos, private included${ai}</title>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="16" fill="${t.surface}" stroke="${t.border}" stroke-width="2"/>
${parts.join("\n")}
</svg>
`;
}

async function fetchPosts(): Promise<Post[]> {
  const xml = FIXTURES
    ? readFileSync(join(FIXTURES, "rss.xml"), "utf8")
    : await fetch(FEED_URL, { headers: { "User-Agent": "flexchar-profile" } }).then((r) => {
        if (!r.ok) throw new Error(`feed returned HTTP ${r.status}`);
        return r.text();
      });
  const field = (item: string, tag: string) => {
    const m = item.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`));
    return m ? m[1].trim() : "";
  };
  const decode = (s: string) =>
    s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    .map(([, item]) => ({ title: decode(field(item, "title")), link: field(item, "link"), date: new Date(field(item, "pubDate")) }))
    .filter((p) => p.title && p.link.startsWith("https://") && !Number.isNaN(p.date.getTime()))
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, POST_COUNT);
}

function updateReadme(posts: Post[]) {
  const readme = readFileSync(README, "utf8");
  const start = "<!-- BLOG:START -->";
  const end = "<!-- BLOG:END -->";
  const from = readme.indexOf(start);
  const to = readme.indexOf(end);
  if (from < 0 || to < from) fail("README.md is missing the BLOG:START / BLOG:END markers");
  const mdEscape = (s: string) => s.replace(/([\[\]\\])/g, "\\$1");
  const lines = posts.map(
    (p) => `- [${mdEscape(p.title)}](${p.link}) <sub>${MONTHS[p.date.getUTCMonth()]} ${p.date.getUTCFullYear()}</sub>`,
  );
  // Fixture posts are fake, so print them instead of touching the real README.
  if (FIXTURES) return console.log(lines.join("\n"));
  const next = `${readme.slice(0, from + start.length)}\n${lines.join("\n")}\n${readme.slice(to)}`;
  if (next !== readme) writeFileSync(README, next);
}

// Skip rewriting a card when only the "Updated" date would change, so quiet runs make no commit.
function writeCard(file: string, svg: string) {
  const strip = (s: string) => s.replace(/Updated \d{4}-\d{2}-\d{2}\./, "");
  if (existsSync(file) && strip(readFileSync(file, "utf8")) === strip(svg)) return;
  writeFileSync(file, svg);
}

// Commits only the generated files, so anything else in the working tree is left alone.
function publish() {
  const files = ["README.md", ...CARDS];
  const git = (...args: string[]) => Bun.spawnSync(["git", ...args], { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  if (!git("add", "--", ...files).success) fail("git add failed");
  if (git("diff", "--cached", "--quiet", "--", ...files).success) return console.log("Nothing changed, nothing to publish");
  if (!git("commit", "-m", "chore: refresh profile", "--", ...files).success) fail("git commit failed");
  if (!git("push").success) fail("git push failed");
}

async function main() {
  if (PUBLISH && FIXTURES) fail("Refusing to publish fixture data");
  const stats = aggregate(await fetchViewer());
  const usage = collectUsage();
  const date = new Date().toISOString().slice(0, 10);
  CARDS.forEach((file, i) => writeCard(file, renderCard(stats, usage, Object.values(THEMES)[i], date)));
  console.log(`GitHub: ${stats.contributions} contributions, ${stats.commits} commits, ${stats.pullRequests} PRs, ${stats.repos} repos, ${stats.privateShare}% private`);
  console.log(`AI: ${compact(usage.tokens)} tokens, ${compact(usage.output)} written, ${usage.sessions} sessions, ${usage.activeDays} days`);
  console.log(`Models: ${usage.models.map((m) => `${m.name} ${m.percent.toFixed(1)}%`).join(", ") || "none found"}`);

  // A feed hiccup should not block the stats update, so the old post list just stays.
  try {
    const posts = await fetchPosts();
    if (posts.length) updateReadme(posts);
    console.log(`Blog: ${posts.length} posts from the feed`);
  } catch (err) {
    console.warn(`Skipping blog posts: ${(err as Error).message}`);
  }

  if (PUBLISH) publish();
}

await main();

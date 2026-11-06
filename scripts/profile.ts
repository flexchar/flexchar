// Regenerates the dynamic parts of the profile README:
//   assets/activity-{light,dark}.svg  - last 12 months of activity plus the language mix,
//                                      across every repo the token owner owns, private included
//   README.md between BLOG markers     - latest posts from Lukas' Notes
// Only totals are written. Repo names never leave this process.
//
// Local run against fake data:
//   PROFILE_FIXTURES=scripts/fixtures bun run scripts/profile.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Notebook JSON (outputs, base64 images) inflates byte counts far beyond the code it holds.
const EXCLUDED_LANGUAGES = new Set(["Jupyter Notebook"]);
const TOP_LANGUAGES = 8;
const FEED_URL = "https://lukasnotes.dk/rss.xml";
const POST_COUNT = 3;

const ROOT = join(import.meta.dir, "..");
const README = join(ROOT, "README.md");
const FIXTURES = process.env.PROFILE_FIXTURES;

type Theme = { surface: string; border: string; text: string; muted: string; empty: string; accent: string; other: string };
const THEMES: Record<"light" | "dark", Theme> = {
  light: { surface: "#f6f8fa", border: "#d0d7de", text: "#1f2328", muted: "#656d76", empty: "#d0d7de", accent: "#2da44e", other: "#8c959f" },
  dark: { surface: "#161b22", border: "#30363d", text: "#e6edf3", muted: "#8b949e", empty: "#30363d", accent: "#39d353", other: "#6e7681" },
};

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

async function fetchViewer(): Promise<Viewer> {
  if (FIXTURES) return JSON.parse(readFileSync(join(FIXTURES, "viewer.json"), "utf8"));
  const token = process.env.GH_STATS_TOKEN;
  if (!token) fail("Missing GH_STATS_TOKEN: a classic token with repo and read:user scopes.");
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
  const sorted = [...bytes].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
  const total = sorted.reduce((sum, l) => sum + l.bytes, 0) || 1;
  const top = sorted.slice(0, TOP_LANGUAGES).map((l) => ({ name: l.name, color: l.color ?? "", percent: (l.bytes / total) * 100 }));
  const rest = sorted.slice(TOP_LANGUAGES).reduce((sum, l) => sum + l.bytes, 0);
  if (rest > 0) top.push({ name: "Other", color: "", percent: (rest / total) * 100 });

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
    languages: top,
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (n: number) => n.toLocaleString("en-US");
const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}...` : s);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function renderCard(stats: Stats, t: Theme, date: string): string {
  const W = 800;
  const pad = 32;
  const inner = W - pad * 2;
  const parts: string[] = [];
  const text = (x: number, y: number, size: number, fill: string, body: string, extra = "") =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}"${extra}>${body}</text>`;

  // Header
  parts.push(text(pad, 44, 15, t.text, "Last 12 months", ` font-weight="600"`));
  parts.push(text(W - pad, 44, 14, t.muted, `Private repos included (${stats.privateShare}% of mine)`, ` text-anchor="end"`));

  // Headline numbers
  const figures: [number, string][] = [
    [stats.contributions, "contributions"],
    [stats.commits, "commits"],
    [stats.pullRequests, "pull requests"],
    [stats.repos, "repos touched"],
  ];
  figures.forEach(([value, label], i) => {
    const x = pad + (i * inner) / figures.length;
    parts.push(text(x, 98, 34, t.text, num(value), ` font-weight="700" letter-spacing="-0.5"`));
    parts.push(text(x, 122, 15, t.muted, label));
  });

  // Weekly activity columns
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
    const fill = w.count ? t.accent : t.empty;
    const opacity = w.count ? (0.45 + 0.55 * (w.count / max)).toFixed(2) : "1";
    parts.push(`<rect x="${x.toFixed(2)}" y="${(chartTop + chartH - h).toFixed(2)}" width="${barW.toFixed(2)}" height="${h.toFixed(2)}" rx="${Math.min(2, barW / 2).toFixed(2)}" fill="${fill}" fill-opacity="${opacity}"/>`);
    const month = Number(w.start.slice(5, 7)) - 1;
    if (month !== lastMonth && i > 0 && x - lastLabelX > 40 && x < W - pad - 28) {
      parts.push(text(Math.round(x), chartTop + chartH + 22, 13, t.muted, MONTHS[month] ?? ""));
      lastLabelX = x;
    }
    lastMonth = month;
  });

  // Languages
  const langTop = chartTop + chartH + 64;
  parts.push(text(pad, langTop, 15, t.text, "Languages", ` font-weight="600"`));
  const barY = langTop + 16;
  const barH = 10;
  let x = pad;
  const segments = stats.languages.map((l, i) => {
    const w = (l.percent / 100) * inner;
    const drawn = i === stats.languages.length - 1 ? w : Math.max(w - 2, 1);
    const s = `<rect x="${x.toFixed(2)}" y="${barY}" width="${drawn.toFixed(2)}" height="${barH}" fill="${l.color || t.other}"/>`;
    x += w;
    return s;
  });
  parts.push(`<defs><clipPath id="langbar"><rect x="${pad}" y="${barY}" width="${inner}" height="${barH}" rx="${barH / 2}"/></clipPath></defs>`);
  parts.push(`<g clip-path="url(#langbar)">${segments.join("") || `<rect x="${pad}" y="${barY}" width="${inner}" height="${barH}" fill="${t.empty}"/>`}</g>`);
  const cols = 4;
  const rowH = 26;
  stats.languages.forEach((l, i) => {
    const lx = pad + (i % cols) * (inner / cols);
    const ly = barY + barH + 30 + Math.floor(i / cols) * rowH;
    parts.push(`<circle cx="${lx + 5}" cy="${ly - 4}" r="5" fill="${l.color || t.other}"/>`);
    parts.push(text(lx + 16, ly, 15, t.text, `${esc(truncate(l.name, 18))} <tspan fill="${t.muted}">${l.percent.toFixed(1)}%</tspan>`));
  });
  const rows = Math.max(1, Math.ceil(stats.languages.length / cols));
  const footerY = barY + barH + 30 + (rows - 1) * rowH + 40;
  parts.push(text(pad, footerY, 13, t.muted, `Totals only, no repo names. Updated ${date}.`));
  const H = footerY + 26;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif">
<title id="t">Activity in the last 12 months: ${num(stats.contributions)} contributions, ${num(stats.commits)} commits, ${num(stats.pullRequests)} pull requests across ${num(stats.repos)} repos, private included</title>
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
  const next = `${readme.slice(0, from + start.length)}\n${lines.join("\n")}\n${readme.slice(to)}`;
  if (next !== readme) writeFileSync(README, next);
}

// Skip rewriting a card when only the "Updated" date would change, so quiet weeks make no commit.
function writeCard(file: string, svg: string) {
  const strip = (s: string) => s.replace(/Updated \d{4}-\d{2}-\d{2}\./, "");
  if (existsSync(file) && strip(readFileSync(file, "utf8")) === strip(svg)) return;
  writeFileSync(file, svg);
}

async function main() {
  const stats = aggregate(await fetchViewer());
  const date = new Date().toISOString().slice(0, 10);
  for (const [name, theme] of Object.entries(THEMES)) {
    writeCard(join(ROOT, "assets", `activity-${name}.svg`), renderCard(stats, theme, date));
  }
  console.log(`${stats.contributions} contributions, ${stats.commits} commits, ${stats.pullRequests} PRs, ${stats.repos} repos, ${stats.privateShare}% private`);
  console.log(stats.languages.map((l) => `${l.name} ${l.percent.toFixed(1)}%`).join(", "));

  // A feed hiccup should not block the stats update, so the old post list just stays.
  try {
    const posts = await fetchPosts();
    if (posts.length) updateReadme(posts);
    console.log(`${posts.length} posts from the feed`);
  } catch (err) {
    console.warn(`Skipping blog posts: ${(err as Error).message}`);
  }
}

await main();

# Memory

Durable facts learned while working on this repo.

- The owner does not want their full name on the public profile. The banner says "AI engineer" instead.
- LinkedIn: https://www.linkedin.com/in/luvan/ (a search hit for /in/lukasvanagas is someone else).
- Blog: Lukas' Notes at https://lukasnotes.dk, hosted on Hashnode, RSS at /rss.xml.
- "Deco" is a project the owner wants featured. Its description and URL are still unknown; there is a TODO comment in README.md.
- Generation runs locally on the owner's Mac, not in GitHub Actions, because AI usage comes from local logs and `gh auth token` avoids storing a personal access token.
- Claude Code cloud sessions cannot call GitHub GraphQL or user-level REST endpoints, and lukasnotes.dk is blocked by the session proxy. In a cloud session the generator can only be tested with fixtures.
- Commits from Claude sessions must use committer `Claude <noreply@anthropic.com>`, or a stop hook flags them as unverified.

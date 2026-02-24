---
name: yams-search
description: Search YAMS memories for relevant context
user-invocable: true
argument-hint: [search query]
---

Search YAMS for relevant memories using the `search` MCP tool.

Use `$ARGUMENTS` as the search query. If no arguments provided, ask the user what they want to search for.

Detect the current project's git remote:
```bash
git remote get-url origin 2>/dev/null | sed 's|.*github.com[:/]||;s|\.git$||'
```

Call the `search` MCP tool with:
- `query`: the search text
- `project`: the git remote (if available, to prioritize project-specific results)
- `limit`: 10 (default, unless user asks for more)

Present results clearly:
- Show each memory's summary and scope
- Include relevance scores
- Group by scope if there are many results
- If no results found, suggest broadening the query or checking a different scope

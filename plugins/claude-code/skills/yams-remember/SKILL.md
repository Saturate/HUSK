---
name: yams-remember
description: Save a memory to YAMS with a specific scope
user-invocable: true
argument-hint: [what to remember]
---

Store a memory in YAMS using the `remember` MCP tool.

Use `$ARGUMENTS` as the content to remember. If no arguments provided, ask the user what they want to remember.

Determine the appropriate scope:
- **session** (default) - relevant to this coding session only
- **project** - useful across sessions for this project
- **global** - useful across all projects

If the user doesn't specify a scope, infer it from context. Prefer `project` for project-specific patterns, conventions, or decisions. Use `global` for general preferences or cross-project insights.

Detect the current project's git remote automatically:
```bash
git remote get-url origin 2>/dev/null | sed 's|.*github.com[:/]||;s|\.git$||'
```

Call the `remember` MCP tool with `content`, `scope`, and `project` (git remote if available).

Confirm to the user what was stored and at what scope.

---
name: husk-init
description: First-time HUSK setup - configure server URL, create a machine key, and write env vars to shell profile
user-invocable: true
allowed-tools: Bash, Read, Write, Edit, AskUserQuestion
argument-hint: [server-url]
---

Set up HUSK on this machine. Walk the user through connecting to their HUSK server.

## Steps

1. **Get server URL**: Use `$ARGUMENTS` if provided, otherwise ask. Default: `http://localhost:3000`
2. **Verify connectivity**: `curl -sf {url}/health` - confirm HUSK is reachable
3. **Get admin credentials**: Ask for username and password
4. **Login**: `POST {url}/api/auth/login` with credentials to get a JWT
5. **Create machine key**: `POST {url}/api/keys` with label `claude-code-{hostname}` using the JWT
6. **Write env vars**: Append `HUSK_URL` and `HUSK_KEY` to the user's shell profile (`~/.zshrc`, `~/.bashrc`, or `~/.profile` - ask which one or detect current shell)
7. **Verify**: Confirm the MCP server is configured by checking that the plugin's `.mcp.json` references `${HUSK_URL}` and `${HUSK_KEY}`

## Important

- Never log or display the full API key after creation - only show the prefix
- The key is shown exactly once by the server; store it immediately
- If `HUSK_URL` and `HUSK_KEY` are already set, ask before overwriting

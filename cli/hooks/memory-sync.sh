#!/usr/bin/env bash
# HUSK memory sync hook for Claude Code
#
# Intercepts memory file writes and syncs them to the HUSK server.
# Requires HUSK_URL and HUSK_API_KEY environment variables (or ~/.husk/husk.toml).
#
# Install as a PostToolUse hook in ~/.claude/settings.json:
# {
#   "hooks": {
#     "PostToolUse": [{
#       "matcher": "Write",
#       "hooks": [{
#         "type": "command",
#         "command": "bash /path/to/memory-sync.sh"
#       }]
#     }]
#   }
# }

[ -z "${CLAUDE_TOOL_INPUT:-}" ] && exit 0

exec python3 -c "
import json, sys, re, os, urllib.request

tool_input = json.loads(os.environ.get('CLAUDE_TOOL_INPUT', '{}'))
file_path = tool_input.get('file_path', '')
content = tool_input.get('content', '')

# Only process memory files
if '/memory/' not in file_path or not file_path.endswith('.md') or file_path.endswith('/MEMORY.md'):
    sys.exit(0)

# Parse frontmatter
m = re.match(r'^---\s*\n(.*?)\n---\s*\n(.*)', content, re.DOTALL)
if not m:
    sys.exit(0)
fm, body = m.group(1), m.group(2).strip()
if not body:
    sys.exit(0)

def get_field(text, key):
    match = re.search(r'^' + key + r':\s*(.+)$', text, re.MULTILINE)
    return match.group(1).strip().strip('\"\'') if match else ''

name = get_field(fm, 'name')
desc = get_field(fm, 'description')
mtype = get_field(fm, 'type')
if not mtype:
    mtype = get_field(fm.split('\n')[-1] if '\n' in fm else fm, 'type')

type_map = {'user': 'fact', 'feedback': 'lesson', 'project': 'fact', 'reference': 'fact'}
husk_type = type_map.get(mtype, 'fact')
scope = 'global' if mtype in ('user', 'feedback', 'reference') else 'project'

# Derive project from path
project = None
pm = re.search(r'projects/-[^/]+-code-(?:github-)?([^/]+)/', file_path)
if pm:
    project = pm.group(1)

# Read credentials
url = os.environ.get('HUSK_URL', '')
api_key = os.environ.get('HUSK_API_KEY', '')
if not url or not api_key:
    toml = os.path.expanduser('~/.husk/husk.toml')
    if os.path.exists(toml):
        with open(toml) as f:
            for line in f:
                if line.startswith('url') and not url:
                    url = line.split('\"')[1] if '\"' in line else ''
                if line.startswith('api_key') and not api_key:
                    api_key = line.split('\"')[1] if '\"' in line else ''
if not url or not api_key:
    sys.exit(0)

payload = json.dumps({
    'summary': body,
    'scope': scope,
    'git_remote': project,
    'title': desc or name,
    'memory_type': husk_type,
    'metadata': {
        'source': 'claude_code_hook',
        'claude_name': name,
        'claude_type': mtype,
    },
}).encode()

req = urllib.request.Request(
    url.rstrip('/') + '/ingest',
    data=payload,
    headers={
        'Authorization': 'Bearer ' + api_key,
        'Content-Type': 'application/json',
    },
    method='POST',
)

try:
    urllib.request.urlopen(req, timeout=5)
except Exception:
    pass
" 2>/dev/null || true

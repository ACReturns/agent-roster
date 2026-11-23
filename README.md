# agent-roster

A Claude Code mod that opens a pane listing every subagent defined under
`~/.claude/agents/*.md` on your machine: each one's name, its description
(read from the file's frontmatter), and a customizable **Clawd identifier**
badge, drawn alongside a small orange pixel-art crab sprite.

## What it does

- Opens an "Agent Roster" pane automatically when the session starts.
- `/agent-roster` reopens the pane if you've closed it.
- `/clawd-id <agent> [identifier]` sets a custom identifier for an agent
  (e.g. `/clawd-id valerie Fleet-Bot`); leave the identifier out to reset
  it back to its auto-generated default (`CLAWD-XXXX`).
- Each row has an **edit** button that pre-fills the `/clawd-id` command
  for that agent so you only have to type the new value.
- Identifiers persist across restarts (stored in the plugin's own data
  file), so customizations stick around between sessions.

## Setup

No configuration needed. It reads agents from `~/.claude/agents` using
the `USERPROFILE` (Windows) or `HOME` environment variable, so it works
out of the box on any machine with agents defined in that folder.

## Install

```
/plugin install agent-roster --marketplace ACReturns/agent-roster
```

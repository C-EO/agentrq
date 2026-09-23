# Skills

A skill is a playbook an agent loads when a task matches it. It is a directory with a `SKILL.md` and, optionally, other files that the `SKILL.md` points to, such as references, prompts and scripts. It is the same format Claude Code and Antigravity use, so skills written for them work here.

Every workspace has its own skills, and a workspace can share its skills with the other workspaces in the same account.

## A minimal skill

```markdown
---
name: pr-reviewer
description: Use when reviewing a pull request, before leaving any comments.
---

# Reviewing a pull request

1. Read the description, then `references/checklist.md`.
2. Run the tests before commenting on style.
```

- `description` is required. It says what the skill does and when to use it, because an agent decides whether to load a skill from its description.
- `name` is optional and defaults to the skill's directory name.
- Any other frontmatter keys are kept. The body can be empty.

## Rules and limits

| | |
|---|---|
| File name | Exactly `SKILL.md` |
| `name` | Lowercase letters and digits joined by single hyphens, at most 64 characters. Unique among the skills a workspace can use, including skills shared into it |
| `description` | Required, at most 1024 characters, no `<` or `>` |
| `SKILL.md` size | At most 16 KiB |
| Other files | At most 64 KiB each, UTF-8 text only |
| Paths | Relative to the skill. No `..`, no absolute paths, no hidden files, at most 255 characters |
| Files per skill | At most 64, including `SKILL.md` |

Anything over a limit is refused, never truncated. The error says what to change.

## Importing from GitHub

In a workspace's **Settings → Skills**, paste a public GitHub link and choose **Import**. Accepted forms:

```
https://github.com/obra/superpowers
https://github.com/obra/superpowers.git
https://github.com/obra/superpowers/tree/main
https://github.com/obra/superpowers/tree/main/skills/systematic-debugging
```

**Which directories are skills:**
- If the repository has a plugin manifest, `.agentrq/plugin.json` or else Muse's `.muse-plugin/plugin.json`, its `capabilities.skills` list decides.
- Otherwise every directory with a `SKILL.md` is a skill.

**Which files are kept:** a skill's `SKILL.md` and the files it references, then the files those reference in turn. A file counts as referenced when it is named by its path, by a relative path, or through a folder written with a trailing `/`. Everything else is left out.

**The import report** lists what was imported and, for everything skipped, the reason. For example:
- a `SKILL.md` over 16 KiB, which skips the whole skill
- a binary, symlink or hidden file
- a file nothing references
- a name the workspace already uses

Importing obra/superpowers skips its four largest skills for this reason; that is expected.

**Overwrite existing** replaces skills this workspace already owns under the same name. A skill shared into the workspace is never replaced.

## Sharing

On one of your own skills, pick another workspace in the **Share** picker. The skill is not copied. The other workspace reads the same skill, so it sees every later change, but it cannot edit or delete it; only the workspace that owns a skill can. Sharing is limited to workspaces in the same account.

## Reading a skill

The Skills tab lists only skills, never their other files. Opening a skill shows its `SKILL.md`. To open another of its files, click the reference to it in the file you are reading. A reference can be:
- a link, `skill://…` or relative
- inline code that names one of the skill's files exactly, like `` `references/checklist.md` ``

A breadcrumb shows where you are and **Back** returns to where you came from.

## `skill://` URIs

`skill://<name>/<path>` addresses one file, for example `skill://systematic-debugging/SKILL.md` or `skill://brainstorming/scripts/helper.js`. `skill://<name>` alone means the skill's `SKILL.md`.

## MCP tools

On the workspace server, which every agent in the workspace connects to:

| Tool | What it does |
|---|---|
| `listSkills` | The skills this workspace can use, each with its description and `skill://` URI. Contents are not included |
| `loadSkill(uri)` | One file, as stored. A `SKILL.md` comes with the URIs of the skill's other files |
| `saveSkill(uri, content)` | Writes one file of one of this workspace's own skills. Writing `SKILL.md` creates or updates the skill |
| `deleteSkill(uri)` | Deletes a skill (`skill://<name>`) or one of its files. A `SKILL.md` cannot be deleted on its own |

Agents are told to call `listSkills` at the start of a task and to load the `SKILL.md` of any skill that matches it.

The supervisor's account-wide server has read-only `listSkills(workspaceId)` and `getSkill(workspaceId, uri)`.

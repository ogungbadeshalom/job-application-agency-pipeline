---
name: find-skills
description: Inventory the skills available to this project and recommend which to invoke for a given task. Use when the user asks "find skills", "which skill", or "what workflow should I follow".
---

# Find Skills

Lists the skills actually available in this environment and recommends the
right workflow skill for the task at hand, by grepping the skills directories.

## How to look up skills

When asked "which skill should I use for X" (or "find a skill for X"), do this:

2. Grep the available development/workflow skills under:
   `<user>/.claude/plugins/cache/claude-plugins-official/superpowers/*/skills/`
   for the most relevant entry, matching the task keywords.

3. Recommend the single best-fit skill (max 2) with a one-line reason, e.g.:
   - "build a feature / change behavior" → `superpowers:brainstorming` first,
     then an implementation skill.
   - "fix a bug / test failure" → `superpowers:systematic-debugging`.
   - "write an implementation plan" → `superpowers:writing-plans`.
   - "execute an approved plan" → `superpowers:executing-plans`.
   - "finish a branch / integrate" → `superpowers:finishing-a-development-branch`.

## How to install a NEW skill

Skills are markdown instructions loaded at runtime; they are not downloaded
from a website automatically. To add a workflow skill for this repo, create
`<project>/.claude/skills/<skill-name>/SKILL.md` following this file's
frontmatter shape (name + description). The description becomes the discoverable
one-liner. Do NOT invent a skill's contents for any external source (e.g.
skills.sh) you cannot actually read — be honest about what is available.
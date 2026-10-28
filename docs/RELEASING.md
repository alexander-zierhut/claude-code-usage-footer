# Releasing

The plugin is distributed straight from this GitHub repo: `.claude-plugin/marketplace.json` makes the repo its own marketplace (`claude-code-usage-footer`), and users install `usage-footer` from it. There is no build step; Claude Code loads the TypeScript in `hooks/` directly.

## Steps

1. Change the code, then run the tests:

   ```
   claude plugin test .
   ```

   To try it live without installing: `claude --plugin-dir .`

2. Bump `version` in `.claude-plugin/plugin.json` (semver: patch for fixes, minor for visible changes). Users only get an update when the version changes.

3. Update `README.md` when behaviour changes (the "What you see" table and "Changes compared to ribbon").

4. Commit and push. Commit style: emoji, scope in brackets, short lower-case description, no attribution trailers, for example:

   ```
   🐛 (usage-footer) never wrap the footer: ...
   ✨ (usage-footer) ...
   💄 (usage-footer) ...
   📝 (readme) ...
   ```

5. Update the local install and start a new session:

   ```
   claude plugin marketplace update claude-code-usage-footer
   claude plugin update usage-footer@claude-code-usage-footer
   ```

## Install, for others

```
claude plugin install usage-footer --marketplace alexander-zierhut/claude-code-usage-footer
```

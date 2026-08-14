# Repository Guidelines

## Project Structure & Module Organization

- `src/` contains the TypeScript implementation. Main areas are `core/` for review orchestration, `cli/` for command entry points, `mcp/` for MCP tools, `acp/` for backend agent clients, plus `config/`, `context/`, `workspace/`, `security/`, `audit/`, `aggregate/`, `output/`, and `utils/`.
- `test/` is split into `unit/`, `integration/`, `e2e/`, and `fixtures/`.
- `examples/` holds sample MCP and `kyoso.toml` configuration. Files matching `examples/*-source-*` are maintainer-only source MCP templates and are excluded from the npm package.
- `docs/kyoso_detailed_design.md` is the product and architecture source of truth when behavior is ambiguous.
- `.agents/skills/kyoso-review/` contains the packaged Codex skill. `.kyoso/`, `dist/`, and `node_modules/` are generated or local-only paths, as are `.codex/`, `.mcp.json`, and `.claude/skills/`, which hold a maintainer's own review runtime and must stay untracked, along with the Skill install marker the dogfooding section below covers; `.claude/worktrees/` is agent scratch space. See that section for the whole picture.

## Build, Test, and Development Commands

- `nix develop`: enter the repository-pinned Bun / Node.js devShell. Run development commands from this shell; after reviewing `.envrc`, `direnv allow` loads it automatically.
- `safe-chain bun install`: install dependencies from `bun.lock`.
- `safe-chain bun run dev -- <args>`: run the CLI from `src/cli/main.ts`.
- `bun run dev:mcp [-- <args>]`: run the MCP server from the current source. Maintainer-only; see the dogfooding section below. Listed without `safe-chain` because an MCP client spawns this command directly and cannot be assumed to have the shim on `PATH`.
- `safe-chain bun run typecheck`: run strict TypeScript checks with no emit.
- `safe-chain bun test`: run Bun unit, integration, and e2e tests.
- `safe-chain bun run build`: build the library, CLI binary, and declaration files into `dist/`.
- `safe-chain bun run format`: format the repository with Prettier.

## Coding Style & Naming Conventions

- Use TypeScript ES modules with explicit `.js` import suffixes for local runtime imports.
- Keep strict typing compatible with `strict` and `noUncheckedIndexedAccess`.
- Prefer named exports and descriptive camelCase function names; reserve PascalCase for types, classes, and schemas.
- Follow the existing two-space indentation and Prettier formatting.

## Testing Guidelines

- Tests use `bun:test`; name files `*.test.ts` under the matching `test/` tier.
- Add unit coverage for pure policy, parsing, aggregation, and validation logic.
- Add integration or e2e coverage when touching `runReview`, ACP process handling, CLI behavior, snapshots, or MCP responses.
- Keep fixtures in `test/fixtures/` and avoid real provider credentials.

## Implementation Scope & Harness Proportionality

- This section applies to implementation work only. It does not alter Kyoso review coverage, finding admission, or reporting of concrete findings.
- Treat the active plan's explicit behavior and implementation steps as the scope boundary. Prefer the smallest implementation that satisfies that contract.
- Do not add persistent or bespoke operational harnesses—such as migration journals, locks, backup copies, recovery state machines, or generalized test frameworks—solely for hypothetical races.
- Add such machinery only when the plan explicitly requires it, a reproducible failure demonstrates that the planned primitive is insufficient, or a mandatory security/property requirement cannot be met more simply.
- When implementation must materially expand beyond the plan, present the concrete need and smallest alternative, then obtain user approval before changing code.
- Keep tests focused on stated contracts and concrete regressions; do not build generalized harnesses merely to cover speculative scenarios.

## Commit & Pull Request Guidelines

- Use Conventional Commits, matching the current history, for example `feat: implement kyoso mvp` or `fix: block recursive kyoso calls`.
- PRs should include a short behavior summary, linked issue or design reference, and the commands run.
- Include CLI output or screenshots only when user-facing behavior changes.
- Call out changes to security policy, network mode, audit traces, or config execution risk.

## Security & Agent-Specific Notes

- Do not commit `.kyoso/` traces, secrets, dependency folders, or build output.
- Treat `kyoso.config.ts` as executable code; use `--ignore-config` for untrusted repositories.
- Invoke the `kyoso-review` skill only for explicit multi-agent plan, security, CISA, or diff review requests. Kyoso reviews only; it must not apply code changes.

## Running Kyoso Reviews in This Repository (dogfooding)

- Choose one review runtime explicitly. This repository must not track a
  project-local MCP registration — `.codex/config.toml` for Codex, `.mcp.json`
  for Claude Code; a project-local `kyoso` server can silently override the
  installed Plugin or the user's published-CLI MCP. Keep your own copies
  untracked and name the source server `kyoso-source`; `plugin:verify` rejects
  either file once it is tracked, so this is enforced, not just advised. Doctor's coverage is
  asymmetric: it reads `<cwd>/.mcp.json`, so a misnamed Claude Code entry
  surfaces as `custom/unverified`, but it reads only the Codex config
  `CODEX_HOME` or `~/.codex` resolves to, so unless `CODEX_HOME` points at it,
  a misnamed Codex entry in a project-local `.codex/config.toml` is invisible
  to it.
- To test the installed Plugin, invoke the installed `kyoso:kyoso-review` Skill
  and do not add a project-local `kyoso` MCP entry.
- To test a user-managed published-CLI MCP, use
  `kyoso setup codex --write --global` or
  `kyoso setup claude-code --write --global`. Generated package-runner commands
  use the `kyoso-cli@npm:@kyo-so/cli` alias so this same-named checkout cannot
  shadow the published package. Pass `--global` for both clients. Without it,
  Claude Code setup writes a project-local `<repo>/.mcp.json` entry named
  `kyoso`, which is exactly the override the first rule warns about — it would
  then take precedence over the installed Plugin for every later review. If one
  already exists, remove the `kyoso` entry from `<repo>/.mcp.json` before
  testing the Plugin. Only that name overrides the Plugin, so a `kyoso-source`
  entry a later rule puts in the same file can stay. Without `--global`, Codex
  setup installs the Skill into `<repo>/.agents/skills/kyoso-review` — this
  repository's own canonical Skill, which ships inside the npm package. Setup
  adopts a matching copy by writing `.kyoso-install.json` there, and replaces a
  known historical copy outright, neither of which needs `--force`. `.gitignore`
  keeps both that marker and the project-local Claude Code Skill out of
  `git add`. `npm pack` does not consult `.gitignore` while a `files` allowlist
  is in place, and the marker sits inside a directory that allowlist ships, so
  `pack:verify` is the only publish-stage gate, tracked or not. A Skill copy
  under `.claude/` is outside that allowlist to begin with, and the same
  verifier's `.claude/` prefix rejection is a second layer over that. `--global`
  moves the Codex Skill and its marker to `~/.agents/skills/`, and the Claude
  Code Skill to `~/.claude/skills/`. It leaves the Codex MCP entry where it is,
  but it does write the Claude Code MCP entry to `~/.claude.json` instead of
  `<repo>/.mcp.json`. It never removes an existing project-local entry, so the
  hand deletion above is still yours to do.
- Only one MCP server named `kyoso` should be active while you test. A global
  registration written above stays in effect for every repository, so disable
  or remove it before testing the installed Plugin, and vice versa. Doctor
  reports the pair as `Plugin and manual Codex MCP registrations coexist` and
  does not infer which one answers.
- To test the published CLI without MCP, use
  `npx -y --package=kyoso-cli@npm:@kyo-so/cli kyoso ...` or the equivalent
  `bunx --package kyoso-cli@npm:@kyo-so/cli kyoso ...` command.
- To test the current source through MCP, copy the relevant
  `examples/*-source-*` entry into this checkout's project-local client
  configuration and invoke `kyoso-source` explicitly. Its command is
  `bun run dev:mcp`. Register it project-locally only: nothing in the entry
  binds it to this checkout, so a global registration would run whichever
  repository the client happens to launch it from, and would pass that
  repository's `dev:mcp` the whole forwarded credential set. The source entries
  forward `OPENROUTER_API_KEY` unconditionally, where `kyoso setup` adds it to a
  registration it generates only under `--with-openrouter`. The Codex template
  says so in its own comments; the Claude Code one cannot, because JSON has no
  comment syntax.
- To test the current source through CLI, run:
  - `safe-chain bun run dev -- diff --diff <patch> --file <files...> --json`
  - `safe-chain bun run dev -- plan --goal "<goal>" --plan <plan.md> --json`
  - `safe-chain bun run dev -- security --goal "<goal>" --diff <patch> --json`
- In THIS repository only, do not pass `--ignore-config`: the local `kyoso.toml` enables the verification round for dogfooding, and `--ignore-config` silently disables it. `kyoso.toml` needs no trust approval, so `--trust-config` is unnecessary here — it only approves executing a legacy `kyoso.config.ts`, and must never be reused in other repositories.
- When the JSON result contains findings with `verification.status` of `refuted` or `confirmed`, mention them explicitly in your report.
- Note: `.agents/skills/kyoso-review/SKILL.md` is shipped inside the npm package. Keep it generic; repository-specific workflow guidance belongs here in AGENTS.md.

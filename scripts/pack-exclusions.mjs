// The per-path rejections `pack:verify` applies to a packed tarball, split out
// so they can be unit-tested. `verify-pack.mjs` itself runs `npm pack` at the
// top level, so importing it from a test would run the whole verifier; these
// rules are pure over a file list and need none of that. A clean checkout only
// ever exercises the passing side of them, which would let a typo in a pattern
// go unnoticed — and for the install marker that is the whole defense, since
// `npm pack` does not consult `.gitignore` while a `files` allowlist is in
// place.

// Maintainer-only source MCP templates run the checkout through `bun run
// dev:mcp`; they are meaningless to package consumers and must stay unpublished.
// Both halves assume `examples/` is flat: npm's `*` and the `[^/]*` below stop
// at a `/`, so a template moved into a subdirectory would slip past both.
export const maintainerOnlyExampleGlob = "!examples/*-source-*";
export const maintainerOnlyExamplePattern = /^examples\/[^/]*-source-[^/]*$/;

const forbiddenPrefixes = [
  "src/",
  "ai/",
  ".kyoso/",
  ".claude/",
  "node_modules/",
  "test/",
  ".github/",
  "plugins/",
  ".agents/plugins/",
  ".claude-plugin/",
];

export function packageEntryFailures(filePaths) {
  const failures = [];
  for (const prefix of forbiddenPrefixes) {
    if (filePaths.some((path) => path.startsWith(prefix))) {
      failures.push(`forbidden package prefix included: ${prefix}`);
    }
  }
  for (const path of filePaths.filter((path) =>
    maintainerOnlyExamplePattern.test(path),
  )) {
    failures.push(`maintainer-only example included: ${path}`);
  }
  // A maintainer who runs `kyoso setup codex --write` without `--global` in this
  // checkout gets an install marker written into the canonical Skill, which
  // ships. Publishing it would make every consumer's fresh copy look like an
  // already-adopted managed install. `.gitignore` keeps a marker out of
  // `git add`, but it stops there: `npm pack` reads the working tree, and while
  // a `files` allowlist is in place it does not consult the repository's
  // `.gitignore` at all, so an untracked marker would ship exactly like a
  // tracked one. `pack:verify` is the only publish-stage gate for it, tracked
  // or not: `plugin:verify` compares canonical and mirror as whole file sets
  // and would reject a one-sided marker, but `plugin:sync` copies the marker
  // across and the comparison then passes, and the Skill digest excludes the
  // marker by design.
  for (const path of filePaths.filter((path) =>
    path.endsWith(".kyoso-install.json"),
  )) {
    failures.push(`Skill install marker included: ${path}`);
  }
  return failures;
}

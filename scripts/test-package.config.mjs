// Per-repo values for the shared scripts/test-package.mjs smoke test.
export default {
  // Every packed tar entry must match; anything else fails before installation.
  files:
    /^package\/(?:index\.ts|src\/[\w-]+\.ts|docs\/[\w-]+\.md|docs\/images\/[\w-]+\.png|package\.json|README\.md|CHANGELOG\.md|LICENSE|SECURITY\.md)$/,
  requiredFiles: ["README.md", "CHANGELOG.md", "LICENSE", "SECURITY.md"],
  tools: ["schedule"],
  commands: ["schedule"],
  // Optional repo-specific behavior checks: async verify({ extension, pkg, installed, root, host }).
};

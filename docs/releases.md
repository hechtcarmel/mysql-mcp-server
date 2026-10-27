# Maintainer release process

These workflows are prepared for review; this change does not publish a package/release, merge code, create credentials, or change repository/npm security settings.

## One-time maintainer setup

The publish job declares `environment: npm`. The npm trusted-publisher binding below must match that environment name and workflow identity. The environment declaration alone does **not** create an approval gate: GitHub can create an undeclared environment without protection rules.

Required reviewers, tag restrictions and bypass controls are optional GitHub protections, recommended for a controlled release; npm OIDC does not require them. Verify the actual settings before relying on an approval gate. If deployment restrictions are enabled, allow the intended release tags (for example, a tag rule for `v*`). Changing these settings requires separate action-time authorization; this document creates or changes none of them.

In the npm package's trusted-publisher settings, authorize this exact GitHub identity:

- Owner: `hechtcarmel`
- Repository: `mysql-mcp-server`
- Workflow filename: `publish.yml` (case-sensitive; filename only)
- Environment: `npm`
- Allowed action: direct `npm publish`; a stage-only publisher does not match this workflow

Create a new trusted-publisher binding near the approved release: its first successful publish must complete within two days, or the binding expires and must be recreated. Private npm bindings and GitHub protection settings cannot be verified by ordinary package CI.

No long-lived npm write token or `NPM_TOKEN` secret is required. The workflow uses a GitHub-hosted runner, Node.js 24, npm 11 (11.5.1+), job-scoped `id-token: write`, and OIDC provenance. The repository URL in `package.json` must match the publishing repository. Do not configure a fork to publish this package.

Consider enabling GitHub immutable releases once the process has been reviewed: attach all assets while the release is a draft, then publish it. This is a separate repository-setting change, not performed by this overhaul.

## Version, review, and release

1. Finish code review and CI, then complete the [read-only Mac trial](local-validation.md) with the user's existing file. Do not substitute a write/mock/rejection suite for that trial.
2. This overhaul selects **2.0.0** because it removes Node.js 18 support and tightens SQL, configuration and error contracts. The existing npm release is 1.0.0; never overwrite it. Check that 2.0.0 is still unused immediately before publication. Future runtime or contract breaks generally warrant a major release; a prerelease such as `2.0.0-rc.1` may be chosen separately when needed.
3. Update `package.json` without prematurely creating a tag, revalidate `pnpm-lock.yaml` (pnpm v9 lockfiles do not store the root package version; a version-only bump may leave the file unchanged), and move the relevant changelog notes under `## [X.Y.Z] - YYYY-MM-DD`. Retain an empty `Unreleased` section for later work. Commit and review the version/changelog change with the implementation.
4. After separate merge authorization, create the matching `vX.Y.Z` tag on the reviewed commit and push it. Never move an existing release tag.
5. Manually run **Prepare release** (`release.yml`) with that existing tag. It validates the manifest/changelog, runs the full CI matrix against the exact tag, builds without restored dependency caches, and creates a **draft** GitHub release with the tested npm tarball and `SHA256SUMS`. It does not publish to npm. Prerelease tags create prerelease drafts.
6. Review generated release notes, compatibility notes, the tarball, checksums, and local-trial evidence. Publish the draft only with maintainer authorization. Publishing the GitHub release triggers `publish.yml`, which waits for environment approval only if required reviewers have been configured. The final CI and actual read-only local-validation gate applies regardless of those optional settings.
7. The npm job downloads the reviewed tarball, verifies its checksum and internal package identity/version, and publishes those same bytes with OIDC provenance. Stable releases use the `latest` dist-tag; prereleases use `next`. It does not rebuild after review.
8. Verify the npm version/dist-tag and provenance, GitHub assets, and a clean `npx` installation with read-only configuration. If something fails, stop and inspect the sanitized error; do not automatically retry or overwrite a published version.

The only workflow with repository write permission is the draft-release job. Normal CI is read-only. Only the npm publish job can request an OIDC token. Workflow files and third-party Actions use explicit entry points and pinned action SHAs; Dependabot proposes updates.

## Validation scope

Cloud unit tests cover SQL policy and write behavior with mocks only. Real database integration/package checks send safe reads against existing system schemas; they create no tables, routines, users, permissions, or test datasets, and do not probe rejected mutations or bad passwords. The real Mac handoff runs only `local-smoke.mjs`, not the aggregate test suite.

Workflow YAML, local validation scripts, and npm packaging can be checked before merging. Hosted CI must pass on the exact candidate commit before the Mac trial. Protected-environment configuration, npm's trusted-publisher binding, the Mac trial, and registry publication require their respective external environments and authorized maintainer actions; ordinary CI does not publish anything.

## Official references

- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers)
- [npm provenance](https://docs.npmjs.com/generating-provenance-statements)
- [GitHub release management](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)
- [GitHub immutable releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)
- [GitHub deployment environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)

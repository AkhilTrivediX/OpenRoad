# OpenRoad Release Operations

OpenRoad releases are promoted from a clean production branch through a release candidate manifest. The manifest records what was built, which gates must pass, and which publishing modes are actually configured.

## Release Commands

Build first:

```powershell
pnpm install --frozen-lockfile
pnpm check
```

Create a dry-run release candidate manifest:

```powershell
pnpm release:verify
```

Create a manifest file for an operator release:

```powershell
pnpm release:plan -- --version 0.1.0-rc.1 --channel rc --output .openroad\releases\openroad-0.1.0-rc.1.json
```

Supported channels:

- `rc`: release candidate.
- `stable`: public stable release.
- `security`: security patch release for an active stable line.

Versions must use semantic versioning, for example `0.1.0`, `0.1.1`, or `0.2.0-rc.1`.

## Manifest Contents

The release manifest includes:

- Manifest version.
- Product name, package version, and private package flag.
- Release version, channel, git commit, generated timestamp, support window, and rollback note.
- Rollback data-migration note, including the current OpenRoad state schema when source metadata is available.
- Required gates: `pnpm check`, built-server smoke, feature evidence, and operator release notes.
- SHA-256 checksums and byte sizes for local build artifacts.
- Docker publishing mode.
- Artifact signing mode.

The manifest must not contain admin tokens, provider secrets, data-file contents, backup contents, requester data, or private workspace data.

## Current Publishing Contract

Docker publishing is currently `dry-run` unless an operator supplies explicit image metadata. The checked-in Dockerfile and Compose path remain build-local and self-hostable.

Artifact signing is currently `not-configured` unless a signing key id is supplied. Do not describe a release as signed unless signing infrastructure is configured outside this repository and the manifest records it.

## Release Candidate Flow

1. Start from pushed `main`.
2. Create a feature branch named for the release work, for example `feat/public-release-ops`.
3. Confirm the feature test plan and evidence are complete.
4. Run `pnpm check`.
5. Start the built server and run `pnpm ops:smoke`.
6. Run `pnpm release:verify`.
7. Generate a manifest with `pnpm release:plan`.
8. Review the manifest for correct version, commit, checksums, dry-run/publish mode, and absence of secrets.
9. Tag and publish only after the release owner confirms the manifest and operator notes.

## Stable Release Flow

Stable releases must have:

- A clean merge commit on `main`.
- Passing CI.
- Passing built-server smoke.
- A generated release manifest.
- Self-host upgrade notes.
- Rollback instructions.
- Known unresolved risks listed in release notes.

## Security Patch Flow

1. Triage privately and identify affected versions.
2. Create a private fix branch when disclosure risk exists.
3. Add or update tests that reproduce the issue without exposing sensitive details.
4. Prepare a `security` channel manifest.
5. Publish patched release notes with affected versions, fixed version, operator action, and rollback guidance.
6. Rotate any affected secrets or tokens when applicable.
7. Keep the patch line supported until superseded by a stable release.

## Support Windows

- Release candidates are supported until the next RC or stable release.
- Stable releases receive standard support until the next stable minor release, with critical fixes for at least 90 days.
- Security releases support the affected active stable line until superseded.

## Self-Host Upgrade

Self-host operators should:

1. Read the release manifest and release notes.
2. Stop writes.
3. Run `pnpm ops:backup`.
4. Deploy the new build or rebuild the Docker image.
5. Start OpenRoad.
6. Run `pnpm ops:smoke`.
7. Keep the previous app build/image and backup until the release is accepted.

## Rollback

1. Stop OpenRoad.
2. Preserve the failed release data files.
3. Restore the previous app build or Docker image.
4. Restore the last known-good backup if the failed release changed or damaged runtime data.
5. Start OpenRoad.
6. Run `pnpm ops:smoke`.
7. Reopen access only after smoke passes.

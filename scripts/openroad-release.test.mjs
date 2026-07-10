import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  createReleaseManifest,
  parseReleaseArgs,
  validateChannel,
  validateSemver
} from "./openroad-release.mjs";

const tempRoots = [];

describe("openroad release operations", () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map(async (root) => {
        await import("node:fs/promises").then(({ rm }) => rm(root, { force: true, recursive: true }));
      })
    );
  });

  it("accepts semantic versions and rejects invalid versions", () => {
    expect(() => validateSemver("1.2.3")).not.toThrow();
    expect(() => validateSemver("1.2.3-rc.1")).not.toThrow();
    expect(() => validateSemver("1.2.3+build.5")).not.toThrow();
    expect(() => validateSemver("1.2")).toThrowError(/semantic versioning/);
    expect(() => validateSemver("01.2.3")).toThrowError(/semantic versioning/);
  });

  it("rejects unsupported release channels", () => {
    expect(() => validateChannel("rc")).not.toThrow();
    expect(() => validateChannel("stable")).not.toThrow();
    expect(() => validateChannel("security")).not.toThrow();
    expect(() => validateChannel("nightly")).toThrowError(/rc, stable, security/);
  });

  it("creates a dry-run release manifest with checksums and no file write", async ({ task }) => {
    const root = await createTempRoot(task.name);
    const { assetFile, outputFile } = await writeBuildArtifacts(root);

    const result = await createReleaseManifest({
      channel: "rc",
      commit: "abc123",
      createdAt: "2026-07-04T00:00:00.000Z",
      dryRun: true,
      outputFile,
      rootDir: root,
      version: "0.1.0-rc.1"
    });

    const expectedHash = createHash("sha256").update(await readFile(assetFile)).digest("hex");
    expect(result.wrote).toBe(false);
    await expect(stat(outputFile)).rejects.toMatchObject({ code: "ENOENT" });
    expect(result.manifest).toMatchObject({
      docker: { mode: "dry-run" },
      manifestVersion: 1,
      product: { name: "openroad", private: true, version: "0.1.0-rc.1" },
      release: {
        channel: "rc",
        commit: "abc123",
        rollback: {
          dataMigration: expect.stringContaining(
            "OpenRoad state schema 6; integration metadata schema 3; session metadata schema 2; team metadata schema 4"
          )
        },
        version: "0.1.0-rc.1"
      },
      signing: { mode: "not-configured" }
    });
    expect(result.manifest.gates.map((gate) => gate.id)).toEqual([
      "automated-check",
      "built-server-smoke",
      "feature-evidence",
      "operator-release-notes"
    ]);
    expect(result.manifest.release.rollback.dataMigration).toContain(
      "Back up state, integration, session, and team files before upgrade"
    );
    expect(result.manifest.artifacts).toContainEqual({
      path: "dist/assets/index.js",
      sha256: expectedHash,
      sizeBytes: 18
    });
  });

  it("writes a release manifest when not in dry-run mode", async ({ task }) => {
    const root = await createTempRoot(task.name);
    const { outputFile } = await writeBuildArtifacts(root);

    const result = await createReleaseManifest({
      channel: "stable",
      commit: "release-sha",
      createdAt: "2026-07-04T01:00:00.000Z",
      outputFile,
      rootDir: root,
      version: "0.1.0"
    });

    const persisted = JSON.parse(await readFile(outputFile, "utf8"));
    expect(result.wrote).toBe(true);
    expect(persisted.release.channel).toBe("stable");
    expect(persisted.release.supportWindow).toContain("90 days");
  });

  it("fails when required production artifacts are missing", async ({ task }) => {
    const root = await createTempRoot(task.name);
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "openroad", private: true, version: "0.1.0" }));

    await expect(
      createReleaseManifest({
        channel: "rc",
        commit: "abc123",
        dryRun: true,
        rootDir: root,
        version: "0.1.0-rc.1"
      })
    ).rejects.toMatchObject({ code: "missing_artifact" });
  });

  it("parses release CLI arguments", () => {
    expect(
      parseReleaseArgs([
        "candidate",
        "--version",
        "0.1.0-rc.1",
        "--channel",
        "rc",
        "--commit",
        "abc123",
        "--output",
        ".openroad/releases/test.json",
        "--dry-run",
        "--json"
      ])
    ).toEqual({
      channel: "rc",
      command: "candidate",
      commit: "abc123",
      dryRun: true,
      json: true,
      output: ".openroad/releases/test.json",
      version: "0.1.0-rc.1"
    });
  });
});

async function createTempRoot(name) {
  const root = await mkdtemp(join(tmpdir(), `openroad-release-${Date.now()}-${slug(name)}-`));
  tempRoots.push(root);
  return root;
}

async function writeBuildArtifacts(root) {
  const assetFile = join(root, "dist", "assets", "index.js");
  const outputFile = join(root, ".openroad", "releases", "candidate.json");
  await mkdir(join(root, "dist", "assets"), { recursive: true });
  await mkdir(join(root, "server-dist", "server"), { recursive: true });
  await mkdir(join(root, "server"), { recursive: true });
  await mkdir(join(root, "src", "domain"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "openroad", private: true, version: "0.1.0" }));
  await writeFile(join(root, "dist", "index.html"), "<div>OpenRoad</div>");
  await writeFile(assetFile, "console.log('ok');");
  await writeFile(join(root, "server-dist", "server", "index.js"), "export {};");
  await writeFile(join(root, "server", "integrations.ts"), "export const openRoadIntegrationSchemaVersion = 3;");
  await writeFile(join(root, "server", "session-store.ts"), "export const openRoadSessionSchemaVersion = 2;");
  await writeFile(join(root, "server", "team.ts"), "export const openRoadTeamSchemaVersion = 4;");
  await writeFile(join(root, "src", "domain", "openroad.ts"), "export const openRoadSchemaVersion = 6;");
  return { assetFile, outputFile };
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

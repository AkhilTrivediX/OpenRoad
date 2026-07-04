#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import process from "node:process";

const execFileAsync = promisify(execFile);
const releaseManifestVersion = 1;
const supportedChannels = new Set(["rc", "stable", "security"]);
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export async function createReleaseManifest(options = {}) {
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const packageJson = await readPackageJson(rootDir);
  const version = normalizeVersion(options.version ?? packageJson.version ?? "0.0.0");
  const channel = options.channel ?? "rc";
  validateSemver(version);
  validateChannel(channel);

  const commit = options.commit ?? (await readGitCommit(rootDir));
  const createdAt = options.createdAt ?? new Date().toISOString();
  const outputFile = resolve(
    rootDir,
    options.outputFile ?? join(".openroad", "releases", `openroad-${safeName(version)}-${channel}.json`)
  );
  const artifactPaths = options.artifacts ?? [
    "dist/index.html",
    "dist/assets",
    "server-dist/server/index.js"
  ];
  const artifacts = await collectArtifacts({
    artifactPaths,
    rootDir,
    strict: options.strict !== false
  });
  const dataMigration = options.dataMigration ?? (await resolveDataMigrationNote(rootDir));
  const manifest = {
    artifacts,
    docker: resolveDockerPlan(options),
    gates: releaseGates(),
    generatedAt: createdAt,
    manifestVersion: releaseManifestVersion,
    product: {
      name: stringOrFallback(packageJson.name, "openroad"),
      private: packageJson.private === true,
      version
    },
    release: {
      channel,
      commit,
      rollback: {
        command: "restore previous app build or image, restore backup if data changed, then run pnpm ops:smoke",
        dataMigration
      },
      supportWindow: supportWindowForChannel(channel),
      version
    },
    signing: resolveSigningPlan(options)
  };

  if (!options.dryRun) {
    await mkdir(dirname(outputFile), { recursive: true });
    await writeFile(outputFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }

  return {
    manifest,
    outputFile,
    wrote: options.dryRun !== true
  };
}

export function validateSemver(version) {
  if (!semverPattern.test(version)) {
    throw new ReleaseError("invalid_version", `Release version must be semantic versioning: ${version}`);
  }
}

export function validateChannel(channel) {
  if (!supportedChannels.has(channel)) {
    throw new ReleaseError(
      "invalid_channel",
      `Release channel must be one of: ${Array.from(supportedChannels).join(", ")}`
    );
  }
}

export function parseReleaseArgs(argv) {
  const [command = "candidate", ...rest] = argv;
  const args = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--") continue;
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    if (key === "dry-run" || key === "json") {
      args[toCamelCase(key)] = true;
      continue;
    }
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) {
      throw new ReleaseError("invalid_args", `Missing value for --${key}.`);
    }
    args[toCamelCase(key)] = value;
    index += 1;
  }
  return args;
}

export async function runReleaseCommand(args) {
  if (!args.command || args.command === "help" || args.command === "--help") {
    return { help: true };
  }

  if (args.command !== "candidate") {
    throw new ReleaseError("unknown_command", `Unknown OpenRoad release command: ${args.command}`);
  }

  return createReleaseManifest({
    channel: args.channel,
    commit: args.commit,
    dockerImage: args.dockerImage,
    dockerRegistry: args.dockerRegistry,
    dryRun: args.dryRun,
    outputFile: args.output,
    signingKeyId: args.signingKeyId,
    version: args.version
  });
}

export class ReleaseError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function collectArtifacts({ artifactPaths, rootDir, strict }) {
  const artifacts = [];
  for (const artifactPath of artifactPaths) {
    const absolutePath = resolve(rootDir, artifactPath);
    ensureInsideRoot(rootDir, absolutePath);
    let stats;
    try {
      stats = await stat(absolutePath);
    } catch (error) {
      if (strict) {
        throw new ReleaseError("missing_artifact", `Release artifact is missing: ${artifactPath}`);
      }
      continue;
    }

    if (stats.isDirectory()) {
      const files = await walkFiles(absolutePath);
      for (const file of files) {
        artifacts.push(await describeArtifact(rootDir, file));
      }
      continue;
    }

    artifacts.push(await describeArtifact(rootDir, absolutePath));
  }
  return artifacts.sort((left, right) => left.path.localeCompare(right.path));
}

async function describeArtifact(rootDir, file) {
  const [bytes, stats] = await Promise.all([readFile(file), stat(file)]);
  return {
    path: toPosix(relative(rootDir, file)),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: stats.size
  };
}

async function walkFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(child)));
    } else if (entry.isFile()) {
      files.push(child);
    }
  }
  return files;
}

function releaseGates() {
  return [
    {
      command: "pnpm check",
      id: "automated-check",
      required: true
    },
    {
      command: "pnpm ops:smoke -- --base-url <url> --workspace-id acme --admin-token <token>",
      id: "built-server-smoke",
      required: true
    },
    {
      command: "review docs/test-plans/<feature>.md evidence",
      id: "feature-evidence",
      required: true
    },
    {
      command: "review docs/DEPLOYMENT_RUNBOOK.md upgrade and rollback notes",
      id: "operator-release-notes",
      required: true
    }
  ];
}

function resolveDockerPlan(options) {
  if (options.dockerImage) {
    return {
      image: options.dockerImage,
      mode: "publish-ready",
      registry: options.dockerRegistry ?? null
    };
  }

  return {
    image: null,
    mode: "dry-run",
    registry: options.dockerRegistry ?? null,
    reason: "No registry publishing credentials or image target were supplied."
  };
}

function resolveSigningPlan(options) {
  if (options.signingKeyId) {
    return {
      keyId: options.signingKeyId,
      mode: "configured"
    };
  }

  return {
    keyId: null,
    mode: "not-configured",
    reason: "No signing key id was supplied. Do not claim signed artifacts for this release."
  };
}

async function resolveDataMigrationNote(rootDir) {
  const [schemaVersion, integrationSchemaVersion] = await Promise.all([
    readOpenRoadStateSchemaVersion(rootDir),
    readOpenRoadIntegrationSchemaVersion(rootDir)
  ]);
  const schemaNotes = [];

  if (schemaVersion !== undefined) {
    schemaNotes.push(`OpenRoad state schema ${schemaVersion}`);
  }

  if (integrationSchemaVersion !== undefined) {
    schemaNotes.push(`integration metadata schema ${integrationSchemaVersion}`);
  }

  if (schemaNotes.length > 0) {
    return `${schemaNotes.join("; ")}; automatic migrations may run on load. Back up state, integration, and team files before upgrade, and restore a pre-upgrade backup when rolling back across schema versions.`;
  }

  return "Review feature evidence and operator notes for data migration requirements before deploy.";
}

async function readOpenRoadStateSchemaVersion(rootDir) {
  try {
    const source = await readFile(join(rootDir, "src", "domain", "openroad.ts"), "utf8");
    const match = source.match(/openRoadSchemaVersion\s*=\s*(\d+)/);
    return match ? Number.parseInt(match[1], 10) : undefined;
  } catch {
    return undefined;
  }
}

async function readOpenRoadIntegrationSchemaVersion(rootDir) {
  try {
    const source = await readFile(join(rootDir, "server", "integrations.ts"), "utf8");
    const match = source.match(/openRoadIntegrationSchemaVersion\s*=\s*(\d+)/);
    return match ? Number.parseInt(match[1], 10) : undefined;
  } catch {
    return undefined;
  }
}

function supportWindowForChannel(channel) {
  if (channel === "stable") {
    return "Standard support until the next stable minor release, with critical fixes for at least 90 days.";
  }
  if (channel === "security") {
    return "Security patch support for the affected active stable line until superseded.";
  }
  return "Release candidate support until the next RC or stable release.";
}

async function readPackageJson(rootDir) {
  try {
    return JSON.parse(await readFile(join(rootDir, "package.json"), "utf8"));
  } catch {
    return {};
  }
}

async function readGitCommit(rootDir) {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: rootDir });
    return stdout.trim();
  } catch {
    return "unknown";
  }
}

function normalizeVersion(version) {
  return String(version).trim().replace(/^v/, "");
}

function ensureInsideRoot(rootDir, file) {
  const relativePath = relative(rootDir, file);
  if (relativePath.startsWith("..") || relativePath === "" || relativePath.split(sep).includes("..")) {
    throw new ReleaseError("invalid_artifact_path", `Artifact path must stay inside the repository: ${file}`);
  }
}

function stringOrFallback(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function toPosix(value) {
  return value.split(sep).join("/");
}

function safeName(value) {
  return value.replace(/[^a-zA-Z0-9.-]+/g, "-");
}

function printHelp() {
  console.log(`OpenRoad release operations

Commands:
  candidate [--version <semver>] [--channel rc|stable|security] [--commit <sha>] [--output <file>] [--dry-run] [--json]

Examples:
  pnpm build
  node scripts/openroad-release.mjs candidate --version 0.1.0-rc.1 --channel rc --json
`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runReleaseCommand(parseReleaseArgs(process.argv.slice(2)))
    .then((result) => {
      if (result.help) {
        printHelp();
        return;
      }
      if (result.manifest && process.argv.includes("--json")) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (result.wrote) {
        console.log(`OpenRoad release manifest created: ${result.outputFile}`);
      } else {
        console.log(`OpenRoad release dry-run passed for ${result.manifest.release.version}.`);
      }
    })
    .catch((error) => {
      const code = error?.code ?? "openroad_release_failed";
      console.error(`OpenRoad release failed [${code}]: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}

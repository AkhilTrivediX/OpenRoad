#!/usr/bin/env node
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";

const backupManifestVersion = 1;
const defaultWorkspaceId = "acme";

export async function createBackup(options = {}) {
  const dataFile = resolve(options.dataFile ?? process.env.OPENROAD_DATA_FILE ?? ".openroad/openroad-state.json");
  const teamFile = resolve(options.teamFile ?? process.env.OPENROAD_TEAM_FILE ?? ".openroad/openroad-team.json");
  const outputDir = resolve(options.outputDir ?? ".openroad/backups");
  const createdAt = new Date().toISOString();
  const backupName = options.name ?? `openroad-backup-${safeTimestamp(createdAt)}`;
  const backupDir = join(outputDir, backupName);
  const dataArchiveName = "openroad-state.json";
  const teamArchiveName = "openroad-team.json";

  const [dataJson, teamJson, packageJson] = await Promise.all([
    readJsonFile(dataFile, "OpenRoad state file"),
    readJsonFile(teamFile, "OpenRoad team metadata file"),
    readPackageJson()
  ]);

  validateOpenRoadState(dataJson);
  validateTeamState(teamJson);

  await mkdir(outputDir, { recursive: true });
  await mkdir(backupDir, { recursive: false });
  await Promise.all([
    copyFile(dataFile, join(backupDir, dataArchiveName)),
    copyFile(teamFile, join(backupDir, teamArchiveName))
  ]);

  const [dataStats, teamStats] = await Promise.all([stat(dataFile), stat(teamFile)]);
  const manifest = {
    app: {
      name: stringOrFallback(packageJson.name, "openroad"),
      version: stringOrFallback(packageJson.version, "0.0.0")
    },
    createdAt,
    files: {
      data: {
        archiveName: dataArchiveName,
        schemaVersion: dataJson.schemaVersion,
        sizeBytes: dataStats.size,
        sourcePath: dataFile
      },
      team: {
        archiveName: teamArchiveName,
        schemaVersion: teamJson.schemaVersion,
        sizeBytes: teamStats.size,
        sourcePath: teamFile
      }
    },
    manifestVersion: backupManifestVersion,
    type: "openroad-file-pair"
  };

  await writeJsonFile(join(backupDir, "manifest.json"), manifest);

  return { backupDir, manifest };
}

export async function restoreBackup(options = {}) {
  if (!options.inputDir) {
    throw new OpsError("missing_input", "Restore requires --input <backup-directory>.");
  }

  const inputDir = resolve(options.inputDir);
  const dataFile = resolve(options.dataFile ?? process.env.OPENROAD_DATA_FILE ?? ".openroad/openroad-state.json");
  const teamFile = resolve(options.teamFile ?? process.env.OPENROAD_TEAM_FILE ?? ".openroad/openroad-team.json");
  const manifest = await readManifest(inputDir, options.force === true);
  const dataArchiveName = manifest?.files?.data?.archiveName ?? "openroad-state.json";
  const teamArchiveName = manifest?.files?.team?.archiveName ?? "openroad-team.json";
  const dataSource = join(inputDir, dataArchiveName);
  const teamSource = join(inputDir, teamArchiveName);
  const safetyDir =
    options.safetyDir ??
    join(dirname(dataFile), "restore-safety", `openroad-pre-restore-${safeTimestamp(new Date().toISOString())}`);

  if (!options.force) {
    const [dataJson, teamJson] = await Promise.all([
      readJsonFile(dataSource, "backup OpenRoad state file"),
      readJsonFile(teamSource, "backup OpenRoad team metadata file")
    ]);
    validateOpenRoadState(dataJson);
    validateTeamState(teamJson);
  } else {
    await assertReadable(dataSource, "backup OpenRoad state file");
    await assertReadable(teamSource, "backup OpenRoad team metadata file");
  }

  await mkdir(safetyDir, { recursive: true });
  await copyIfExists(dataFile, join(safetyDir, basename(dataFile)));
  await copyIfExists(teamFile, join(safetyDir, basename(teamFile)));

  await Promise.all([mkdir(dirname(dataFile), { recursive: true }), mkdir(dirname(teamFile), { recursive: true })]);
  await Promise.all([copyFile(dataSource, dataFile), copyFile(teamSource, teamFile)]);

  return {
    restored: {
      dataFile,
      teamFile
    },
    safetyDir
  };
}

export async function smokeOpenRoad(options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.OPENROAD_BASE_URL ?? "http://127.0.0.1:4173");
  const workspaceId = options.workspaceId ?? process.env.OPENROAD_SMOKE_WORKSPACE ?? defaultWorkspaceId;
  const adminToken = options.adminToken ?? process.env.OPENROAD_ADMIN_TOKEN;
  const checks = [];

  const health = await getJson(`${baseUrl}/api/health`);
  if (health.status !== 200 || health.body?.ok !== true) {
    throw new OpsError("smoke_health_failed", "Health check failed.");
  }
  checks.push("health");

  const contract = await getJson(`${baseUrl}/api/openroad/contract`);
  if (contract.status !== 200 || typeof contract.body?.contract?.version !== "string") {
    throw new OpsError("smoke_contract_failed", "API contract check failed.");
  }
  checks.push("contract");

  const portal = await getJson(`${baseUrl}/api/openroad/workspaces/${encodeURIComponent(workspaceId)}/portal`);
  if (
    portal.status !== 200 ||
    typeof portal.body?.enabled !== "boolean" ||
    !Array.isArray(portal.body?.requests) ||
    !isRecord(portal.body?.roadmap)
  ) {
    throw new OpsError("smoke_portal_failed", `Public portal check failed for workspace "${workspaceId}".`);
  }
  checks.push("portal");

  if (adminToken) {
    const denied = await getJson(`${baseUrl}/api/openroad/ops/status`);
    if (denied.status !== 403) {
      throw new OpsError("smoke_private_auth_failed", "Expected unauthenticated private API access to be denied.");
    }
    checks.push("private-denied");

    const allowed = await getJson(`${baseUrl}/api/openroad/ops/status`, {
      authorization: `Bearer ${adminToken}`
    });
    if (allowed.status !== 200 || allowed.body?.status !== "ok" || !isRecord(allowed.body?.stores)) {
      throw new OpsError("smoke_private_token_failed", "Authenticated private API check failed.");
    }
    checks.push("private-token");
  } else {
    const allowed = await getJson(`${baseUrl}/api/openroad/ops/status`);
    if (allowed.status !== 200 || allowed.body?.status !== "ok" || !isRecord(allowed.body?.stores)) {
      throw new OpsError(
        "smoke_private_single_user_failed",
        "Private API check failed. Pass --admin-token when the server is running in token mode."
      );
    }
    checks.push("private-single-user");
  }

  return {
    baseUrl,
    checks,
    workspaceId
  };
}

export class OpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function readManifest(inputDir, force) {
  try {
    const manifest = await readJsonFile(join(inputDir, "manifest.json"), "backup manifest");
    if (manifest?.manifestVersion !== backupManifestVersion || manifest?.type !== "openroad-file-pair") {
      throw new OpsError("invalid_manifest", "Backup manifest is not an OpenRoad file-pair manifest.");
    }
    return manifest;
  } catch (error) {
    if (force && isNotFound(error)) return undefined;
    throw error;
  }
}

async function getJson(url, headers = {}) {
  let response;
  try {
    response = await fetch(url, { headers });
  } catch (error) {
    throw new OpsError("smoke_network_failed", `Could not reach ${url}: ${errorMessage(error)}`);
  }

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }

  return { body, status: response.status };
}

async function readPackageJson() {
  try {
    return await readJsonFile(resolve("package.json"), "package.json");
  } catch {
    return {};
  }
}

async function readJsonFile(file, label) {
  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if (isNotFound(error)) {
      throw new OpsError("missing_file", `${label} does not exist: ${file}`);
    }
    throw error;
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new OpsError("invalid_json", `${label} is not valid JSON: ${file}`);
  }
}

async function writeJsonFile(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function assertReadable(file, label) {
  try {
    await stat(file);
  } catch (error) {
    if (isNotFound(error)) {
      throw new OpsError("missing_file", `${label} does not exist: ${file}`);
    }
    throw error;
  }
}

async function copyIfExists(source, destination) {
  try {
    await copyFile(source, destination);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

function validateOpenRoadState(value) {
  if (!isRecord(value) || typeof value.schemaVersion !== "number" || !Array.isArray(value.workspaces)) {
    throw new OpsError("invalid_state", "OpenRoad state backup is missing schemaVersion or workspaces.");
  }
}

function validateTeamState(value) {
  if (
    !isRecord(value) ||
    typeof value.schemaVersion !== "number" ||
    !Array.isArray(value.users) ||
    !Array.isArray(value.memberships) ||
    !Array.isArray(value.auditEvents)
  ) {
    throw new OpsError("invalid_team_state", "OpenRoad team metadata backup is missing required collections.");
  }
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    if (key === "force" || key === "json") {
      args[toCamelCase(key)] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new OpsError("invalid_args", `Missing value for --${key}.`);
    }
    args[toCamelCase(key)] = value;
    index += 1;
  }
  return args;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function stringOrFallback(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function safeTimestamp(value) {
  return value.replace(/[:.]/g, "-");
}

function isNotFound(error) {
  return error?.code === "ENOENT";
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function runCli() {
  const [command, ...argv] = process.argv.slice(2);
  const args = parseArgs(argv);

  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  let result;
  if (command === "backup") {
    result = await createBackup(args);
  } else if (command === "restore") {
    result = await restoreBackup(args);
  } else if (command === "smoke") {
    result = await smokeOpenRoad(args);
  } else {
    throw new OpsError("unknown_command", `Unknown OpenRoad ops command: ${command}`);
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "backup") {
    console.log(`OpenRoad backup created: ${result.backupDir}`);
  } else if (command === "restore") {
    console.log(`OpenRoad restore complete. Safety backup: ${result.safetyDir}`);
  } else {
    console.log(`OpenRoad smoke passed: ${result.checks.join(", ")}`);
  }
}

function printHelp() {
  console.log(`OpenRoad operations

Commands:
  backup  --output-dir <dir> [--data-file <file>] [--team-file <file>] [--name <name>]
  restore --input-dir <dir> [--data-file <file>] [--team-file <file>] [--force]
  smoke   [--base-url <url>] [--workspace-id <id>] [--admin-token <token>]
`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    const code = error?.code ?? "openroad_ops_failed";
    console.error(`OpenRoad ops failed [${code}]: ${errorMessage(error)}`);
    process.exit(1);
  });
}

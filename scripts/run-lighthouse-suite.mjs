#!/usr/bin/env node

import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { toCsv, toMarkdown } from "./run-lighthouse.mjs";

function parseArgs(argv) {
  const options = {};
  for (const token of argv) {
    if (!token.startsWith("--")) continue;
    const separator = token.indexOf("=");
    options[token.slice(2, separator === -1 ? undefined : separator)] =
      separator === -1 ? true : token.slice(separator + 1);
  }
  return options;
}

function run(command, args, cwd, toleratedCodes = [0]) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("close", (code) => {
      if (toleratedCodes.includes(code)) resolve(code);
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function walkIndexFiles(directory, base = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkIndexFiles(fullPath, base)));
    else if (entry.isFile() && entry.name === "index.html") files.push(path.relative(base, fullPath));
  }
  return files;
}

function indexFileToRoute(file) {
  const normalized = file.split(path.sep).join("/");
  return normalized === "index.html" ? "/" : "/" + normalized.replace(/\/index\.html$/, "/");
}

function safeName(route) {
  if (route === "/") return "home";
  return route.replace(/^\/|\/$/g, "").replace(/[^a-z0-9_-]+/gi, "-") || "route";
}

async function fileExists(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectDir = path.resolve(String(options["project-dir"] || process.cwd()));
  const outDir = path.resolve(projectDir, String(options["out-dir"] || "out"));
  const date = new Date().toISOString().slice(0, 10);
  const reportDir = path.resolve(projectDir, String(options["report-dir"] || path.join("..", "work", `lighthouse-isolated-${date}`)));
  const profiles = String(options.profiles || "mobile,desktop").split(",").map((value) => value.trim()).filter(Boolean);
  const repetitions = Number(options.repetitions || 3);
  const cooldownMs = Number(options["cooldown-ms"] || 5000);
  const runner = path.join(path.dirname(fileURLToPath(import.meta.url)), "run-lighthouse.mjs");

  if (!options["skip-build"]) {
    if (process.platform === "win32") {
      await run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm run build"], projectDir);
    } else {
      await run("npm", ["run", "build"], projectDir);
    }
  }

  const discoveredRoutes = (await walkIndexFiles(outDir)).map(indexFileToRoute).sort();
  const routes = options.routes
    ? String(options.routes).split(",").map((value) => value.trim()).filter(Boolean)
    : discoveredRoutes;
  const missing = routes.filter((route) => !discoveredRoutes.includes(route));
  if (missing.length) throw new Error(`Routes missing from static export: ${missing.join(", ")}`);

  const forwarded = ["mobile-performance-min", "desktop-performance-min", "lcp-max-ms", "tbt-max-ms", "cls-max", "max-wait-for-load", "repetition-cooldown-ms", "chrome-path"];
  const summaries = [];
  for (const route of routes) {
    for (const profile of profiles) {
      const subdir = path.join(reportDir, "routes", safeName(route), profile);
      const args = [
        runner,
        `--project-dir=${projectDir}`,
        `--out-dir=${outDir}`,
        "--skip-build",
        `--routes=${route}`,
        `--profiles=${profile}`,
        `--repetitions=${repetitions}`,
        `--report-dir=${subdir}`
      ];
      if (options.resume) args.push("--resume");
      if (options.headed) args.push("--headed");
      if (options["open-devtools"]) args.push("--open-devtools");
      if (options["save-trace"]) args.push("--save-trace");
      for (const key of forwarded) {
        if (options[key] !== undefined) args.push(`--${key}=${options[key]}`);
      }
      await run(process.execPath, args, projectDir, [0, 2]);
      summaries.push(JSON.parse(await readFile(path.join(subdir, "summary.json"), "utf8")));
      await delay(cooldownMs);
    }
  }

  const results = summaries.flatMap((summary) => summary.results)
    .sort((a, b) => a.route.localeCompare(b.route) || a.profile.localeCompare(b.profile));
  const runs = summaries.flatMap((summary) => summary.runs);
  const gatePassed = results.every((result) => result.gate.passed);
  const rawDir = path.join(reportDir, "raw");
  await mkdir(rawDir, { recursive: true });
  for (const summary of summaries) {
    for (const runItem of summary.runs) {
      const subdir = path.dirname(path.join(reportDir, "routes", safeName(runItem.route), runItem.profile, runItem.reportFile));
      const sourceFile = path.join(subdir, path.basename(runItem.reportFile));
      const destination = path.join(rawDir, path.basename(runItem.reportFile));
      if (await fileExists(sourceFile)) await copyFile(sourceFile, destination);
    }
  }

  const first = summaries[0]?.metadata || {};
  const metadata = {
    generatedAt: new Date().toISOString(),
    projectDir,
    outDir,
    chromePath: first.chromePath || null,
    routes: routes.length,
    profiles,
    repetitions,
    cooldownMs,
    reports: runs.length,
    thresholds: first.thresholds || {},
    isolation: "one Node.js and Chrome audit process per route/profile",
    gatePassed
  };
  await mkdir(reportDir, { recursive: true });
  await writeFile(path.join(reportDir, "summary.json"), JSON.stringify({ metadata, results, runs }, null, 2) + "\n");
  await writeFile(path.join(reportDir, "summary.csv"), toCsv(results));
  await writeFile(path.join(reportDir, "summary.md"), toMarkdown(results, metadata));
  process.stdout.write(`Isolated Lighthouse suite complete: ${runs.length} reports in ${reportDir}\n`);
  process.stdout.write(`Quality gate: ${gatePassed ? "PASS" : "FAIL"}\n`);
  return gatePassed;
}

main().then((gatePassed) => process.exit(gatePassed ? 0 : 2)).catch((error) => {
  process.stderr.write((error && error.stack) || String(error));
  process.stderr.write("\n");
  process.exit(1);
});

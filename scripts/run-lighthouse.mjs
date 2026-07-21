#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { startStaticServer as startProductionStaticServer } from "./static-server.mjs";

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

function parseArgs(argv) {
  const options = {};
  for (const token of argv) {
    if (!token.startsWith("--")) continue;
    const separator = token.indexOf("=");
    if (separator === -1) {
      options[token.slice(2)] = true;
    } else {
      options[token.slice(2, separator)] = token.slice(separator + 1);
    }
  }
  return options;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env || {}) },
      shell: Boolean(options.shell),
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit"
    });
    let stdout = "";
    let stderr = "";
    if (options.capture) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const error = new Error(
          "Command failed with exit code " + code + (stderr ? "\n" + stderr.trim() : "")
        );
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
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
    if (entry.isDirectory()) {
      files.push(...(await walkIndexFiles(fullPath, base)));
    } else if (entry.isFile() && entry.name === "index.html") {
      files.push(path.relative(base, fullPath));
    }
  }
  return files;
}

function indexFileToRoute(file) {
  const normalized = file.split(path.sep).join("/");
  if (normalized === "index.html") return "/";
  return "/" + normalized.replace(/\/index\.html$/, "/");
}

async function fileExists(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

function safeJoin(root, pathname) {
  const requested = decodeURIComponent(pathname).replace(/\\/g, "/");
  const relative = requested.replace(/^\/+/, "");
  const resolved = path.resolve(root, relative);
  const normalizedRoot = path.resolve(root) + path.sep;
  if (resolved !== path.resolve(root) && !resolved.startsWith(normalizedRoot)) return null;
  return resolved;
}

async function resolveRequest(root, pathname) {
  let candidate = safeJoin(root, pathname);
  if (!candidate) return null;
  if (pathname.endsWith("/")) candidate = path.join(candidate, "index.html");
  if (await fileExists(candidate)) return { file: candidate, status: 200 };
  if (!path.extname(candidate)) {
    const nested = path.join(candidate, "index.html");
    if (await fileExists(nested)) return { file: nested, status: 200 };
  }
  const fallback = path.join(root, "404", "index.html");
  if (await fileExists(fallback)) return { file: fallback, status: 404 };
  return null;
}

async function startStaticServer(root) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const resolved = await resolveRequest(root, url.pathname);
      if (!resolved) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }
      const body = await readFile(resolved.file);
      const contentType = MIME[path.extname(resolved.file).toLowerCase()] || "application/octet-stream";
      const acceptsGzip = /\bgzip\b/.test(String(request.headers["accept-encoding"] || ""));
      const compressible = /^(text\/|application\/(javascript|json))/.test(contentType) || contentType.startsWith("image/svg+xml");
      const useGzip = acceptsGzip && compressible && body.length > 1024;
      const responseBody = useGzip ? gzipSync(body) : body;
      response.writeHead(resolved.status, {
        "content-type": contentType,
        "cache-control": "public, max-age=3600",
        ...(useGzip ? { "content-encoding": "gzip", vary: "Accept-Encoding" } : {})
      });
      response.end(responseBody);
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(String(error));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    server,
    origin: "http://127.0.0.1:" + address.port
  };
}

function findChrome(explicit) {
  const candidates = [
    explicit,
    process.env.CHROME_PATH,
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Google", "Chrome", "Application", "chrome.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

function score(category) {
  return category && typeof category.score === "number" ? Math.round(category.score * 100) : null;
}

function numeric(audit, digits = 0) {
  if (!audit || typeof audit.numericValue !== "number") return null;
  const factor = 10 ** digits;
  return Math.round(audit.numericValue * factor) / factor;
}

function agenticSummary(lhr) {
  const category = lhr.categories && lhr.categories["agentic-browsing"];
  if (!category) return { score: null, passed: 0, applicable: 0, checks: [] };
  const checks = category.auditRefs
    .map((reference) => lhr.audits && lhr.audits[reference.id])
    .filter((audit) => audit && audit.scoreDisplayMode !== "notApplicable" && audit.scoreDisplayMode !== "manual")
    .map((audit) => ({ id: audit.id, score: audit.score, title: audit.title }));
  return {
    score: score(category),
    passed: checks.filter((audit) => audit.score === 1).length,
    applicable: checks.length,
    checks
  };
}

function summarizeLhr(lhr, route, profile, repetition, reportFile) {
  const audits = lhr.audits || {};
  const failed = Object.values(audits)
    .filter((audit) => (
      audit &&
      typeof audit.score === "number" &&
      audit.score < 0.9 &&
      audit.scoreDisplayMode !== "notApplicable" &&
      audit.scoreDisplayMode !== "manual"
    ))
    .map((audit) => ({
      id: audit.id,
      title: audit.title,
      score: Math.round(audit.score * 100),
      displayValue: audit.displayValue || null
    }))
    .sort((a, b) => a.score - b.score || a.title.localeCompare(b.title));

  const opportunities = Object.values(audits)
    .filter((audit) => (
      audit &&
      audit.details &&
      audit.details.type === "opportunity" &&
      (
        Number(audit.details.overallSavingsMs || 0) > 0 ||
        Number(audit.details.overallSavingsBytes || 0) > 0
      )
    ))
    .map((audit) => ({
      id: audit.id,
      title: audit.title,
      savingsMs: Math.round(Number(audit.details.overallSavingsMs || 0)),
      savingsBytes: Math.round(Number(audit.details.overallSavingsBytes || 0)),
      displayValue: audit.displayValue || null
    }))
    .sort((a, b) => b.savingsMs - a.savingsMs || b.savingsBytes - a.savingsBytes);

  return {
    route,
    profile,
    repetition,
    finalUrl: lhr.finalUrl,
    lighthouseVersion: lhr.lighthouseVersion,
    fetchTime: lhr.fetchTime,
    reportFile,
    scores: {
      performance: score(lhr.categories && lhr.categories.performance),
      accessibility: score(lhr.categories && lhr.categories.accessibility),
      bestPractices: score(lhr.categories && lhr.categories["best-practices"]),
      seo: score(lhr.categories && lhr.categories.seo),
      agentic: score(lhr.categories && lhr.categories["agentic-browsing"])
    },
    agentic: agenticSummary(lhr),
    metrics: {
      fcpMs: numeric(audits["first-contentful-paint"]),
      lcpMs: numeric(audits["largest-contentful-paint"]),
      speedIndexMs: numeric(audits["speed-index"]),
      tbtMs: numeric(audits["total-blocking-time"]),
      cls: numeric(audits["cumulative-layout-shift"], 3)
    },
    failed,
    opportunities
  };
}

function csvEscape(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function median(values, digits = 0) {
  const numbers = values.filter((value) => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b);
  if (!numbers.length) return null;
  const midpoint = Math.floor(numbers.length / 2);
  const value = numbers.length % 2 ? numbers[midpoint] : (numbers[midpoint - 1] + numbers[midpoint]) / 2;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function minimum(values) {
  const numbers = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  return numbers.length ? Math.min(...numbers) : null;
}

function aggregateRuns(runs, thresholds) {
  const groups = new Map();
  for (const run of runs) {
    const key = run.route + "\u0000" + run.profile;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(run);
  }

  return [...groups.values()].map((group) => {
    group.sort((a, b) => a.repetition - b.repetition);
    const route = group[0].route;
    const profile = group[0].profile;
    const scoreSeries = {
      performance: group.map((run) => run.scores.performance),
      accessibility: group.map((run) => run.scores.accessibility),
      bestPractices: group.map((run) => run.scores.bestPractices),
      seo: group.map((run) => run.scores.seo),
      agentic: group.map((run) => run.scores.agentic)
    };
    const metricSeries = {
      fcpMs: group.map((run) => run.metrics.fcpMs),
      lcpMs: group.map((run) => run.metrics.lcpMs),
      speedIndexMs: group.map((run) => run.metrics.speedIndexMs),
      tbtMs: group.map((run) => run.metrics.tbtMs),
      cls: group.map((run) => run.metrics.cls)
    };
    const scores = Object.fromEntries(Object.entries(scoreSeries).map(([key, values]) => [key, median(values)]));
    const minimumScores = Object.fromEntries(Object.entries(scoreSeries).map(([key, values]) => [key, minimum(values)]));
    const metrics = {
      fcpMs: median(metricSeries.fcpMs),
      lcpMs: median(metricSeries.lcpMs),
      speedIndexMs: median(metricSeries.speedIndexMs),
      tbtMs: median(metricSeries.tbtMs),
      cls: median(metricSeries.cls, 3)
    };
    const gateFailures = [];
    const performanceThreshold = profile === "mobile" ? thresholds.mobilePerformance : thresholds.desktopPerformance;
    if (scores.performance < performanceThreshold) gateFailures.push(`Performance median ${scores.performance} < ${performanceThreshold}`);
    if (minimumScores.accessibility !== 100) gateFailures.push(`Accessibility minimum ${minimumScores.accessibility} != 100`);
    if (minimumScores.bestPractices !== 100) gateFailures.push(`Best Practices minimum ${minimumScores.bestPractices} != 100`);
    if (route !== "/404/" && minimumScores.seo !== 100) gateFailures.push(`SEO minimum ${minimumScores.seo} != 100`);
    if (minimumScores.agentic !== null && minimumScores.agentic !== 100) gateFailures.push(`Agentic Browsing minimum ${minimumScores.agentic} != 100`);
    if (group.some((run) => run.agentic.applicable > 0 && run.agentic.passed !== run.agentic.applicable)) {
      gateFailures.push(`Agentic Browsing did not pass every applicable check: ${group.map((run) => `${run.agentic.passed}/${run.agentic.applicable}`).join("/")}`);
    }
    if (metrics.lcpMs > thresholds.lcpMs) gateFailures.push(`LCP median ${metrics.lcpMs} ms > ${thresholds.lcpMs} ms`);
    if (metrics.tbtMs > thresholds.tbtMs) gateFailures.push(`TBT median ${metrics.tbtMs} ms > ${thresholds.tbtMs} ms`);
    if (metrics.cls > thresholds.cls) gateFailures.push(`CLS median ${metrics.cls} > ${thresholds.cls}`);
    const failedAuditIds = [...new Set(group.flatMap((run) => run.failed.map((audit) => audit.id)))].sort();

    return {
      route,
      profile,
      repetitions: group.length,
      scores,
      minimumScores,
      scoreSeries,
      metrics,
      metricSeries,
      agenticSeries: group.map((run) => `${run.agentic.passed}/${run.agentic.applicable}`),
      failedAuditIds,
      gate: { passed: gateFailures.length === 0, failures: gateFailures },
      reports: group.map((run) => run.reportFile)
    };
  }).sort((a, b) => a.route.localeCompare(b.route) || a.profile.localeCompare(b.profile));
}

function toCsv(results) {
  const rows = [[
    "route", "profile", "repetitions", "performance_median", "performance_min", "performance_series",
    "accessibility_min", "best_practices_min", "seo_min", "agentic_min", "agentic_series",
    "fcp_median_ms", "lcp_median_ms", "speed_index_median_ms", "tbt_median_ms", "cls_median",
    "gate", "gate_failures", "failed_audits", "report_files"
  ]];
  for (const item of results) {
    rows.push([
      item.route,
      item.profile,
      item.repetitions,
      item.scores.performance,
      item.minimumScores.performance,
      item.scoreSeries.performance.join("/"),
      item.minimumScores.accessibility,
      item.minimumScores.bestPractices,
      item.minimumScores.seo,
      item.minimumScores.agentic,
      item.agenticSeries.join("/"),
      item.metrics.fcpMs,
      item.metrics.lcpMs,
      item.metrics.speedIndexMs,
      item.metrics.tbtMs,
      item.metrics.cls,
      item.gate.passed ? "PASS" : "FAIL",
      item.gate.failures.join("; "),
      item.failedAuditIds.join("; "),
      item.reports.join("; ")
    ]);
  }
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n") + "\n";
}

function toMarkdown(results, metadata) {
  const lines = [
    "# Lighthouse automatic summary",
    "",
    "- Generated: " + metadata.generatedAt,
    "- Chrome: " + metadata.chromePath,
    "- Routes: " + metadata.routes,
    "- Profiles: " + metadata.profiles.join(", "),
    "- Repetitions per route/profile: " + metadata.repetitions,
    "- Raw reports: " + metadata.reports,
    "- Gate: " + (metadata.gatePassed ? "PASS" : "FAIL"),
    "",
    "| Route | Profile | Perf median | Perf min | Perf runs | A11y min | Best min | SEO min | Agentic | LCP median ms | TBT median ms | CLS median | Gate |",
    "|---|---:|---:|---:|---|---:|---:|---:|---|---:|---:|---:|---|"
  ];
  for (const item of results) {
    lines.push([
      "| " + item.route,
      item.profile,
      item.scores.performance,
      item.minimumScores.performance,
      item.scoreSeries.performance.join("/"),
      item.minimumScores.accessibility,
      item.minimumScores.bestPractices,
      item.minimumScores.seo,
      item.agenticSeries.join(" · "),
      item.metrics.lcpMs,
      item.metrics.tbtMs,
      item.metrics.cls,
      (item.gate.passed ? "PASS" : "FAIL: " + item.gate.failures.join("; ")) + " |"
    ].join(" | "));
  }
  lines.push("");
  return lines.join("\n");
}

function safeName(route) {
  if (route === "/") return "home";
  return route.replace(/^\/|\/$/g, "").replace(/[^a-z0-9_-]+/gi, "-") || "route";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectDir = path.resolve(String(options["project-dir"] || process.cwd()));
  const outDir = path.resolve(projectDir, String(options["out-dir"] || "out"));
  const date = new Date().toISOString().slice(0, 10);
  const reportDir = path.resolve(projectDir, String(options["report-dir"] || path.join("..", "work", "lighthouse-" + date)));
  const finalRawDir = path.join(reportDir, "raw");
  const reportKey = createHash("sha256").update(reportDir).digest("hex").slice(0, 16);
  const workingRoot = path.join(tmpdir(), "lighthouse-evidence-" + reportKey);
  const rawDir = path.join(workingRoot, "raw");
  // Explicit profiles prevent chrome-launcher from hitting a Windows cleanup
  // race. They live in the operating-system temp directory, never in a synced
  // project workspace, and remain isolated for the whole audit batch.
  const runtimeTemp = await mkdtemp(path.join(tmpdir(), "lighthouse-isolated-"));
  const profiles = String(options.profiles || "mobile,desktop")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const maxWaitForLoad = Number(options["max-wait-for-load"] || 20000);
  const repetitions = Number(options.repetitions || 3);
  const repetitionCooldownMs = Number(options["repetition-cooldown-ms"] || 10000);
  const headed = Boolean(options.headed);
  const openDevtools = Boolean(options["open-devtools"]);
  const saveTrace = Boolean(options["save-trace"]);
  const thresholds = {
    mobilePerformance: Number(options["mobile-performance-min"] || 95),
    desktopPerformance: Number(options["desktop-performance-min"] || 95),
    lcpMs: Number(options["lcp-max-ms"] || 2500),
    tbtMs: Number(options["tbt-max-ms"] || 200),
    cls: Number(options["cls-max"] || 0.1)
  };
  if (!Number.isFinite(maxWaitForLoad) || maxWaitForLoad < 5000) {
    throw new Error("max-wait-for-load must be at least 5000 milliseconds.");
  }
  if (!Number.isInteger(repetitions) || repetitions < 1) {
    throw new Error("repetitions must be a positive integer.");
  }
  if (!Number.isFinite(repetitionCooldownMs) || repetitionCooldownMs < 0) {
    throw new Error("repetition-cooldown-ms must be zero or a positive number.");
  }

  for (const profile of profiles) {
    if (!["mobile", "desktop"].includes(profile)) {
      throw new Error("Unsupported profile: " + profile);
    }
  }

  if (!options["skip-build"]) {
    if (process.platform === "win32") {
      await run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm run build"], { cwd: projectDir });
    } else {
      await run("npm", ["run", "build"], { cwd: projectDir });
    }
  }

  if (!existsSync(outDir)) throw new Error("Static output not found: " + outDir);

  const discoveredRoutes = (await walkIndexFiles(outDir)).map(indexFileToRoute).sort();
  const requestedRoutes = options.routes
    ? String(options.routes).split(",").map((value) => value.trim()).filter(Boolean)
    : discoveredRoutes;
  const missingRoutes = requestedRoutes.filter((route) => !discoveredRoutes.includes(route));
  if (missingRoutes.length) {
    throw new Error("Requested routes are not in the static export: " + missingRoutes.join(", "));
  }
  if (!requestedRoutes.length) throw new Error("No exported routes were discovered.");

  const lighthouseCore = path.join(projectDir, "node_modules", "lighthouse", "core", "index.js");
  const desktopConfigFile = path.join(projectDir, "node_modules", "lighthouse", "core", "config", "desktop-config.js");
  const chromeLauncherFile = path.join(projectDir, "node_modules", "chrome-launcher", "dist", "chrome-launcher.js");
  if (!existsSync(lighthouseCore) || !existsSync(desktopConfigFile) || !existsSync(chromeLauncherFile)) {
    throw new Error("Lighthouse is not installed locally. Add it as a pinned development dependency.");
  }
  const chromePath = findChrome(options["chrome-path"]);
  if (!chromePath) throw new Error("Chrome or Edge was not found.");

  if (!options.resume) await rm(workingRoot, { recursive: true, force: true });
  await mkdir(rawDir, { recursive: true });
  const { server, origin } = await startProductionStaticServer(outDir);
  const lighthouse = (await import(pathToFileURL(lighthouseCore).href)).default;
  const desktopConfig = (await import(pathToFileURL(desktopConfigFile).href)).default;
  const chromeLauncher = await import(pathToFileURL(chromeLauncherFile).href);
  let chrome;
  const runs = [];
  try {
    for (const route of requestedRoutes) {
      for (const profile of profiles) {
        for (let repetition = 1; repetition <= repetitions; repetition += 1) {
          const filename = safeName(route) + "--" + profile + "--run-" + repetition + ".json";
          const outputPath = path.join(rawDir, filename);
          const finalOutputPath = path.join(finalRawDir, filename);
          const relativeReport = "raw/" + filename;
          const reusableOutputPath = await fileExists(outputPath) ? outputPath : finalOutputPath;
          if (options.resume && await fileExists(reusableOutputPath)) {
            process.stdout.write("Reusing " + route + " [" + profile + "] run " + repetition + "/" + repetitions + "\n");
            const lhr = JSON.parse(await readFile(reusableOutputPath, "utf8"));
            if (reusableOutputPath !== outputPath) await copyFile(reusableOutputPath, outputPath);
            runs.push(summarizeLhr(lhr, route, profile, repetition, relativeReport));
            continue;
          }

          const chromeProfile = path.join(runtimeTemp, safeName(route) + "-" + profile + "-" + repetition + "-" + process.pid);
          await mkdir(chromeProfile, { recursive: true });
          process.stdout.write("Auditing " + route + " [" + profile + "] run " + repetition + "/" + repetitions + "\n");
          try {
            const chromeFlags = [
              "--no-sandbox",
              "--disable-extensions",
              "--no-first-run",
              "--no-default-browser-check"
            ];
            if (headed) {
              chromeFlags.push("--incognito", "--window-size=1365,768");
              if (openDevtools) chromeFlags.push("--auto-open-devtools-for-tabs");
            } else {
              chromeFlags.push("--headless=new", "--disable-gpu");
            }
            chrome = await chromeLauncher.launch({
              chromePath,
              userDataDir: chromeProfile,
              chromeFlags
            });
            const runnerResult = await lighthouse(origin + route, {
              port: chrome.port,
              logLevel: "error",
              output: "json",
              onlyCategories: ["performance", "accessibility", "best-practices", "seo", "agentic-browsing"],
              maxWaitForLoad,
              disableFullPageScreenshot: true
            }, profile === "desktop" ? desktopConfig : undefined);
            if (!runnerResult || !runnerResult.lhr) {
              throw new Error("Lighthouse returned no result for " + route + " [" + profile + "] run " + repetition);
            }
            const lhr = runnerResult.lhr;
            await writeFile(outputPath, JSON.stringify(lhr, null, 2) + "\n");
            if (saveTrace && runnerResult.artifacts?.Trace?.traceEvents) {
              const tracePath = outputPath.replace(/\.json$/, ".trace.json");
              await writeFile(tracePath, JSON.stringify({ traceEvents: runnerResult.artifacts.Trace.traceEvents }));
            }
            runs.push(summarizeLhr(lhr, route, profile, repetition, relativeReport));
          } finally {
            if (chrome) {
              await chrome.kill();
              chrome = null;
            }
          }
          if (repetition < repetitions && repetitionCooldownMs > 0) {
            process.stdout.write("Cooling down for " + repetitionCooldownMs + " ms before the next cold run.\n");
            await delay(repetitionCooldownMs);
          }
        }
      }
    }
  } finally {
    if (chrome) await chrome.kill();
    await new Promise((resolve) => server.close(resolve));
  }

  const results = aggregateRuns(runs, thresholds);
  const gatePassed = results.every((result) => result.gate.passed);
  const metadata = {
    generatedAt: new Date().toISOString(),
    projectDir,
    outDir,
    chromePath,
    routes: requestedRoutes.length,
    profiles,
    repetitions,
    repetitionCooldownMs,
    headed,
    openDevtools,
    saveTrace,
    maxWaitForLoad,
    thresholds,
    reports: runs.length,
    runtimeTemp,
    gatePassed
  };
  const summary = { metadata, results, runs };
  await mkdir(finalRawDir, { recursive: true });
  for (const entry of await readdir(rawDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".json")) {
      await copyFile(path.join(rawDir, entry.name), path.join(finalRawDir, entry.name));
    }
  }
  await writeFile(path.join(reportDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  await writeFile(path.join(reportDir, "summary.csv"), toCsv(results));
  await writeFile(path.join(reportDir, "summary.md"), toMarkdown(results, metadata));
  process.stdout.write("Lighthouse complete: " + runs.length + " raw reports in " + reportDir + "\n");
  process.stdout.write("Quality gate: " + (gatePassed ? "PASS" : "FAIL") + "\n");
  await rm(workingRoot, { recursive: true, force: true });
  return { gatePassed };
}

export { aggregateRuns, toCsv, toMarkdown };

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(({ gatePassed }) => {
    process.exit(gatePassed ? 0 : 2);
  }).catch((error) => {
    process.stderr.write((error && error.stack) || String(error));
    process.stderr.write("\n");
    process.exit(1);
  });
}

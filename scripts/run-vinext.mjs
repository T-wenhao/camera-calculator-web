import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");
const command = process.argv[2];
const allowedCommands = new Set(["dev", "build", "start"]);

if (!command || !allowedCommands.has(command)) {
  console.error("用法：node scripts/run-vinext.mjs <dev|build|start> [...参数]");
  process.exit(1);
}

const directCli = resolve(projectRoot, "node_modules", "vinext", "dist", "cli.js");
let cliPath = directCli;

if (!existsSync(cliPath)) {
  const pnpmStore = resolve(projectRoot, "node_modules", ".pnpm");
  const vinextPackage = existsSync(pnpmStore)
    ? readdirSync(pnpmStore).find((name) => name.startsWith("vinext@"))
    : undefined;
  if (vinextPackage) {
    cliPath = resolve(pnpmStore, vinextPackage, "node_modules", "vinext", "dist", "cli.js");
  }
}

if (!existsSync(cliPath)) {
  console.error("找不到 vinext，请先安装项目依赖。");
  process.exit(1);
}

const child = spawn(
  process.execPath,
  [cliPath, command, ...process.argv.slice(3)],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      WRANGLER_WRITE_LOGS: process.env.WRANGLER_WRITE_LOGS ?? "false",
      WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH ?? ".wrangler/logs",
      MINIFLARE_REGISTRY_PATH: process.env.MINIFLARE_REGISTRY_PATH ?? ".wrangler/registry",
    },
    stdio: "inherit",
  },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});

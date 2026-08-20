import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");
const directCli = resolve(projectRoot, "node_modules", "vinext", "dist", "cli.js");
let cliPath = directCli;

if (!existsSync(cliPath)) {
  const pnpmStore = resolve(projectRoot, "node_modules", ".pnpm");
  const vinextPackage = readdirSync(pnpmStore).find((name) => name.startsWith("vinext@"));
  if (vinextPackage) {
    cliPath = resolve(pnpmStore, vinextPackage, "node_modules", "vinext", "dist", "cli.js");
  }
}

if (!existsSync(cliPath)) {
  console.error("找不到 vinext，请先安装项目依赖。");
  process.exit(1);
}

const child = spawn(process.execPath, [cliPath, "dev", ...process.argv.slice(2)], {
  cwd: projectRoot,
  env: { ...process.env, OPTICAL_LOCAL_BUILD: "1" },
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});

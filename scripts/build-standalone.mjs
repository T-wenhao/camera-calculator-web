import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "vite";

const projectRoot = resolve(import.meta.dirname, "..");
const templatePath = resolve(projectRoot, "standalone", "template.html");
const entryPath = resolve(projectRoot, "standalone", "main.ts");
const cssPath = resolve(projectRoot, "app", "globals.css");
const readmePath = resolve(projectRoot, "standalone", "README.md");
const outputDirectory = resolve(projectRoot, "outputs", "optical-calculator");
const outputPath = resolve(outputDirectory, "index.html");
const outputReadmePath = resolve(outputDirectory, "README.md");

const bundleResult = await build({
  configFile: false,
  logLevel: "silent",
  build: {
    write: false,
    minify: false,
    target: "es2022",
    lib: {
      entry: entryPath,
      formats: ["iife"],
      name: "OpticalCalculatorStandalone",
    },
  },
});

const rollupOutputs = Array.isArray(bundleResult) ? bundleResult : [bundleResult];
const javascriptChunk = rollupOutputs
  .flatMap((output) => output.output)
  .find((item) => item.type === "chunk");

if (!javascriptChunk || javascriptChunk.type !== "chunk") {
  throw new Error("没有生成离线版 JavaScript。" );
}

const [template, rawCss, readme] = await Promise.all([
  readFile(templatePath, "utf8"),
  readFile(cssPath, "utf8"),
  readFile(readmePath, "utf8"),
]);
const css = rawCss.replace(/^@import\s+"tailwindcss";\s*/u, "");
const buildDate = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
}).format(new Date());

const html = template
  .replace("<!-- INLINE_CSS -->", css)
  .replace("<!-- INLINE_SCRIPT -->", javascriptChunk.code)
  .replace("<!-- BUILD_DATE -->", buildDate);

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(outputPath, html, "utf8"),
  writeFile(outputReadmePath, readme, "utf8"),
]);
console.log(`已生成离线版：${outputPath}`);

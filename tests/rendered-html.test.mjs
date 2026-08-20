import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the optical design workbench", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>光学方案计算器 · 宁波5号线360检测<\/title>/);
  assert.match(html, /光学方案工程表/);
  assert.match(html, /计算并推荐焦距/);
  assert.match(html, /标准焦距筛选明细/);
  assert.match(html, /光学方案参数表/);
  assert.match(html, /无可行方案/);
  assert.match(html, /留空时自动计算/);
  assert.match(html, /自动对焦 800 mm/);
  assert.match(html, /景深至少需要 F\/12\.7，超过设定的 F\/11\.0 上限/);
  assert.match(html, /最大允许 F 值/);
  assert.doesNotMatch(html, /Building your site|Your site is taking shape|codex-preview/);
});

test("keeps authoritative optics behind one solver seam", async () => {
  const [page, solver, context, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/optics/solve-2d-design.ts", import.meta.url), "utf8"),
    readFile(new URL("../CONTEXT.md", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /solve2DDesign/);
  assert.match(page, /近端像素当量/);
  assert.match(page, /buildFovConeGeometry/);
  assert.match(page, /水平全视场角/);
  assert.doesNotMatch(page, /const positions = \[38, 62, 86\]/);
  assert.doesNotMatch(page, /function\s+(fieldOfViewMm|requiredFNumber|depthOfField)/);
  assert.match(solver, /export function solve2DDesign/);
  assert.match(solver, /objectDistanceMm\s*-\s*focalLengthMm/);
  assert.match(solver, /designCircleMultiplier\s*\?\?\s*2/);
  assert.match(solver, /referenceWavelengthNm\s*\?\?\s*550/);
  assert.match(solver, /2 \* near \* far/);
  assert.match(solver, /F_NUMBER_EXCEEDED/);
  assert.match(context, /计算景深范围/);
  assert.match(context, /目标工作区间/);
  assert.match(context, /结果已过期/);
  assert.match(layout, /光学方案计算器/);
});

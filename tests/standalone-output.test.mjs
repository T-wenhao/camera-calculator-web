import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const outputDirectory = new URL("../outputs/optical-calculator/", import.meta.url);

test("builds a self-contained offline optical calculator", async () => {
  const [files, html] = await Promise.all([
    readdir(outputDirectory),
    readFile(new URL("index.html", outputDirectory), "utf8"),
  ]);

  assert.ok(files.includes("index.html"));
  assert.ok(files.includes("README.md"));
  assert.deepEqual(files.filter((file) => /\.(?:js|css)$/i.test(file)), []);
  assert.match(html, /<title>光学方案计算器 · 离线版<\/title>/);
  assert.match(html, /光学方案工程表/);
  assert.match(html, /计算并推荐焦距/);
  assert.match(html, /标准焦距筛选明细/);
  assert.match(html, /光学方案参数表/);
  assert.match(html, /留空时自动计算/);
  assert.match(html, /最大允许 F 值/);
  assert.match(html, /景深所需最低 F 值/);
  assert.match(html, /近端像素当量/);
  assert.match(html, /buildFovConeGeometry/);
  assert.match(html, /水平全视场角/);
  assert.match(html, /cone-ray--top/);
  assert.doesNotMatch(html, /const positions = \[38, 62, 86\]/);
  assert.match(html, /maximumFNumber/);
  assert.match(html, /function solve2DDesign/);
  assert.match(html, /objectDistanceMm\s*-\s*focalLengthMm/);
  assert.doesNotMatch(html, /<script[^>]+\bsrc=/i);
  assert.doesNotMatch(html, /<link[^>]+\bhref=/i);
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.doesNotMatch(html, /调一个参数|Excel 结构参考版/);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  solve2DDesign,
  type TwoDDesignInput,
} from "../lib/optics/solve-2d-design.ts";

const baseInput: TwoDDesignInput = {
  camera: {
    model: "MV-CL042-91GC",
    horizontalPixels: 4096,
    rows: 2,
    pixelPitchUm: 7,
    maxLineRateKhz: 28,
  },
  near: { distanceMm: 560, requiredFovMm: 700 },
  focusDistanceMm: 900,
  far: { distanceMm: 1400, requiredFovMm: 1070 },
  fovMarginPercent: 10,
  maxObjectPixelMm: 0.55,
  motion: {
    enabled: true,
    maximumSpeedKmh: 60,
    longitudinalSampleMm: 0.8,
  },
};

function closeTo(actual: number, expected: number, tolerance = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

test("uses the finite-conjugate field-of-view relation", () => {
  const result = solve2DDesign(baseInput);
  const focal18 = result.candidates.find((candidate) => candidate.focalLengthMm === 18);
  assert.ok(focal18);
  closeTo(focal18.focus.actualFovMm, 1404.928, 1e-6);
  closeTo(focal18.far.objectPixelMm, 0.5374444444444445, 1e-9);
});

test("includes the 14 mm standard focal-length candidate", () => {
  const result = solve2DDesign(baseInput);
  assert.ok(result.candidates.some((candidate) => candidate.focalLengthMm === 14));
});

test("derives the continuous focal range and recommends the only feasible standard focal", () => {
  const result = solve2DDesign(baseInput);
  assert.equal(result.status, "review");
  assert.equal(result.recommended?.focalLengthMm, 18);
  closeTo(result.focalRangeMm.minimum ?? 0, 17.594254937163376, 1e-9);
  closeTo(result.focalRangeMm.maximum ?? 0, 20.10377226195484, 1e-9);
});

test("reverse-calculates aperture so the design depth covers the target interval", () => {
  const result = solve2DDesign(baseInput);
  const recommended = result.recommended;
  assert.ok(recommended);
  closeTo(recommended.requiredFNumber, 15.930862140774677, 1e-9);
  closeTo(recommended.designDofNearMm, 560, 1e-9);
  assert.ok(recommended.designDofFarMm >= baseInput.far.distanceMm);
  assert.equal(recommended.diffractionReview, true);
});

test("automatically balances the near and far blur requirements when focus is blank", () => {
  const result = solve2DDesign({ ...baseInput, focusDistanceMm: null });
  assert.equal(result.focusMode, "automatic");
  closeTo(result.resolvedFocusDistanceMm ?? 0, 800, 1e-9);

  const focal18 = result.candidates.find((candidate) => candidate.focalLengthMm === 18);
  assert.ok(focal18);
  closeTo(focal18.designDofNearMm, baseInput.near.distanceMm, 1e-9);
  closeTo(focal18.designDofFarMm, baseInput.far.distanceMm, 1e-9);
  assert.ok(focal18.requiredFNumber < 15.930862140774677);
});

test("treats F/11 as a hard maximum F-number without falsifying the required aperture", () => {
  const result = solve2DDesign({
    ...baseInput,
    focusDistanceMm: null,
    maximumFNumber: 11,
    maxObjectPixelMm: null,
  });
  assert.equal(result.recommended?.focalLengthMm, 16);
  assert.equal(result.recommended?.operatingFNumber, 11);
  assert.ok((result.recommended?.requiredFNumber ?? Number.POSITIVE_INFINITY) < 11);
  assert.ok((result.recommended?.designDofNearMm ?? Number.POSITIVE_INFINITY) <= baseInput.near.distanceMm);
  assert.ok((result.recommended?.designDofFarMm ?? 0) >= baseInput.far.distanceMm);

  const focal18 = result.candidates.find((candidate) => candidate.focalLengthMm === 18);
  assert.ok(focal18);
  assert.ok(focal18.requiredFNumber > 11);
  assert.equal(focal18.operatingFNumber, 11);
  assert.ok(focal18.failureCodes.includes("F_NUMBER_EXCEEDED"));
  assert.match(focal18.reasons.join("\n"), /超过上限 F\/11\.0/);
});

test("reports the exact F/11 and resolution conflict when their continuous focal ranges do not overlap", () => {
  const result = solve2DDesign({
    ...baseInput,
    focusDistanceMm: null,
    maximumFNumber: 11,
  });
  assert.equal(result.recommended, null);
  assert.equal(result.status, "none");
  assert.ok((result.focalRangeMm.minimum ?? 0) > (result.focalRangeMm.maximum ?? Number.POSITIVE_INFINITY));
  assert.match(result.statusMessage, /光圈硬约束/);
});

test("rejects an invalid near-focus-far ordering before solving", () => {
  const result = solve2DDesign({ ...baseInput, focusDistanceMm: 500 });
  assert.equal(result.status, "incomplete");
  assert.equal(result.candidates.length, 0);
  assert.match(result.validationErrors.join("\n"), /近端工作面 < 对焦面 < 远端工作面/);
});

test("marks motion sampling unknown when the camera line rate is absent", () => {
  const result = solve2DDesign({
    ...baseInput,
    camera: { ...baseInput.camera, maxLineRateKhz: null },
  });
  assert.equal(result.motion.status, "unknown");
  closeTo(result.motion.requiredLineRateKhz ?? 0, 20.833333333333332, 1e-9);
  assert.equal(result.status, "review");
});

test("reports no overall solution when motion sampling exceeds the fixed camera", () => {
  const result = solve2DDesign({
    ...baseInput,
    camera: { ...baseInput.camera, maxLineRateKhz: 15 },
  });
  assert.ok(result.recommended);
  assert.equal(result.motion.status, "fail");
  assert.equal(result.status, "none");
});

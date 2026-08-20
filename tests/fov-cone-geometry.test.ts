import assert from "node:assert/strict";
import test from "node:test";

import {
  FOV_CONE_STAGE_ASPECT_RATIO,
  buildFovConeGeometry,
} from "../lib/optics/fov-cone-geometry.ts";

const planes = [
  { distanceMm: 560, actualFovMm: 975 },
  { distanceMm: 800, actualFovMm: 1405 },
  { distanceMm: 1400, actualFovMm: 2480 },
];

function closeTo(actual: number, expected: number, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

test("places work planes in proportion to their object distances", () => {
  const geometry = buildFovConeGeometry(planes);
  const [near, focus, far] = geometry.planes;
  const drawnFocusRatio =
    (focus.leftPercent - near.leftPercent) /
    (far.leftPercent - near.leftPercent);
  const physicalFocusRatio = (800 - 560) / (1400 - 560);
  closeTo(drawnFocusRatio, physicalFocusRatio);
});

test("scales every work-plane segment directly with its field of view", () => {
  const geometry = buildFovConeGeometry(planes);
  const [near, focus, far] = geometry.planes;
  closeTo(near.heightPercent / far.heightPercent, 975 / 2480);
  closeTo(focus.heightPercent / far.heightPercent, 1405 / 2480);
});

test("centres the cone background on the optical axis and preserves its physical angle", () => {
  const geometry = buildFovConeGeometry(planes);
  closeTo(
    ((geometry.axisYPercent - geometry.farHalfHeightPercent) +
      (geometry.axisYPercent + geometry.farHalfHeightPercent)) / 2,
    geometry.axisYPercent,
  );

  const drawnSlope =
    (geometry.farHalfHeightPercent / (geometry.farXPercent - geometry.originXPercent)) /
    FOV_CONE_STAGE_ASPECT_RATIO;
  const maximumPhysicalSlope = Math.max(
    ...planes.map((plane) => plane.actualFovMm / 2 / plane.distanceMm),
  );
  closeTo(drawnSlope, maximumPhysicalSlope);
  closeTo(
    geometry.fullViewAngleDeg,
    2 * Math.atan(maximumPhysicalSlope) * 180 / Math.PI,
  );
});

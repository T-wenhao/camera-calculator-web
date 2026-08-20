export const FOV_CONE_STAGE_ASPECT_RATIO = 0.86;

export type FovConePlaneInput = {
  distanceMm: number;
  actualFovMm: number;
};

export type FovConePlaneGeometry = FovConePlaneInput & {
  leftPercent: number;
  heightPercent: number;
  halfHeightPercent: number;
  fullViewAngleDeg: number;
};

export type FovConeGeometry = {
  originXPercent: number;
  axisYPercent: number;
  farXPercent: number;
  farHalfHeightPercent: number;
  rayLengthPercent: number;
  rayAngleDeg: number;
  fullViewAngleDeg: number;
  planes: FovConePlaneGeometry[];
};

const WIDTH_UNITS = 100;
const HEIGHT_UNITS = WIDTH_UNITS / FOV_CONE_STAGE_ASPECT_RATIO;
const ORIGIN_X_UNITS = 7;
const RIGHT_MARGIN_UNITS = 8;
const VERTICAL_MARGIN_PERCENT = 8;

function isPositiveFinite(value: number) {
  return Number.isFinite(value) && value > 0;
}

export function buildFovConeGeometry(
  planes: readonly FovConePlaneInput[],
): FovConeGeometry {
  if (
    planes.length === 0 ||
    planes.some((plane) => (
      !isPositiveFinite(plane.distanceMm) ||
      !isPositiveFinite(plane.actualFovMm)
    ))
  ) {
    throw new Error("视场锥需要有效的物距和视场数据。");
  }

  const maximumDistanceMm = Math.max(...planes.map((plane) => plane.distanceMm));
  const maximumHalfAngleSlope = Math.max(
    ...planes.map((plane) => plane.actualFovMm / 2 / plane.distanceMm),
  );
  const maximumHalfExtentMm = maximumHalfAngleSlope * maximumDistanceMm;
  const horizontalScale =
    (WIDTH_UNITS - ORIGIN_X_UNITS - RIGHT_MARGIN_UNITS) / maximumDistanceMm;
  const verticalHalfExtentUnits =
    HEIGHT_UNITS * (50 - VERTICAL_MARGIN_PERCENT) / 100;
  const verticalScale = verticalHalfExtentUnits / maximumHalfExtentMm;

  // One uniform mm-to-screen scale preserves both distance and view angle.
  const scale = Math.min(horizontalScale, verticalScale);
  const farXUnits = ORIGIN_X_UNITS + maximumDistanceMm * scale;
  const farHalfHeightUnits = maximumHalfExtentMm * scale;
  const rayLengthUnits = Math.hypot(
    maximumDistanceMm * scale,
    maximumHalfExtentMm * scale,
  );

  return {
    originXPercent: ORIGIN_X_UNITS / WIDTH_UNITS * 100,
    axisYPercent: 50,
    farXPercent: farXUnits / WIDTH_UNITS * 100,
    farHalfHeightPercent: farHalfHeightUnits / HEIGHT_UNITS * 100,
    rayLengthPercent: rayLengthUnits / WIDTH_UNITS * 100,
    rayAngleDeg: Math.atan(maximumHalfAngleSlope) * 180 / Math.PI,
    fullViewAngleDeg: 2 * Math.atan(maximumHalfAngleSlope) * 180 / Math.PI,
    planes: planes.map((plane) => {
      const halfHeightUnits = plane.actualFovMm / 2 * scale;
      return {
        ...plane,
        leftPercent:
          (ORIGIN_X_UNITS + plane.distanceMm * scale) / WIDTH_UNITS * 100,
        heightPercent: plane.actualFovMm * scale / HEIGHT_UNITS * 100,
        halfHeightPercent: halfHeightUnits / HEIGHT_UNITS * 100,
        fullViewAngleDeg:
          2 * Math.atan(plane.actualFovMm / 2 / plane.distanceMm) * 180 / Math.PI,
      };
    }),
  };
}

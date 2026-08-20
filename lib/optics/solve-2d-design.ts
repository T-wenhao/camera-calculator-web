export const DEFAULT_STANDARD_FOCAL_LENGTHS_MM = [
  8, 12.5, 14, 16, 18, 25, 35, 50, 60, 100,
] as const;

export type SchemeStatus = "incomplete" | "feasible" | "review" | "none";
export type MotionStatus = "not-requested" | "pass" | "fail" | "unknown";
export type FocusMode = "manual" | "automatic";

export type CameraSpecification = {
  model: string;
  horizontalPixels: number;
  rows: number;
  pixelPitchUm: number;
  maxLineRateKhz?: number | null;
  sensorType?: string;
  dataInterface?: string;
  lensMount?: string;
};

export type WorkPlaneRequirement = {
  distanceMm: number;
  requiredFovMm: number;
};

export type TwoDDesignInput = {
  camera: CameraSpecification;
  near: WorkPlaneRequirement;
  focusDistanceMm?: number | null;
  far: WorkPlaneRequirement;
  fovMarginPercent: number;
  maxObjectPixelMm?: number | null;
  maximumFNumber?: number | null;
  motion?: {
    enabled: boolean;
    maximumSpeedKmh?: number | null;
    longitudinalSampleMm?: number | null;
  };
  standardFocalLengthsMm?: readonly number[];
  designCircleMultiplier?: number;
  referenceCircleMultiplier?: number;
  referenceWavelengthNm?: number;
};

export type PlaneResult = {
  distanceMm: number;
  requiredFovMm: number | null;
  requiredFovWithMarginMm: number | null;
  actualFovMm: number;
  remainingFovMm: number | null;
  objectPixelMm: number;
};

export type CandidateFailureCode =
  | "FOCAL_NOT_BELOW_OBJECT_DISTANCE"
  | "NEAR_FOV_SHORTFALL"
  | "FAR_FOV_SHORTFALL"
  | "OBJECT_PIXEL_EXCEEDED"
  | "F_NUMBER_EXCEEDED";

export type CandidateResult = {
  focalLengthMm: number;
  requiredFNumber: number;
  operatingFNumber: number;
  designDofNearMm: number;
  designDofFarMm: number;
  referenceDofNearMm: number;
  referenceDofFarMm: number;
  airyDiameterUm: number;
  diffractionReview: boolean;
  feasible: boolean;
  failureCodes: CandidateFailureCode[];
  reasons: string[];
  near: PlaneResult;
  focus: PlaneResult;
  far: PlaneResult;
};

export type MotionResult = {
  status: MotionStatus;
  requiredLineRateKhz: number | null;
  theoreticalLinePeriodUs: number | null;
  availableLineRateKhz: number | null;
  message: string;
};

export type TwoDDesignResult = {
  status: SchemeStatus;
  statusMessage: string;
  validationErrors: string[];
  sensorWidthMm: number;
  designCircleOfConfusionUm: number;
  referenceCircleOfConfusionUm: number;
  focalRangeMm: { minimum: number | null; maximum: number | null };
  targetWorkIntervalMm: { near: number; far: number };
  resolvedFocusDistanceMm: number | null;
  focusMode: FocusMode;
  recommended: CandidateResult | null;
  candidates: CandidateResult[];
  rankedCandidates: CandidateResult[];
  motion: MotionResult;
  assumptions: {
    distanceDatum: string;
    opticalModel: string;
    numericalLabel: string;
    diffractionReference: string;
    focusMethod: string;
  };
};

const EPSILON = 1e-9;

function isPositiveFinite(value: number) {
  return Number.isFinite(value) && value > 0;
}

function isNonNegativeFinite(value: number) {
  return Number.isFinite(value) && value >= 0;
}

function fieldOfViewMm(sensorWidthMm: number, objectDistanceMm: number, focalLengthMm: number) {
  return (sensorWidthMm * (objectDistanceMm - focalLengthMm)) / focalLengthMm;
}

function objectPixelMm(pixelPitchMm: number, objectDistanceMm: number, focalLengthMm: number) {
  return (pixelPitchMm * (objectDistanceMm - focalLengthMm)) / focalLengthMm;
}

function requiredFNumber(
  focalLengthMm: number,
  focusDistanceMm: number,
  targetDistanceMm: number,
  circleOfConfusionMm: number,
) {
  return (
    (focalLengthMm * focalLengthMm * Math.abs(focusDistanceMm - targetDistanceMm)) /
    (circleOfConfusionMm * targetDistanceMm * (focusDistanceMm - focalLengthMm))
  );
}

function depthOfField(
  focalLengthMm: number,
  focusDistanceMm: number,
  fNumber: number,
  circleOfConfusionMm: number,
) {
  const focalSquared = focalLengthMm * focalLengthMm;
  const numerator = focalSquared * focusDistanceMm;
  const spread = fNumber * circleOfConfusionMm * (focusDistanceMm - focalLengthMm);
  const near = numerator / (focalSquared + spread);
  const farDenominator = focalSquared - spread;
  const far = farDenominator > EPSILON
    ? numerator / farDenominator
    : Number.POSITIVE_INFINITY;
  return { near, far };
}

function resolveFocusDistance(input: TwoDDesignInput) {
  if (input.focusDistanceMm != null) {
    return { distanceMm: input.focusDistanceMm, mode: "manual" as const };
  }
  if (
    isPositiveFinite(input.near.distanceMm) &&
    isPositiveFinite(input.far.distanceMm) &&
    input.near.distanceMm < input.far.distanceMm
  ) {
    const near = input.near.distanceMm;
    const far = input.far.distanceMm;
    // Exact minimax solution for the finite-conjugate blur equations: the
    // near- and far-plane circle-of-confusion requirements are made equal.
    return { distanceMm: (2 * near * far) / (near + far), mode: "automatic" as const };
  }
  return { distanceMm: null, mode: "automatic" as const };
}

function apertureLimitedMaximumFocalLength(
  focusDistanceMm: number,
  nearDistanceMm: number,
  farDistanceMm: number,
  circleOfConfusionMm: number,
  maximumFNumber: number | null | undefined,
) {
  if (maximumFNumber == null) return Number.POSITIVE_INFINITY;
  const nearCoefficient = Math.abs(focusDistanceMm - nearDistanceMm) / nearDistanceMm;
  const farCoefficient = Math.abs(farDistanceMm - focusDistanceMm) / farDistanceMm;
  const blurCoefficient = Math.max(nearCoefficient, farCoefficient);
  if (blurCoefficient <= EPSILON) return Number.POSITIVE_INFINITY;

  // From N = f² A / [c (s - f)], solve the positive root of
  // A f² + N c f - N c s = 0. No far-distance approximation is used.
  const nc = maximumFNumber * circleOfConfusionMm;
  return (
    -nc + Math.sqrt(nc * nc + 4 * blurCoefficient * nc * focusDistanceMm)
  ) / (2 * blurCoefficient);
}

function validate(input: TwoDDesignInput) {
  const errors: string[] = [];
  if (!input.camera.model.trim()) errors.push("请选择或填写相机型号。");
  if (!isPositiveFinite(input.camera.horizontalPixels)) errors.push("横向像素数必须大于 0。");
  if (!isPositiveFinite(input.camera.rows)) errors.push("相机行数必须大于 0。");
  if (!isPositiveFinite(input.camera.pixelPitchUm)) errors.push("像元尺寸必须大于 0。");
  if (!isPositiveFinite(input.near.distanceMm)) errors.push("近端工作面距离必须大于 0。");
  if (input.focusDistanceMm != null && !isPositiveFinite(input.focusDistanceMm)) {
    errors.push("对焦距离必须大于 0，或留空自动计算。");
  }
  if (!isPositiveFinite(input.far.distanceMm)) errors.push("远端工作面距离必须大于 0。");
  if (!isPositiveFinite(input.near.requiredFovMm)) errors.push("近端视场需求必须大于 0。");
  if (!isPositiveFinite(input.far.requiredFovMm)) errors.push("远端视场需求必须大于 0。");
  if (!isNonNegativeFinite(input.fovMarginPercent)) errors.push("视场设计余量不能为负数。");
  if (
    input.maxObjectPixelMm != null &&
    !isPositiveFinite(input.maxObjectPixelMm)
  ) {
    errors.push("分辨率要求必须大于 0，或留空表示不约束。");
  }
  if (input.maximumFNumber != null && !isPositiveFinite(input.maximumFNumber)) {
    errors.push("最大允许 F 值必须大于 0，或留空表示不约束。");
  }
  if (
    isPositiveFinite(input.near.distanceMm) &&
    isPositiveFinite(input.far.distanceMm) &&
    !(input.near.distanceMm < input.far.distanceMm)
  ) {
    errors.push("必须满足：近端工作面 < 远端工作面。");
  }
  if (
    isPositiveFinite(input.near.distanceMm) &&
    input.focusDistanceMm != null &&
    isPositiveFinite(input.focusDistanceMm) &&
    isPositiveFinite(input.far.distanceMm) &&
    !(input.near.distanceMm < input.focusDistanceMm && input.focusDistanceMm < input.far.distanceMm)
  ) {
    errors.push("必须满足：近端工作面 < 对焦面 < 远端工作面。");
  }
  if (input.motion?.enabled) {
    if (!isPositiveFinite(input.motion.maximumSpeedKmh ?? Number.NaN)) {
      errors.push("启用运动采样后，最大运行速度必须大于 0。");
    }
    if (!isPositiveFinite(input.motion.longitudinalSampleMm ?? Number.NaN)) {
      errors.push("启用运动采样后，目标纵向采样必须大于 0。");
    }
  }
  return errors;
}

function solveMotion(input: TwoDDesignInput): MotionResult {
  if (!input.motion?.enabled) {
    return {
      status: "not-requested",
      requiredLineRateKhz: null,
      theoreticalLinePeriodUs: null,
      availableLineRateKhz: input.camera.maxLineRateKhz ?? null,
      message: "未启用运动方向采样校核。",
    };
  }

  const speed = input.motion.maximumSpeedKmh ?? Number.NaN;
  const sample = input.motion.longitudinalSampleMm ?? Number.NaN;
  if (!isPositiveFinite(speed) || !isPositiveFinite(sample)) {
    return {
      status: "unknown",
      requiredLineRateKhz: null,
      theoreticalLinePeriodUs: null,
      availableLineRateKhz: input.camera.maxLineRateKhz ?? null,
      message: "运动采样输入不完整，无法判定。",
    };
  }

  // km/h ÷ 3.6 = m/s; converting m/s to mm/s and line/s to kHz cancels
  // the same factor of 1000, leaving this compact, dimensionally exact form.
  const requiredLineRateKhz = speed / 3.6 / sample;
  const theoreticalLinePeriodUs = 1000 / requiredLineRateKhz;
  const available = input.camera.maxLineRateKhz;
  if (!isPositiveFinite(available ?? Number.NaN)) {
    return {
      status: "unknown",
      requiredLineRateKhz,
      theoreticalLinePeriodUs,
      availableLineRateKhz: null,
      message: "相机设计最高行频未提供，无法完成通过判定。",
    };
  }

  const pass = requiredLineRateKhz <= (available as number) + EPSILON;
  return {
    status: pass ? "pass" : "fail",
    requiredLineRateKhz,
    theoreticalLinePeriodUs,
    availableLineRateKhz: available as number,
    message: pass
      ? "设计最高行频能够覆盖目标纵向采样。"
      : "设计最高行频不足，指定相机无法覆盖目标纵向采样。",
  };
}

function incompleteResult(input: TwoDDesignInput, validationErrors: string[]): TwoDDesignResult {
  const focus = resolveFocusDistance(input);
  return {
    status: "incomplete",
    statusMessage: "请先修正输入项和工作面距离关系。",
    validationErrors,
    sensorWidthMm: Number.NaN,
    designCircleOfConfusionUm: Number.NaN,
    referenceCircleOfConfusionUm: Number.NaN,
    focalRangeMm: { minimum: null, maximum: null },
    targetWorkIntervalMm: { near: input.near.distanceMm, far: input.far.distanceMm },
    resolvedFocusDistanceMm: focus.distanceMm,
    focusMode: focus.mode,
    recommended: null,
    candidates: [],
    rankedCandidates: [],
    motion: solveMotion(input),
    assumptions: {
      distanceDatum: "物方主平面",
      opticalModel: "有限共轭理想薄透镜",
      numericalLabel: "理论选型值",
      diffractionReference: "550 nm 可见光参考波长",
      focusMethod: focus.mode === "automatic" ? "近远端弥散圆平衡的精确解" : "用户指定对焦距离",
    },
  };
}

export function solve2DDesign(input: TwoDDesignInput): TwoDDesignResult {
  const validationErrors = validate(input);
  if (validationErrors.length > 0) return incompleteResult(input, validationErrors);

  const standardFocalLengths = input.standardFocalLengthsMm ?? DEFAULT_STANDARD_FOCAL_LENGTHS_MM;
  const designMultiplier = input.designCircleMultiplier ?? 2;
  const referenceMultiplier = input.referenceCircleMultiplier ?? 3;
  const wavelengthNm = input.referenceWavelengthNm ?? 550;
  const pixelPitchMm = input.camera.pixelPitchUm / 1000;
  const sensorWidthMm = input.camera.horizontalPixels * pixelPitchMm;
  const designCircleMm = pixelPitchMm * designMultiplier;
  const referenceCircleMm = pixelPitchMm * referenceMultiplier;
  const focus = resolveFocusDistance(input);
  const focusDistanceMm = focus.distanceMm as number;
  const marginFactor = 1 + input.fovMarginPercent / 100;
  const nearRequiredWithMargin = input.near.requiredFovMm * marginFactor;
  const farRequiredWithMargin = input.far.requiredFovMm * marginFactor;

  const fovMaximumNear =
    (sensorWidthMm * input.near.distanceMm) / (nearRequiredWithMargin + sensorWidthMm);
  const fovMaximumFar =
    (sensorWidthMm * input.far.distanceMm) / (farRequiredWithMargin + sensorWidthMm);
  const apertureMaximum = apertureLimitedMaximumFocalLength(
    focusDistanceMm,
    input.near.distanceMm,
    input.far.distanceMm,
    designCircleMm,
    input.maximumFNumber,
  );
  const focalMaximum = Math.min(
    fovMaximumNear,
    fovMaximumFar,
    apertureMaximum,
    input.near.distanceMm,
  );
  const focalMinimum = input.maxObjectPixelMm == null
    ? null
    : (pixelPitchMm * input.far.distanceMm) / (input.maxObjectPixelMm + pixelPitchMm);

  const candidates: CandidateResult[] = standardFocalLengths
    .filter((value) => isPositiveFinite(value))
    .map((focalLengthMm) => {
      const failureCodes: CandidateFailureCode[] = [];
      const reasons: string[] = [];
      const validConjugate = focalLengthMm < input.near.distanceMm;

      if (!validConjugate) {
        failureCodes.push("FOCAL_NOT_BELOW_OBJECT_DISTANCE");
        reasons.push("焦距必须小于近端物距");
      }

      const makePlane = (
        distanceMm: number,
        requiredFovMm: number | null,
      ): PlaneResult => {
        const actualFovMm = validConjugate
          ? fieldOfViewMm(sensorWidthMm, distanceMm, focalLengthMm)
          : Number.NaN;
        const requiredFovWithMarginMm = requiredFovMm == null
          ? null
          : requiredFovMm * marginFactor;
        return {
          distanceMm,
          requiredFovMm,
          requiredFovWithMarginMm,
          actualFovMm,
          remainingFovMm: requiredFovWithMarginMm == null
            ? null
            : actualFovMm - requiredFovWithMarginMm,
          objectPixelMm: validConjugate
            ? objectPixelMm(pixelPitchMm, distanceMm, focalLengthMm)
            : Number.NaN,
        };
      };

      const near = makePlane(input.near.distanceMm, input.near.requiredFovMm);
      const focusPlane = makePlane(focusDistanceMm, null);
      const far = makePlane(input.far.distanceMm, input.far.requiredFovMm);

      if (validConjugate && near.actualFovMm + EPSILON < nearRequiredWithMargin) {
        failureCodes.push("NEAR_FOV_SHORTFALL");
        reasons.push(`近端视场不足 ${Math.abs(near.remainingFovMm ?? 0).toFixed(1)} mm`);
      }
      if (validConjugate && far.actualFovMm + EPSILON < farRequiredWithMargin) {
        failureCodes.push("FAR_FOV_SHORTFALL");
        reasons.push(`远端视场不足 ${Math.abs(far.remainingFovMm ?? 0).toFixed(1)} mm`);
      }
      if (
        validConjugate &&
        input.maxObjectPixelMm != null &&
        far.objectPixelMm > input.maxObjectPixelMm + EPSILON
      ) {
        failureCodes.push("OBJECT_PIXEL_EXCEEDED");
        reasons.push(`远端像素当量超限 ${(far.objectPixelMm - input.maxObjectPixelMm).toFixed(3)} mm/px`);
      }

      const requiredNearN = validConjugate
        ? requiredFNumber(
            focalLengthMm,
            focusDistanceMm,
            input.near.distanceMm,
            designCircleMm,
          )
        : Number.NaN;
      const requiredFarN = validConjugate
        ? requiredFNumber(
            focalLengthMm,
            focusDistanceMm,
            input.far.distanceMm,
            designCircleMm,
          )
        : Number.NaN;
      const requiredN = Math.max(requiredNearN, requiredFarN);
      const operatingN = input.maximumFNumber ?? requiredN;
      if (
        validConjugate &&
        input.maximumFNumber != null &&
        requiredN > input.maximumFNumber + EPSILON
      ) {
        failureCodes.push("F_NUMBER_EXCEEDED");
        reasons.push(
          `景深需至少 F/${requiredN.toFixed(1)}，超过上限 F/${input.maximumFNumber.toFixed(1)}`,
        );
      }
      const designDof = validConjugate
        ? depthOfField(focalLengthMm, focusDistanceMm, operatingN, designCircleMm)
        : { near: Number.NaN, far: Number.NaN };
      const referenceDof = validConjugate
        ? depthOfField(focalLengthMm, focusDistanceMm, operatingN, referenceCircleMm)
        : { near: Number.NaN, far: Number.NaN };
      const airyDiameterUm = 2.44 * (wavelengthNm / 1000) * operatingN;
      const feasible = failureCodes.length === 0;
      const diffractionReview = feasible && airyDiameterUm > designCircleMm * 1000 + EPSILON;

      if (feasible) {
        reasons.push(diffractionReview ? "硬约束满足，衍射需复核" : "全部硬约束满足");
      }

      return {
        focalLengthMm,
        requiredFNumber: requiredN,
        operatingFNumber: operatingN,
        designDofNearMm: designDof.near,
        designDofFarMm: designDof.far,
        referenceDofNearMm: referenceDof.near,
        referenceDofFarMm: referenceDof.far,
        airyDiameterUm,
        diffractionReview,
        feasible,
        failureCodes,
        reasons,
        near,
        focus: focusPlane,
        far,
      };
    });

  const rankedCandidates = [...candidates].sort((left, right) => {
    if (left.feasible !== right.feasible) return left.feasible ? -1 : 1;
    if (left.diffractionReview !== right.diffractionReview) {
      return left.diffractionReview ? 1 : -1;
    }
    if (left.focalLengthMm !== right.focalLengthMm) {
      return right.focalLengthMm - left.focalLengthMm;
    }
    return left.requiredFNumber - right.requiredFNumber;
  });
  const recommended = rankedCandidates.find((candidate) => candidate.feasible) ?? null;
  const motion = solveMotion(input);

  let status: SchemeStatus;
  let statusMessage: string;
  if (!recommended) {
    status = "none";
    statusMessage = "没有标准焦距能够同时满足视场、分辨率和光圈硬约束。";
  } else if (motion.status === "fail") {
    status = "none";
    statusMessage = "光学候选可行，但指定相机的设计最高行频不足。";
  } else if (recommended.diffractionReview || motion.status === "unknown") {
    status = "review";
    statusMessage = "硬约束满足，但仍有衍射或相机行频信息需要复核。";
  } else {
    status = "feasible";
    statusMessage = "至少一个标准焦距满足当前全部硬约束。";
  }

  return {
    status,
    statusMessage,
    validationErrors,
    sensorWidthMm,
    designCircleOfConfusionUm: designCircleMm * 1000,
    referenceCircleOfConfusionUm: referenceCircleMm * 1000,
    focalRangeMm: {
      minimum: focalMinimum,
      maximum: focalMaximum > 0 ? focalMaximum : null,
    },
    targetWorkIntervalMm: { near: input.near.distanceMm, far: input.far.distanceMm },
    resolvedFocusDistanceMm: focusDistanceMm,
    focusMode: focus.mode,
    recommended,
    candidates,
    rankedCandidates,
    motion,
    assumptions: {
      distanceDatum: "物方主平面",
      opticalModel: "有限共轭理想薄透镜",
      numericalLabel: "理论选型值",
      diffractionReference: `${wavelengthNm} nm 可见光参考波长`,
      focusMethod: focus.mode === "automatic" ? "近远端弥散圆平衡的精确解" : "用户指定对焦距离",
    },
  };
}

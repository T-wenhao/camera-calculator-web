"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

type Variant = "guided" | "worksheet" | "results";
type CameraMode = "catalog" | "custom";

type DesignState = {
  cameraMode: CameraMode;
  pixelsX: number;
  rows: number;
  pixelPitchUm: number;
  maxLineRateKhz: number;
  nearDistanceMm: number;
  focusDistanceMm: number;
  farDistanceMm: number;
  nearFovMm: number;
  farFovMm: number;
  fovMarginPercent: number;
  maxObjectPixelMm: number;
  speedKmh: number;
  longitudinalSampleMm: number;
};

type Candidate = {
  focal: number;
  fNumber: number;
  nearFov: number;
  focusFov: number;
  farFov: number;
  farPixel: number;
  dofNear: number;
  dofFar: number;
  airyUm: number;
  feasible: boolean;
  needsReview: boolean;
  reasons: string[];
};

const defaultState: DesignState = {
  cameraMode: "catalog",
  pixelsX: 4096,
  rows: 2,
  pixelPitchUm: 7,
  maxLineRateKhz: 28,
  nearDistanceMm: 560,
  focusDistanceMm: 900,
  farDistanceMm: 1400,
  nearFovMm: 700,
  farFovMm: 1070,
  fovMarginPercent: 10,
  maxObjectPixelMm: 0.55,
  speedKmh: 60,
  longitudinalSampleMm: 0.8,
};

const focalOptions = [8, 12.5, 16, 18, 25, 35, 50, 60, 100];

const variantCopy: Record<Variant, { short: string; title: string; note: string }> = {
  guided: {
    short: "A · 引导式",
    title: "逐步完成方案",
    note: "一次只处理一组决策，右侧持续显示方案状态。",
  },
  worksheet: {
    short: "B · 工程表",
    title: "单页工程工作台",
    note: "输入与输出并排，适合熟练工程师快速扫读和录入。",
  },
  results: {
    short: "C · 结果优先",
    title: "先看结论，再追溯条件",
    note: "推荐结果占主位，输入条件压缩成可展开的校核区。",
  },
};

function finiteFov(sensorWidth: number, objectDistance: number, focal: number) {
  if (focal <= 0 || objectDistance <= focal) return Number.NaN;
  return (sensorWidth * (objectDistance - focal)) / focal;
}

function requiredFNumber(
  focal: number,
  focusDistance: number,
  objectDistance: number,
  circleOfConfusion: number,
) {
  if (
    focal <= 0 ||
    focusDistance <= focal ||
    objectDistance <= 0 ||
    circleOfConfusion <= 0
  ) {
    return Number.NaN;
  }

  return (
    (focal * focal * Math.abs(focusDistance - objectDistance)) /
    (circleOfConfusion * objectDistance * (focusDistance - focal))
  );
}

function depthOfField(
  focal: number,
  focusDistance: number,
  fNumber: number,
  circleOfConfusion: number,
) {
  const numerator = focal * focal * focusDistance;
  const spread = fNumber * circleOfConfusion * (focusDistance - focal);
  const near = numerator / (focal * focal + spread);
  const farDenominator = focal * focal - spread;
  const far = farDenominator > 0 ? numerator / farDenominator : Number.POSITIVE_INFINITY;
  return { near, far };
}

function calculate(state: DesignState) {
  const sensorWidth = (state.pixelsX * state.pixelPitchUm) / 1000;
  const circleOfConfusion = (2 * state.pixelPitchUm) / 1000;
  const marginFactor = 1 + state.fovMarginPercent / 100;
  const nearRequiredWithMargin = state.nearFovMm * marginFactor;
  const farRequiredWithMargin = state.farFovMm * marginFactor;

  const candidates: Candidate[] = focalOptions.map((focal) => {
    const nearFov = finiteFov(sensorWidth, state.nearDistanceMm, focal);
    const focusFov = finiteFov(sensorWidth, state.focusDistanceMm, focal);
    const farFov = finiteFov(sensorWidth, state.farDistanceMm, focal);
    const farPixel = farFov / state.pixelsX;
    const nearN = requiredFNumber(
      focal,
      state.focusDistanceMm,
      state.nearDistanceMm,
      circleOfConfusion,
    );
    const farN = requiredFNumber(
      focal,
      state.focusDistanceMm,
      state.farDistanceMm,
      circleOfConfusion,
    );
    const fNumber = Math.max(nearN, farN);
    const dof = depthOfField(focal, state.focusDistanceMm, fNumber, circleOfConfusion);
    const airyUm = 2.44 * 0.55 * fNumber;
    const reasons: string[] = [];

    if (nearFov < nearRequiredWithMargin) reasons.push("近端视场不足");
    if (farFov < farRequiredWithMargin) reasons.push("远端视场不足");
    if (state.maxObjectPixelMm > 0 && farPixel > state.maxObjectPixelMm) {
      reasons.push("远端像素当量超限");
    }
    if (!Number.isFinite(fNumber)) reasons.push("景深条件无解");

    const feasible = reasons.length === 0;
    const needsReview = feasible && airyUm > 2 * state.pixelPitchUm;

    if (feasible) {
      reasons.push(needsReview ? "景深满足，衍射需复核" : "全部硬约束满足");
    }

    return {
      focal,
      fNumber,
      nearFov,
      focusFov,
      farFov,
      farPixel,
      dofNear: dof.near,
      dofFar: dof.far,
      airyUm,
      feasible,
      needsReview,
      reasons,
    };
  });

  const ranked = [...candidates].sort((a, b) => {
    if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
    if (a.needsReview !== b.needsReview) return a.needsReview ? 1 : -1;
    if (a.focal !== b.focal) return b.focal - a.focal;
    return a.fNumber - b.fNumber;
  });
  const recommended = ranked.find((candidate) => candidate.feasible) ?? null;
  const requiredLineRateKhz =
    state.longitudinalSampleMm > 0
      ? ((state.speedKmh * 1000) / 3.6 / state.longitudinalSampleMm) / 1000
      : Number.NaN;
  const motionStatus: "pass" | "fail" | "unknown" =
    state.maxLineRateKhz <= 0
      ? "unknown"
      : requiredLineRateKhz <= state.maxLineRateKhz
        ? "pass"
        : "fail";

  return {
    sensorWidth,
    circleOfConfusion,
    nearRequiredWithMargin,
    farRequiredWithMargin,
    candidates,
    ranked,
    recommended,
    requiredLineRateKhz,
    motionStatus,
    status: !recommended
      ? ("none" as const)
      : recommended.needsReview
        ? ("review" as const)
        : ("feasible" as const),
  };
}

function format(value: number, digits = 1) {
  if (!Number.isFinite(value)) return "∞";
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

function StatusPill({ status }: { status: "feasible" | "review" | "none" }) {
  const text = {
    feasible: "存在可行方案",
    review: "可行但需复核",
    none: "无可行方案",
  }[status];
  return <span className={`proto-status proto-status--${status}`}>{text}</span>;
}

function NumberField({
  label,
  value,
  unit,
  note,
  onChange,
  readOnly = false,
}: {
  label: string;
  value: number;
  unit: string;
  note?: string;
  onChange?: (value: number) => void;
  readOnly?: boolean;
}) {
  return (
    <label className={`proto-field ${readOnly ? "proto-field--derived" : ""}`}>
      <span className="proto-field__label">{label}</span>
      <span className="proto-field__control">
        <input
          type="number"
          value={Number.isFinite(value) ? value : ""}
          onChange={(event) => onChange?.(Number(event.target.value))}
          readOnly={readOnly}
        />
        <span>{unit}</span>
      </span>
      {note ? <small>{note}</small> : null}
    </label>
  );
}

function SectionTitle({
  index,
  title,
  aside,
}: {
  index: string;
  title: string;
  aside?: string;
}) {
  return (
    <div className="proto-section-title">
      <span>{index}</span>
      <div>
        <h2>{title}</h2>
        {aside ? <p>{aside}</p> : null}
      </div>
    </div>
  );
}

function PrototypeHeader({
  variant,
  status,
}: {
  variant: Variant;
  status: "feasible" | "review" | "none";
}) {
  return (
    <header className="proto-topbar">
      <div className="proto-brand">
        <span className="proto-brand__mark">OC</span>
        <div>
          <strong>光学方案计算器</strong>
          <small>2D 线扫选型 · 桌面端界面原型</small>
        </div>
      </div>
      <div className="proto-topbar__center">
        <span>PROTOTYPE</span>
        <strong>{variantCopy[variant].title}</strong>
      </div>
      <div className="proto-topbar__right">
        <span className="proto-demo-label">演示数据，不作为计算验收</span>
        <StatusPill status={status} />
      </div>
    </header>
  );
}

function CameraForm({
  state,
  update,
  setMode,
}: {
  state: DesignState;
  update: (key: keyof DesignState, value: number) => void;
  setMode: (mode: CameraMode) => void;
}) {
  const custom = state.cameraMode === "custom";
  const sensorWidth = (state.pixelsX * state.pixelPitchUm) / 1000;

  return (
    <div className="proto-form-stack">
      <div className="proto-segmented" aria-label="相机参数来源">
        <button className={!custom ? "active" : ""} onClick={() => setMode("catalog")}>
          内置型号
        </button>
        <button className={custom ? "active" : ""} onClick={() => setMode("custom")}>
          自定义相机
        </button>
      </div>
      <label className="proto-select-field">
        <span>相机型号</span>
        <select value={custom ? "custom" : "mv"} disabled={custom} onChange={() => undefined}>
          <option value="mv">MV-CL042-91GC</option>
          <option value="custom">自定义相机</option>
        </select>
        <small>{custom ? "请输入样机或数据手册中的基础参数" : "V1 内置目录 · 参数可追溯"}</small>
      </label>
      <div className="proto-field-grid proto-field-grid--3">
        <NumberField
          label="横向像素数"
          value={state.pixelsX}
          unit="px"
          readOnly={!custom}
          onChange={(value) => update("pixelsX", value)}
        />
        <NumberField
          label="行数"
          value={state.rows}
          unit="行"
          readOnly={!custom}
          onChange={(value) => update("rows", value)}
        />
        <NumberField
          label="像元尺寸"
          value={state.pixelPitchUm}
          unit="μm"
          readOnly={!custom}
          onChange={(value) => update("pixelPitchUm", value)}
        />
      </div>
      <div className="proto-spec-strip">
        <span><small>传感器宽度</small><strong>{format(sensorWidth, 3)} mm</strong></span>
        <span><small>类型</small><strong>彩色线扫</strong></span>
        <span><small>接口</small><strong>GigE</strong></span>
        <span><small>镜头接口</small><strong>M42</strong></span>
      </div>
      <NumberField
        label="设计最高行频"
        value={state.maxLineRateKhz}
        unit="kHz"
        note="按当前项目配置填写；留空或 0 时，运动采样显示“无法判定”。"
        readOnly={!custom}
        onChange={(value) => update("maxLineRateKhz", value)}
      />
    </div>
  );
}

function OpticalForm({
  state,
  update,
}: {
  state: DesignState;
  update: (key: keyof DesignState, value: number) => void;
}) {
  return (
    <div className="proto-form-stack">
      <div className="proto-plane-grid">
        <div className="proto-plane-card proto-plane-card--near">
          <span className="proto-plane-card__tag">近端工作面</span>
          <NumberField
            label="距物方主平面"
            value={state.nearDistanceMm}
            unit="mm"
            onChange={(value) => update("nearDistanceMm", value)}
          />
          <NumberField
            label="原始视场需求"
            value={state.nearFovMm}
            unit="mm"
            onChange={(value) => update("nearFovMm", value)}
          />
        </div>
        <div className="proto-plane-card proto-plane-card--focus">
          <span className="proto-plane-card__tag">对焦面</span>
          <NumberField
            label="对焦距离"
            value={state.focusDistanceMm}
            unit="mm"
            onChange={(value) => update("focusDistanceMm", value)}
          />
          <div className="proto-plane-card__hint">
            <strong>独立输入</strong>
            <span>不默认取近、远工作面的中点</span>
          </div>
        </div>
        <div className="proto-plane-card proto-plane-card--far">
          <span className="proto-plane-card__tag">远端工作面</span>
          <NumberField
            label="距物方主平面"
            value={state.farDistanceMm}
            unit="mm"
            onChange={(value) => update("farDistanceMm", value)}
          />
          <NumberField
            label="原始视场需求"
            value={state.farFovMm}
            unit="mm"
            onChange={(value) => update("farFovMm", value)}
          />
        </div>
      </div>
      <div className="proto-field-grid proto-field-grid--2">
        <NumberField
          label="全局视场余量"
          value={state.fovMarginPercent}
          unit="%"
          note="同时作用于近端和远端；属于工程余量，不写入光学公式。"
          onChange={(value) => update("fovMarginPercent", value)}
        />
        <NumberField
          label="允许最大物方像素当量"
          value={state.maxObjectPixelMm}
          unit="mm/px"
          note="可选硬约束；此处以远端工作面判定。"
          onChange={(value) => update("maxObjectPixelMm", value)}
        />
      </div>
    </div>
  );
}

function MotionForm({
  state,
  update,
  requiredLineRateKhz,
  motionStatus,
}: {
  state: DesignState;
  update: (key: keyof DesignState, value: number) => void;
  requiredLineRateKhz: number;
  motionStatus: "pass" | "fail" | "unknown";
}) {
  const statusText = {
    pass: "行频满足",
    fail: "行频不足",
    unknown: "无法判定",
  }[motionStatus];
  return (
    <div className="proto-form-stack">
      <div className="proto-field-grid proto-field-grid--2">
        <NumberField
          label="最大运行速度"
          value={state.speedKmh}
          unit="km/h"
          onChange={(value) => update("speedKmh", value)}
        />
        <NumberField
          label="目标纵向采样"
          value={state.longitudinalSampleMm}
          unit="mm/line"
          onChange={(value) => update("longitudinalSampleMm", value)}
        />
      </div>
      <div className={`proto-motion-result proto-motion-result--${motionStatus}`}>
        <div>
          <small>所需行频</small>
          <strong>{format(requiredLineRateKhz, 2)} kHz</strong>
        </div>
        <span>{statusText}</span>
        <p>此处仅校核运动方向采样，不计算曝光时间、光源功率或触发脉宽。</p>
      </div>
    </div>
  );
}

function ResultSummary({
  state,
  calculation,
  compact = false,
}: {
  state: DesignState;
  calculation: ReturnType<typeof calculate>;
  compact?: boolean;
}) {
  const chosen = calculation.recommended;
  return (
    <section className={`proto-result-summary ${compact ? "proto-result-summary--compact" : ""}`}>
      <div className="proto-result-summary__head">
        <div>
          <small>推荐结果</small>
          <h2>{chosen ? `${format(chosen.focal, 1)} mm` : "暂无可行焦距"}</h2>
        </div>
        <StatusPill status={calculation.status} />
      </div>
      {chosen ? (
        <>
          <div className="proto-result-metrics">
            <span><small>反算光圈</small><strong>F/{format(chosen.fNumber, 1)}</strong></span>
            <span><small>理论景深</small><strong>{format(chosen.dofNear, 0)}–{format(chosen.dofFar, 0)} mm</strong></span>
            <span><small>对焦位置</small><strong>{format(state.focusDistanceMm, 0)} mm</strong></span>
            <span><small>远端像素当量</small><strong>{format(chosen.farPixel, 3)} mm/px</strong></span>
          </div>
          <div className="proto-review-note">
            <span>!</span>
            <p>
              550 nm 参考波长下，理论艾里斑约 {format(chosen.airyUm, 1)} μm；大于设计弥散圆 {format(2 * state.pixelPitchUm, 1)} μm，作为复核提示，不单独否决方案。
            </p>
          </div>
        </>
      ) : (
        <div className="proto-empty-result">
          当前标准焦距无法同时满足近端视场、远端视场与分辨率约束。请放宽条件或调整安装距离。
        </div>
      )}
    </section>
  );
}

function ViewCone({
  state,
  candidate,
}: {
  state: DesignState;
  candidate: Candidate | null;
}) {
  if (!candidate) {
    return <div className="proto-cone-empty">选出可行焦距后显示视场锥</div>;
  }

  const values = [candidate.nearFov, candidate.focusFov, candidate.farFov];
  const maximum = Math.max(...values);
  const half = (value: number) => 26 + (value / maximum) * 78;
  const xValues = [215, 375, 545];
  const colors = ["#2f7b67", "#2e5e9e", "#7a55a6"];
  const labels = ["近端", "对焦", "远端"];
  const distances = [state.nearDistanceMm, state.focusDistanceMm, state.farDistanceMm];

  return (
    <figure className="proto-cone">
      <figcaption>
        <div><small>视场锥</small><strong>物方主平面基准</strong></div>
        <span>理论选型值</span>
      </figcaption>
      <svg viewBox="0 0 620 285" role="img" aria-label="相机到近端、对焦和远端工作面的视场锥示意图">
        <title>视场锥与三个工作面</title>
        <polygon points={`76,142 545,${142 - half(values[2])} 545,${142 + half(values[2])}`} fill="rgba(53, 104, 170, .08)" />
        <line x1="76" y1="142" x2="545" y2={142 - half(values[2])} className="cone-ray" />
        <line x1="76" y1="142" x2="545" y2={142 + half(values[2])} className="cone-ray" />
        <rect x="43" y="119" width="26" height="46" rx="4" className="cone-camera" />
        <circle cx="76" cy="142" r="7" className="cone-lens" />
        <text x="36" y="188" className="cone-label">相机</text>
        {xValues.map((x, index) => {
          const h = half(values[index]);
          return (
            <g key={labels[index]}>
              <line x1={x} y1={142 - h} x2={x} y2={142 + h} stroke={colors[index]} strokeWidth="3" />
              <circle cx={x} cy="142" r="4" fill={colors[index]} />
              <text x={x} y="260" textAnchor="middle" className="cone-label">{labels[index]} · {format(distances[index], 0)} mm</text>
              <text x={x} y="279" textAnchor="middle" className="cone-value">FOV {format(values[index], 0)} mm</text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

function CandidateTable({
  calculation,
  limit,
}: {
  calculation: ReturnType<typeof calculate>;
  limit?: number;
}) {
  const recommendation = calculation.recommended?.focal;
  const rows = limit
    ? [...calculation.candidates]
        .sort((a, b) => Math.abs(a.focal - (recommendation ?? 18)) - Math.abs(b.focal - (recommendation ?? 18)))
        .slice(0, limit)
        .sort((a, b) => a.focal - b.focal)
    : calculation.candidates;

  return (
    <div className="proto-table-wrap">
      <table className="proto-candidate-table">
        <thead>
          <tr>
            <th>标准焦距</th>
            <th>近端实际视场</th>
            <th>远端实际视场</th>
            <th>远端像素当量</th>
            <th>反算光圈</th>
            <th>判定与原因</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((candidate) => {
            const recommended = candidate.focal === recommendation;
            return (
              <tr key={candidate.focal} className={recommended ? "recommended" : ""}>
                <td><strong>{format(candidate.focal, 1)} mm</strong>{recommended ? <em>推荐</em> : null}</td>
                <td>{format(candidate.nearFov, 0)} mm</td>
                <td>{format(candidate.farFov, 0)} mm</td>
                <td>{format(candidate.farPixel, 3)} mm/px</td>
                <td>F/{format(candidate.fNumber, 1)}</td>
                <td>
                  <span className={`proto-table-status ${candidate.feasible ? (candidate.needsReview ? "review" : "pass") : "fail"}`}>
                    {candidate.feasible ? (candidate.needsReview ? "需复核" : "可行") : "不满足"}
                  </span>
                  <small>{candidate.reasons.join("；")}</small>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ParameterSheet({
  state,
  calculation,
}: {
  state: DesignState;
  calculation: ReturnType<typeof calculate>;
}) {
  const chosen = calculation.recommended;
  return (
    <section className="proto-parameter-sheet">
      <div className="proto-parameter-sheet__title">
        <div>
          <small>可复制为白底图片 · A4 横向</small>
          <h2>光学方案参数表</h2>
        </div>
        <span>二维线扫相机</span>
      </div>
      <div className="proto-parameter-grid">
        <div>
          <h3>相机参数</h3>
          <dl>
            <dt>相机型号</dt><dd>{state.cameraMode === "catalog" ? "MV-CL042-91GC" : "自定义相机"}</dd>
            <dt>相机分辨率</dt><dd>{format(state.pixelsX, 0)} × {format(state.rows, 0)}</dd>
            <dt>像元尺寸</dt><dd>{format(state.pixelPitchUm, 1)} μm</dd>
            <dt>传感器宽度</dt><dd>{format(calculation.sensorWidth, 3)} mm</dd>
          </dl>
        </div>
        <div>
          <h3>设计输入</h3>
          <dl>
            <dt>近 / 对焦 / 远</dt><dd>{state.nearDistanceMm} / {state.focusDistanceMm} / {state.farDistanceMm} mm</dd>
            <dt>近端视场需求</dt><dd>{state.nearFovMm} → {format(calculation.nearRequiredWithMargin, 0)} mm</dd>
            <dt>远端视场需求</dt><dd>{state.farFovMm} → {format(calculation.farRequiredWithMargin, 0)} mm</dd>
            <dt>设计弥散圆</dt><dd>{format(calculation.circleOfConfusion * 1000, 1)} μm</dd>
          </dl>
        </div>
        <div>
          <h3>光学选型</h3>
          <dl>
            <dt>推荐焦距</dt><dd>{chosen ? `${format(chosen.focal, 1)} mm` : "无"}</dd>
            <dt>反算光圈</dt><dd>{chosen ? `F/${format(chosen.fNumber, 1)}` : "—"}</dd>
            <dt>理论景深</dt><dd>{chosen ? `${format(chosen.dofNear, 0)}–${format(chosen.dofFar, 0)} mm` : "—"}</dd>
            <dt>数值标识</dt><dd>理论选型值</dd>
          </dl>
        </div>
        <div>
          <h3>运动采样与提示</h3>
          <dl>
            <dt>目标纵向采样</dt><dd>{format(state.longitudinalSampleMm, 2)} mm/line</dd>
            <dt>所需行频</dt><dd>{format(calculation.requiredLineRateKhz, 2)} kHz</dd>
            <dt>设计最高行频</dt><dd>{state.maxLineRateKhz > 0 ? `${format(state.maxLineRateKhz, 2)} kHz` : "未提供"}</dd>
            <dt>复核提示</dt><dd>{chosen?.needsReview ? "衍射 / 实际镜头 MTF" : "实际镜头 MTF"}</dd>
          </dl>
        </div>
      </div>
    </section>
  );
}

function CalculationButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="proto-primary-action" onClick={onClick}>
      <span>计算并推荐焦距</span>
      <small>校核视场、分辨率、景深与运动采样</small>
    </button>
  );
}

function GuidedVariant({
  state,
  update,
  setMode,
  calculation,
  calculateNow,
}: SharedVariantProps) {
  const [step, setStep] = useState(2);
  const panels: Record<number, ReactNode> = {
    1: (
      <>
        <SectionTitle index="01" title="选择相机" aside="固定相机是镜头选型的前提" />
        <CameraForm state={state} update={update} setMode={setMode} />
      </>
    ),
    2: (
      <>
        <SectionTitle index="02" title="定义三个工作面" aside="距离统一以物方主平面为基准" />
        <OpticalForm state={state} update={update} />
        <CalculationButton onClick={calculateNow} />
      </>
    ),
    3: (
      <>
        <SectionTitle index="03" title="运动方向采样" aside="可选：判断设计行频能否覆盖车辆速度" />
        <MotionForm
          state={state}
          update={update}
          requiredLineRateKhz={calculation.requiredLineRateKhz}
          motionStatus={calculation.motionStatus}
        />
        <CalculationButton onClick={calculateNow} />
      </>
    ),
  };

  return (
    <main className="proto-canvas">
      <div className="proto-page-intro">
        <div><small>方案 A</small><h1>按工程决策逐步推进</h1></div>
        <p>适合不希望一次面对所有参数的用户；每一步只回答一类问题。</p>
      </div>
      <div className="guided-layout">
        <aside className="guided-steps">
          {["选择相机", "光学约束", "运动采样"].map((label, index) => {
            const number = index + 1;
            return (
              <button key={label} className={step === number ? "active" : ""} onClick={() => setStep(number)}>
                <span>{String(number).padStart(2, "0")}</span>
                <div><strong>{label}</strong><small>{number === 3 ? "可选" : "已填写"}</small></div>
              </button>
            );
          })}
          <div className="guided-camera-chip">
            <small>当前相机</small>
            <strong>{state.cameraMode === "catalog" ? "MV-CL042-91GC" : "自定义相机"}</strong>
            <span>{state.pixelsX} px · {state.pixelPitchUm} μm</span>
          </div>
        </aside>
        <section className="proto-card guided-form">{panels[step]}</section>
        <aside className="guided-result">
          <ResultSummary state={state} calculation={calculation} compact />
          <div className="guided-mini-facts">
            <span><small>目标工作面</small><strong>{state.nearDistanceMm}–{state.farDistanceMm} mm</strong></span>
            <span><small>带余量视场</small><strong>{format(calculation.nearRequiredWithMargin, 0)} / {format(calculation.farRequiredWithMargin, 0)} mm</strong></span>
            <span><small>候选结果</small><strong>{calculation.candidates.filter((item) => item.feasible).length} / {calculation.candidates.length} 可行</strong></span>
          </div>
          <button className="proto-secondary-action" onClick={() => setStep(2)}>返回修改光学约束</button>
        </aside>
      </div>
      <section className="proto-lower-section">
        <div className="proto-lower-section__head"><div><small>候选对比</small><h2>最接近推荐值的标准焦距</h2></div><span>无隐藏评分</span></div>
        <CandidateTable calculation={calculation} limit={3} />
      </section>
    </main>
  );
}

function WorksheetVariant({
  state,
  update,
  setMode,
  calculation,
  calculateNow,
}: SharedVariantProps) {
  return (
    <main className="proto-canvas">
      <div className="proto-page-intro proto-page-intro--compact">
        <div><small>方案 B</small><h1>像工程表，但不是 Excel</h1></div>
        <p>保留熟悉的横向对照感，同时用颜色区分输入、推导值和判定。</p>
      </div>
      <div className="worksheet-progress">
        <span className="done"><i>1</i>相机参数</span><b></b>
        <span className="done"><i>2</i>光学约束</span><b></b>
        <span><i>3</i>运动采样</span><b></b>
        <span className="result"><i>4</i>推荐结果</span>
      </div>
      <div className="worksheet-grid">
        <section className="proto-card worksheet-inputs">
          <SectionTitle index="01" title="相机与传感器" aside="浅蓝底为目录或推导值" />
          <CameraForm state={state} update={update} setMode={setMode} />
          <div className="proto-divider" />
          <SectionTitle index="02" title="工作面与硬约束" aside="浅黄底可编辑" />
          <OpticalForm state={state} update={update} />
          <div className="proto-divider" />
          <SectionTitle index="03" title="运动采样（可选）" />
          <MotionForm
            state={state}
            update={update}
            requiredLineRateKhz={calculation.requiredLineRateKhz}
            motionStatus={calculation.motionStatus}
          />
          <CalculationButton onClick={calculateNow} />
        </section>
        <aside className="worksheet-results">
          <ResultSummary state={state} calculation={calculation} />
          <ViewCone state={state} candidate={calculation.recommended} />
          <div className="worksheet-assumptions">
            <strong>本次计算口径</strong>
            <span>有限共轭薄透镜</span>
            <span>弥散圆 = 2 × 像元</span>
            <span>550 nm 衍射参考</span>
          </div>
        </aside>
      </div>
      <section className="proto-lower-section">
        <div className="proto-lower-section__head"><div><small>全部候选</small><h2>标准焦距筛选明细</h2></div><span>视场 → 分辨率 → 衍射提示 → 长焦优先</span></div>
        <CandidateTable calculation={calculation} />
      </section>
      <ParameterSheet state={state} calculation={calculation} />
    </main>
  );
}

function ResultsFirstVariant({
  state,
  update,
  setMode,
  calculation,
  calculateNow,
}: SharedVariantProps) {
  const [editing, setEditing] = useState(false);
  return (
    <main className="proto-canvas">
      <div className="proto-page-intro proto-page-intro--results">
        <div><small>方案 C</small><h1>结论先行的方案评审页</h1></div>
        <button className="proto-outline-action" onClick={() => setEditing((value) => !value)}>
          {editing ? "收起输入条件" : "修改输入条件"}
        </button>
      </div>
      <div className="condition-strip">
        <span><small>相机</small><strong>MV-CL042-91GC</strong></span>
        <span><small>三个工作面</small><strong>{state.nearDistanceMm} / {state.focusDistanceMm} / {state.farDistanceMm} mm</strong></span>
        <span><small>视场需求 + {state.fovMarginPercent}%</small><strong>{format(calculation.nearRequiredWithMargin, 0)} / {format(calculation.farRequiredWithMargin, 0)} mm</strong></span>
        <span><small>分辨率上限</small><strong>{state.maxObjectPixelMm} mm/px</strong></span>
      </div>
      {editing ? (
        <section className="proto-card results-edit-panel">
          <div>
            <SectionTitle index="01" title="相机" />
            <CameraForm state={state} update={update} setMode={setMode} />
          </div>
          <div>
            <SectionTitle index="02" title="光学与运动约束" />
            <OpticalForm state={state} update={update} />
            <MotionForm
              state={state}
              update={update}
              requiredLineRateKhz={calculation.requiredLineRateKhz}
              motionStatus={calculation.motionStatus}
            />
            <CalculationButton onClick={() => { calculateNow(); setEditing(false); }} />
          </div>
        </section>
      ) : null}
      <section className="results-hero">
        <ResultSummary state={state} calculation={calculation} />
        <ViewCone state={state} candidate={calculation.recommended} />
      </section>
      <div className="results-columns">
        <section className="proto-lower-section">
          <div className="proto-lower-section__head"><div><small>为什么推荐它</small><h2>候选焦距与淘汰原因</h2></div><span>9 个标准焦距</span></div>
          <CandidateTable calculation={calculation} />
        </section>
        <aside className="results-audit">
          <h2>判定摘要</h2>
          <ol>
            <li className="pass"><span>1</span><div><strong>视场硬约束</strong><small>近、远端均按 10% 余量校核</small></div></li>
            <li className="pass"><span>2</span><div><strong>物方像素当量</strong><small>以最不利的远端工作面判定</small></div></li>
            <li className="review"><span>3</span><div><strong>目标景深反算光圈</strong><small>可覆盖目标工作面，衍射需复核</small></div></li>
            <li className={calculation.motionStatus === "pass" ? "pass" : "review"}><span>4</span><div><strong>运动方向采样</strong><small>所需 {format(calculation.requiredLineRateKhz, 2)} kHz</small></div></li>
          </ol>
          <details>
            <summary>公式、基准与假设</summary>
            <p>工作距离以物方主平面为基准；使用有限共轭理想薄透镜和几何离焦关系。实际镜头主平面、畸变、MTF 与装调误差留待具体型号复核。</p>
          </details>
        </aside>
      </div>
      <ParameterSheet state={state} calculation={calculation} />
    </main>
  );
}

type SharedVariantProps = {
  state: DesignState;
  update: (key: keyof DesignState, value: number) => void;
  setMode: (mode: CameraMode) => void;
  calculation: ReturnType<typeof calculate>;
  calculateNow: () => void;
};

function VariantBar({ variant, setVariant }: { variant: Variant; setVariant: (variant: Variant) => void }) {
  return (
    <nav className="proto-variant-bar" aria-label="切换界面原型方案">
      <div>
        <small>可抛弃原型</small>
        <strong>切换界面组织方式</strong>
      </div>
      {(Object.keys(variantCopy) as Variant[]).map((item) => (
        <button key={item} className={variant === item ? "active" : ""} onClick={() => setVariant(item)}>
          {variantCopy[item].short}
        </button>
      ))}
      <span className="proto-variant-note">{variantCopy[variant].note}</span>
    </nav>
  );
}

export default function PrototypePage() {
  const [variant, setVariantState] = useState<Variant>("guided");
  const [state, setState] = useState(defaultState);
  const [lastCalculatedAt, setLastCalculatedAt] = useState("刚刚");
  const calculation = useMemo(() => calculate(state), [state]);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("variant") as Variant | null;
    if (value && value in variantCopy) setVariantState(value);
  }, []);

  const setVariant = (next: Variant) => {
    const url = new URL(window.location.href);
    url.searchParams.set("variant", next);
    window.history.replaceState(null, "", url);
    setVariantState(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const update = (key: keyof DesignState, value: number) => {
    setState((current) => ({ ...current, [key]: value }));
  };

  const setMode = (cameraMode: CameraMode) => {
    setState((current) => ({ ...current, cameraMode }));
  };

  const calculateNow = () => {
    setLastCalculatedAt(new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date()));
  };

  const shared = { state, update, setMode, calculation, calculateNow };

  return (
    <div className="proto-shell">
      <PrototypeHeader variant={variant} status={calculation.status} />
      {variant === "guided" ? <GuidedVariant {...shared} /> : null}
      {variant === "worksheet" ? <WorksheetVariant {...shared} /> : null}
      {variant === "results" ? <ResultsFirstVariant {...shared} /> : null}
      <div className="proto-recalc-stamp">最近计算：{lastCalculatedAt}</div>
      <VariantBar variant={variant} setVariant={setVariant} />
    </div>
  );
}

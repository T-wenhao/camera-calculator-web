"use client";

import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import {
  solve2DDesign,
  type CameraSpecification,
  type CandidateResult,
  type SchemeStatus,
  type TwoDDesignInput,
} from "@/lib/optics/solve-2d-design";
import { buildFovConeGeometry } from "@/lib/optics/fov-cone-geometry";

type Mode = "2d" | "3d";
type CameraSource = "catalog" | "custom";

const catalogCamera: CameraSpecification = {
  model: "MV-CL042-91GC",
  horizontalPixels: 4096,
  rows: 2,
  pixelPitchUm: 7,
  maxLineRateKhz: 28,
  sensorType: "彩色线扫",
  dataInterface: "GigE",
  lensMount: "M42",
};

const initialInput: TwoDDesignInput = {
  camera: catalogCamera,
  near: { distanceMm: 560, requiredFovMm: 700 },
  focusDistanceMm: null,
  far: { distanceMm: 1400, requiredFovMm: 1070 },
  fovMarginPercent: 10,
  maxObjectPixelMm: 0.55,
  maximumFNumber: 11,
  motion: {
    enabled: true,
    maximumSpeedKmh: 60,
    longitudinalSampleMm: 0.8,
  },
};

const statusCopy: Record<SchemeStatus, { label: string; detail: string }> = {
  incomplete: { label: "待完善输入", detail: "修正必填项后才能执行选型" },
  feasible: { label: "存在可行方案", detail: "当前硬约束均已满足" },
  review: { label: "可行但需复核", detail: "硬约束满足，仍有工程复核项" },
  none: { label: "无可行方案", detail: "至少一项硬约束无法满足" },
};

function cloneInput(input: TwoDDesignInput): TwoDDesignInput {
  return {
    ...input,
    camera: { ...input.camera },
    near: { ...input.near },
    far: { ...input.far },
    motion: input.motion ? { ...input.motion } : undefined,
  };
}

function format(value: number | null | undefined, digits = 1) {
  if (value == null) return "—";
  if (value === Number.POSITIVE_INFINITY) return "∞";
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function focalRangeText(
  range: ReturnType<typeof solve2DDesign>["focalRangeMm"],
  digits = 1,
) {
  if (range.minimum != null && range.maximum != null && range.minimum > range.maximum) {
    return "无连续可行区间";
  }
  if (range.minimum == null && range.maximum != null) return `≤ ${format(range.maximum, digits)} mm`;
  if (range.minimum != null && range.maximum == null) return `≥ ${format(range.minimum, digits)} mm`;
  if (range.minimum == null || range.maximum == null) return "—";
  return `${format(range.minimum, digits)}–${format(range.maximum, digits)} mm`;
}

function noResultDetail(result: ReturnType<typeof solve2DDesign>) {
  if (result.validationErrors.length > 0) return result.validationErrors[0];
  const apertureOnly = result.candidates
    .filter((candidate) => (
      candidate.failureCodes.length === 1 &&
      candidate.failureCodes.includes("F_NUMBER_EXCEEDED")
    ))
    .sort((left, right) => left.requiredFNumber - right.requiredFNumber)[0];
  const resolutionOnly = result.candidates
    .filter((candidate) => (
      candidate.failureCodes.length === 1 &&
      candidate.failureCodes.includes("OBJECT_PIXEL_EXCEEDED") &&
      candidate.requiredFNumber <= candidate.operatingFNumber
    ))
    .sort((left, right) => right.focalLengthMm - left.focalLengthMm)[0];
  const focus = result.resolvedFocusDistanceMm == null
    ? ""
    : `${result.focusMode === "automatic" ? "自动" : "手动"}对焦 ${format(result.resolvedFocusDistanceMm, 0)} mm。`;
  if (apertureOnly) {
    const resolutionTradeoff = resolutionOnly
      ? ` ${format(resolutionOnly.focalLengthMm, 1)} mm 可在 F/${format(resolutionOnly.operatingFNumber, 1)} 覆盖景深，但远端像素当量 ${format(resolutionOnly.far.objectPixelMm, 3)} mm/px 被分辨率约束淘汰。`
      : "";
    return `${focus}${format(apertureOnly.focalLengthMm, 1)} mm 已满足视场和分辨率，但景深至少需要 F/${format(apertureOnly.requiredFNumber, 1)}，超过设定的 F/${format(apertureOnly.operatingFNumber, 1)} 上限。${resolutionTradeoff}`;
  }
  return `${focus}当前标准焦距无法同时满足视场、分辨率、景深光圈和运动采样约束。`;
}

function NumberField({
  label,
  value,
  unit,
  note,
  optional = false,
  readOnly = false,
  onChange,
}: {
  label: string;
  value: number | null | undefined;
  unit: string;
  note?: string;
  optional?: boolean;
  readOnly?: boolean;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className={`work-field ${readOnly ? "work-field--derived" : ""}`}>
      <span className="work-field__label">
        {label}
        {optional ? <em>可选</em> : null}
      </span>
      <span className="work-field__control">
        <input
          type="number"
          step="any"
          value={value ?? ""}
          readOnly={readOnly}
          onChange={(event) => {
            const raw = event.target.value;
            onChange(raw === "" ? null : Number(raw));
          }}
        />
        <span>{unit}</span>
      </span>
      {note ? <small>{note}</small> : null}
    </label>
  );
}

function TextField({
  label,
  value,
  note,
  onChange,
}: {
  label: string;
  value: string;
  note?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="work-field">
      <span className="work-field__label">{label}</span>
      <span className="work-field__control work-field__control--text">
        <input type="text" value={value} onChange={(event) => onChange(event.target.value)} />
      </span>
      {note ? <small>{note}</small> : null}
    </label>
  );
}

function SectionHeading({
  number,
  title,
  note,
  aside,
}: {
  number: string;
  title: string;
  note: string;
  aside?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <span>{number}</span>
      <div>
        <h2>{title}</h2>
        <p>{note}</p>
      </div>
      {aside ? <div className="section-heading__aside">{aside}</div> : null}
    </div>
  );
}

function StatusPill({ status }: { status: SchemeStatus }) {
  return <span className={`scheme-status scheme-status--${status}`}>{statusCopy[status].label}</span>;
}

function FovCone({ candidate }: { candidate: CandidateResult | null }) {
  if (!candidate) {
    return <div className="cone-empty">选出可行焦距后显示视场锥</div>;
  }

  const planes = [candidate.near, candidate.focus, candidate.far];
  const labels = ["近端", "对焦", "远端"];
  const geometry = buildFovConeGeometry(planes);
  const stageStyle = {
    "--cone-origin-x": `${geometry.originXPercent}%`,
    "--cone-axis-y": `${geometry.axisYPercent}%`,
    "--cone-far-x": `${geometry.farXPercent}%`,
    "--cone-far-half": `${geometry.farHalfHeightPercent}%`,
    "--cone-ray-length": `${geometry.rayLengthPercent}%`,
    "--cone-ray-angle": `${geometry.rayAngleDeg}deg`,
    "--cone-ray-angle-negative": `${-geometry.rayAngleDeg}deg`,
  } as CSSProperties;

  return (
    <figure className="fov-cone">
      <figcaption>
        <div><small>视场锥</small><strong>三个工作面的实际覆盖</strong></div>
        <span>水平全视场角 {format(geometry.fullViewAngleDeg, 1)}° · 物方主平面基准</span>
      </figcaption>
      <div className="cone-stage" style={stageStyle}>
        <div className="cone-wedge" />
        <div className="cone-axis" />
        <div className="cone-ray cone-ray--top" />
        <div className="cone-ray cone-ray--bottom" />
        <div className="cone-camera"><i /></div>
        {geometry.planes.map((plane, index) => {
          const label = labels[index];
          return (
            <div
              className={`cone-plane cone-plane--${index + 1}`}
              key={label}
              title={`${label}：${format(plane.distanceMm, 0)} mm，FOV ${format(plane.actualFovMm, 0)} mm`}
              style={{ "--plane-left": `${plane.leftPercent}%`, "--plane-height": `${plane.heightPercent}%` } as CSSProperties}
            >
              <i />
            </div>
          );
        })}
      </div>
      <div className="cone-legend">
        {geometry.planes.map((plane, index) => (
          <span className={`cone-legend__item cone-plane--${index + 1}`} key={labels[index]}>
            <i />
            <small>{labels[index]} · {format(plane.distanceMm, 0)} mm</small>
            <strong>FOV {format(plane.actualFovMm, 0)} mm</strong>
          </span>
        ))}
      </div>
    </figure>
  );
}

function ResultSummary({
  result,
  stale,
}: {
  result: ReturnType<typeof solve2DDesign>;
  stale: boolean;
}) {
  const recommendation = result.recommended;
  return (
    <section className="result-card">
      {stale ? (
        <div className="stale-banner">
          <span>输入已变化</span>
          <p>下方仍是上一次有效结果，请重新计算后再导出。</p>
        </div>
      ) : null}
      <div className="result-card__head">
        <div>
          <small>推荐结果</small>
          <h2>{recommendation ? `${format(recommendation.focalLengthMm, 1)} mm` : "暂无推荐"}</h2>
          <p>{result.statusMessage}</p>
        </div>
        <StatusPill status={result.status} />
      </div>
      {recommendation ? (
        <>
          <div className="result-metrics">
            <span><small>连续焦距可行区间</small><strong>{focalRangeText(result.focalRangeMm, 1)}</strong></span>
            <span><small>建议工作光圈</small><strong>F/{format(recommendation.operatingFNumber, 1)}</strong></span>
            <span><small>景深所需最低 F 值</small><strong>≥ F/{format(recommendation.requiredFNumber, 1)}</strong></span>
            <span><small>目标工作区间</small><strong>{format(result.targetWorkIntervalMm.near, 0)}–{format(result.targetWorkIntervalMm.far, 0)} mm</strong></span>
            <span><small>理论景深范围</small><strong>{format(recommendation.designDofNearMm, 0)}–{format(recommendation.designDofFarMm, 0)} mm</strong></span>
            <span><small>对焦位置</small><strong>{format(result.resolvedFocusDistanceMm, 0)} mm · {result.focusMode === "automatic" ? "自动" : "手动"}</strong></span>
            <span><small>近端像素当量</small><strong>{format(recommendation.near.objectPixelMm, 3)} mm/px</strong></span>
            <span><small>远端像素当量</small><strong>{format(recommendation.far.objectPixelMm, 3)} mm/px</strong></span>
            <span><small>所需行频</small><strong>{result.motion.requiredLineRateKhz == null ? "未校核" : `${format(result.motion.requiredLineRateKhz, 2)} kHz`}</strong></span>
            <span><small>运动采样</small><strong>{motionStatusLabel(result.motion.status)}</strong></span>
          </div>
          {recommendation.diffractionReview ? (
            <div className="review-message">
              <b>!</b>
              <p>550 nm 参考下理论艾里斑约 {format(recommendation.airyDiameterUm, 1)} μm，大于设计弥散圆 {format(result.designCircleOfConfusionUm, 1)} μm；仅提示复核，不单独否决。</p>
            </div>
          ) : null}
        </>
      ) : (
        <div className="no-result-message">
          {noResultDetail(result)}
        </div>
      )}
    </section>
  );
}

type ParameterSection = {
  title: string;
  rows: Array<{ label: string; value: string }>;
};

function motionStatusLabel(status: ReturnType<typeof solve2DDesign>["motion"]["status"]) {
  return {
    "not-requested": "未启用",
    pass: "满足",
    fail: "不满足",
    unknown: "无法判定",
  }[status];
}

function buildParameterSections(
  input: TwoDDesignInput,
  result: ReturnType<typeof solve2DDesign>,
): ParameterSection[] {
  const recommendation = result.recommended;
  const marginFactor = 1 + input.fovMarginPercent / 100;
  const motion = input.motion;
  return [
    {
      title: "相机参数",
      rows: [
        { label: "相机型号", value: input.camera.model },
        { label: "相机分辨率", value: `${format(input.camera.horizontalPixels, 0)} × ${format(input.camera.rows, 0)}` },
        { label: "像元尺寸", value: `${format(input.camera.pixelPitchUm, 2)} μm` },
        { label: "传感器宽度", value: `${format(result.sensorWidthMm, 3)} mm` },
        { label: "设计最高行频", value: input.camera.maxLineRateKhz == null ? "未提供" : `${format(input.camera.maxLineRateKhz, 2)} kHz` },
        { label: "类型 / 接口 / 镜头接口", value: `${input.camera.sensorType ?? "未填写"} / ${input.camera.dataInterface ?? "未填写"} / ${input.camera.lensMount ?? "未填写"}` },
      ],
    },
    {
      title: "设计输入",
      rows: [
        { label: "目标工作区间", value: `${format(input.near.distanceMm, 0)}–${format(input.far.distanceMm, 0)} mm` },
        { label: "对焦位置", value: `${format(result.resolvedFocusDistanceMm, 0)} mm（${result.focusMode === "automatic" ? "自动平衡近远端" : "手动指定"}）` },
        { label: "近端视场需求", value: `${format(input.near.requiredFovMm, 0)} → ${format(input.near.requiredFovMm * marginFactor, 0)} mm` },
        { label: "远端视场需求", value: `${format(input.far.requiredFovMm, 0)} → ${format(input.far.requiredFovMm * marginFactor, 0)} mm` },
        { label: "视场余量 / 最大像素当量", value: `${format(input.fovMarginPercent, 1)} % / ${input.maxObjectPixelMm == null ? "未约束" : `${format(input.maxObjectPixelMm, 3)} mm/px`}` },
        { label: "最大允许 F 值", value: input.maximumFNumber == null ? "未约束" : `F/${format(input.maximumFNumber, 1)}` },
      ],
    },
    {
      title: "光学选型与计算结果",
      rows: [
        { label: "连续焦距可行区间", value: focalRangeText(result.focalRangeMm, 2) },
        { label: "推荐标准焦距", value: recommendation ? `${format(recommendation.focalLengthMm, 1)} mm` : "无（详见候选表）" },
        { label: "景深最低 / 建议工作光圈", value: recommendation ? `≥ F/${format(recommendation.requiredFNumber, 2)} / F/${format(recommendation.operatingFNumber, 2)}` : "—" },
        { label: "理论景深范围（工作光圈，2×像元）", value: recommendation ? `${format(recommendation.designDofNearMm, 0)}–${format(recommendation.designDofFarMm, 0)} mm` : "—" },
        { label: "参考景深范围（3×像元）", value: recommendation ? `${format(recommendation.referenceDofNearMm, 0)}–${format(recommendation.referenceDofFarMm, 0)} mm` : "—" },
        { label: "近 / 对焦 / 远像素当量", value: recommendation ? `${format(recommendation.near.objectPixelMm, 3)} / ${format(recommendation.focus.objectPixelMm, 3)} / ${format(recommendation.far.objectPixelMm, 3)} mm/px` : "—" },
      ],
    },
    {
      title: "运动采样与提示",
      rows: [
        { label: "最大运行速度", value: motion?.enabled ? `${format(motion.maximumSpeedKmh, 1)} km/h` : "未启用" },
        { label: "目标纵向采样", value: motion?.enabled ? `${format(motion.longitudinalSampleMm, 3)} mm/line` : "未启用" },
        { label: "所需行频", value: result.motion.requiredLineRateKhz == null ? "—" : `${format(result.motion.requiredLineRateKhz, 3)} kHz` },
        { label: "理论行周期", value: result.motion.theoreticalLinePeriodUs == null ? "—" : `${format(result.motion.theoreticalLinePeriodUs, 2)} μs` },
        { label: "方案状态", value: statusCopy[result.status].label },
        { label: "复核提示", value: recommendation?.diffractionReview ? "衍射、具体镜头主平面与 MTF" : "具体镜头主平面与 MTF" },
      ],
    },
  ];
}

function CandidateTable({
  result,
  stale,
}: {
  result: ReturnType<typeof solve2DDesign>;
  stale: boolean;
}) {
  const recommendedFocal = result.recommended?.focalLengthMm;
  return (
    <section className="output-panel candidate-panel">
      <div className="output-heading">
        <div><small>FOCAL CANDIDATES</small><h2>标准焦距筛选明细</h2><p>展示全部候选及淘汰原因，不使用隐藏评分。</p></div>
        <span className={stale ? "output-age output-age--stale" : "output-age"}>{stale ? "上次有效结果" : `${result.candidates.filter((candidate) => candidate.feasible).length} / ${result.candidates.length} 可行`}</span>
      </div>
      <div className="candidate-table-wrap">
        <table className="candidate-table">
          <thead><tr><th>标准焦距</th><th>近端实际 / 要求视场</th><th>远端实际 / 要求视场</th><th>远端像素当量</th><th>景深最低 / 设定光圈</th><th>判定与原因</th></tr></thead>
          <tbody>
            {result.candidates.map((candidate) => {
              const recommended = candidate.focalLengthMm === recommendedFocal;
              return (
                <tr key={candidate.focalLengthMm} className={recommended ? "recommended" : ""}>
                  <td><strong>{format(candidate.focalLengthMm, 1)} mm</strong>{recommended ? <em>推荐</em> : null}</td>
                  <td>{format(candidate.near.actualFovMm, 0)} / {format(candidate.near.requiredFovWithMarginMm, 0)} mm</td>
                  <td>{format(candidate.far.actualFovMm, 0)} / {format(candidate.far.requiredFovWithMarginMm, 0)} mm</td>
                  <td>{format(candidate.far.objectPixelMm, 3)} mm/px</td>
                  <td>≥ F/{format(candidate.requiredFNumber, 1)}<small>设定 F/{format(candidate.operatingFNumber, 1)}</small></td>
                  <td><span className={`candidate-status ${candidate.feasible ? (candidate.diffractionReview ? "review" : "pass") : "fail"}`}>{candidate.feasible ? (candidate.diffractionReview ? "需复核" : "可行") : "不满足"}</span><small>{candidate.reasons.join("；")}</small></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ParameterSheet({
  sections,
  stale,
  canExport,
  exportMessage,
  onCopy,
  onDownload,
  onPrint,
}: {
  sections: ParameterSection[];
  stale: boolean;
  canExport: boolean;
  exportMessage: string;
  onCopy: () => void;
  onDownload: () => void;
  onPrint: () => void;
}) {
  return (
    <section className="output-panel parameter-panel" id="optical-parameter-sheet">
      <div className="parameter-heading">
        <div><small>DELIVERABLE TABLE</small><h2>光学方案参数表</h2><p>白底排版，适合复制到 Word 或按 A4 横向打印。</p></div>
        <div className="export-actions">
          <button disabled={!canExport} onClick={onCopy}>复制 PNG</button>
          <button disabled={!canExport} onClick={onDownload}>下载 PNG</button>
          <button disabled={!canExport} onClick={onPrint}>打印 / PDF</button>
        </div>
      </div>
      {stale ? <div className="parameter-stale">输入已变化，导出已暂停；重新计算后恢复。</div> : null}
      {exportMessage ? <div className="export-message" role="status">{exportMessage}</div> : null}
      <div className="parameter-grid">
        {sections.map((section) => (
          <div className="parameter-group" key={section.title}>
            <h3>{section.title}</h3>
            <dl>
              {section.rows.map((row) => (
                <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>
              ))}
            </dl>
          </div>
        ))}
      </div>
      <footer><span>理论选型值 · 距离基准：物方主平面</span><span>实际镜头需复核主平面、畸变、MTF 与装调误差</span></footer>
    </section>
  );
}

function createParameterPng(sections: ParameterSection[], status: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 1800;
  canvas.height = 1120;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("当前浏览器无法创建图片画布。"));

  const panelWidth = 810;
  const panelHeight = 390;
  const panelPositions = [[60, 190], [930, 190], [60, 620], [930, 620]];
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#18232e";
  context.font = "700 42px 'Microsoft YaHei', 'Segoe UI', sans-serif";
  context.fillText("光学方案参数表", 60, 78);
  context.fillStyle = "#66727f";
  context.font = "22px 'Microsoft YaHei', 'Segoe UI', sans-serif";
  context.fillText("二维线扫相机 · 理论选型值 · 距离基准：物方主平面", 60, 122);
  context.fillStyle = "#9a5a18";
  context.font = "700 22px 'Microsoft YaHei', 'Segoe UI', sans-serif";
  context.textAlign = "right";
  context.fillText(status, 1740, 82);
  context.textAlign = "left";

  const clippedText = (text: string, x: number, y: number, maxWidth: number) => {
    let output = text;
    while (context.measureText(output).width > maxWidth && output.length > 2) {
      output = `${output.slice(0, -2)}…`;
    }
    context.fillText(output, x, y);
  };

  sections.slice(0, 4).forEach((section, index) => {
    const [x, y] = panelPositions[index];
    context.strokeStyle = "#aeb8c2";
    context.lineWidth = 2;
    context.strokeRect(x, y, panelWidth, panelHeight);
    context.fillStyle = "#e9edf1";
    context.fillRect(x, y, panelWidth, 48);
    context.fillStyle = "#18232e";
    context.font = "700 22px 'Microsoft YaHei', 'Segoe UI', sans-serif";
    context.fillText(section.title, x + 18, y + 32);
    const rowHeight = 57;
    section.rows.slice(0, 6).forEach((row, rowIndex) => {
      const rowY = y + 48 + rowIndex * rowHeight;
      context.fillStyle = rowIndex % 2 === 0 ? "#f8f9fa" : "#ffffff";
      context.fillRect(x, rowY, panelWidth, rowHeight);
      context.strokeStyle = "#d8dee5";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, rowY);
      context.lineTo(x + panelWidth, rowY);
      context.moveTo(x + 305, rowY);
      context.lineTo(x + 305, rowY + rowHeight);
      context.stroke();
      context.fillStyle = "#66727f";
      context.font = "19px 'Microsoft YaHei', 'Segoe UI', sans-serif";
      clippedText(row.label, x + 16, rowY + 36, 270);
      context.fillStyle = "#18232e";
      context.font = "600 19px 'Microsoft YaHei', 'Segoe UI', sans-serif";
      clippedText(row.value, x + 325, rowY + 36, 455);
    });
  });

  context.fillStyle = "#66727f";
  context.font = "18px 'Microsoft YaHei', 'Segoe UI', sans-serif";
  context.fillText("实际镜头需复核主平面、畸变、MTF 与装调误差。", 60, 1070);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG 生成失败。")), "image/png");
  });
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("2d");
  const [cameraSource, setCameraSource] = useState<CameraSource>("catalog");
  const [draft, setDraft] = useState<TwoDDesignInput>(() => cloneInput(initialInput));
  const [committed, setCommitted] = useState<TwoDDesignInput>(() => cloneInput(initialInput));
  const [inputErrors, setInputErrors] = useState<string[]>([]);
  const [exportMessage, setExportMessage] = useState("");
  const result = useMemo(() => solve2DDesign(committed), [committed]);
  const parameterSections = useMemo(() => buildParameterSections(committed, result), [committed, result]);
  const stale = JSON.stringify(draft) !== JSON.stringify(committed);
  const draftSensorWidth = draft.camera.horizontalPixels * draft.camera.pixelPitchUm / 1000;
  const canExport = !stale && result.status !== "incomplete";

  const updateRoot = (patch: Partial<TwoDDesignInput>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setInputErrors([]);
    setExportMessage("");
  };

  const updateCamera = (patch: Partial<CameraSpecification>) => {
    setDraft((current) => ({ ...current, camera: { ...current.camera, ...patch } }));
    setInputErrors([]);
    setExportMessage("");
  };
  const updateNear = (patch: Partial<TwoDDesignInput["near"]>) => {
    setDraft((current) => ({ ...current, near: { ...current.near, ...patch } }));
    setInputErrors([]);
    setExportMessage("");
  };
  const updateFar = (patch: Partial<TwoDDesignInput["far"]>) => {
    setDraft((current) => ({ ...current, far: { ...current.far, ...patch } }));
    setInputErrors([]);
    setExportMessage("");
  };
  const updateMotion = (patch: Partial<NonNullable<TwoDDesignInput["motion"]>>) => {
    setDraft((current) => ({
      ...current,
      motion: { enabled: false, ...current.motion, ...patch },
    }));
    setInputErrors([]);
    setExportMessage("");
  };

  const switchCameraSource = (source: CameraSource) => {
    setCameraSource(source);
    if (source === "catalog") {
      setDraft((current) => ({ ...current, camera: { ...catalogCamera } }));
    } else {
      setDraft((current) => ({
        ...current,
        camera: {
          model: "自定义相机",
          horizontalPixels: current.camera.horizontalPixels,
          rows: current.camera.rows,
          pixelPitchUm: current.camera.pixelPitchUm,
          maxLineRateKhz: null,
        },
      }));
    }
    setInputErrors([]);
    setExportMessage("");
  };

  const calculate = () => {
    const attempted = solve2DDesign(draft);
    if (attempted.status === "incomplete") {
      setInputErrors(attempted.validationErrors);
      return;
    }
    setCommitted(cloneInput(draft));
    setInputErrors([]);
    setExportMessage("计算结果已更新，可以导出。");
  };

  const copyPng = async () => {
    try {
      const blob = await createParameterPng(parameterSections, statusCopy[result.status].label);
      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
        throw new Error("当前浏览器不支持直接复制图片，请使用“下载 PNG”。");
      }
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setExportMessage("参数表 PNG 已复制到剪贴板。");
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : "复制失败，请使用“下载 PNG”。");
    }
  };

  const downloadPng = async () => {
    try {
      const blob = await createParameterPng(parameterSections, statusCopy[result.status].label);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `光学方案参数表-${committed.camera.model.replace(/[<>:"/\\|?*]/g, "_")}.png`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setExportMessage("参数表 PNG 已下载。");
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : "PNG 下载失败。");
    }
  };

  return (
    <main className="workbench-shell">
      <header className="workbench-topbar">
        <div className="brand-lockup">
          <span className="brand-mark">OC</span>
          <div><strong>光学方案计算器</strong><small>相机模组选型工作台</small></div>
        </div>
        <div className="topbar-context"><span>二维线扫</span><strong>有限共轭 · 理论选型值</strong></div>
        <div className="topbar-status">
          {stale ? <span className="unsaved-dot">待重新计算</span> : null}
          <StatusPill status={result.status} />
        </div>
      </header>

      <div className="workbench-page">
        <div className="page-heading">
          <div><p>2D OPTICAL DESIGN</p><h1>光学方案工程表</h1></div>
          <span>浅黄色可编辑 · 浅蓝色由相机规格推导 · 结果以明确公式计算</span>
        </div>

        <nav className="mode-tabs" aria-label="光学方案类型">
          <button className={mode === "2d" ? "active" : ""} onClick={() => setMode("2d")}>
            <b>01</b><span><strong>2D 成像方案</strong><small>当前重构范围</small></span>
          </button>
          <button className={mode === "3d" ? "active" : ""} onClick={() => setMode("3d")}>
            <b>02</b><span><strong>3D 三角测量</strong><small>后续阶段</small></span>
          </button>
        </nav>

        {mode === "3d" ? (
          <section className="future-panel">
            <span>3D</span>
            <h2>三角测量方案将在独立阶段重构</h2>
            <p>后续将参考 SICK Ranger3 Setup Assistant，单独定义相机、激光器、基线、夹角、开窗和 Z 向精度，不与 2D 景深模型混用。</p>
            <button onClick={() => setMode("2d")}>返回 2D 成像方案</button>
          </section>
        ) : (
          <>
          <div className="workbench-grid">
            <section className="input-sheet">
              <SectionHeading number="01" title="相机与传感器" note="指定相机是镜头选型的前提" />
              <div className="source-switch" aria-label="相机参数来源">
                <button className={cameraSource === "catalog" ? "active" : ""} onClick={() => switchCameraSource("catalog")}>内置型号</button>
                <button className={cameraSource === "custom" ? "active" : ""} onClick={() => switchCameraSource("custom")}>自定义相机</button>
              </div>
              {cameraSource === "catalog" ? (
                <label className="camera-select">
                  <span>相机型号</span>
                  <select value={catalogCamera.model} onChange={() => undefined}>
                    <option value={catalogCamera.model}>MV-CL042-91GC · 4K 彩色线扫</option>
                  </select>
                  <small>V1 内置受控规格</small>
                </label>
              ) : (
                <TextField label="相机型号" value={draft.camera.model} note="用于方案表标识，不参与数值计算" onChange={(value) => updateCamera({ model: value })} />
              )}
              <div className="field-grid field-grid--3">
                <NumberField label="横向像素数" value={draft.camera.horizontalPixels} unit="px" readOnly={cameraSource === "catalog"} onChange={(value) => updateCamera({ horizontalPixels: value ?? 0 })} />
                <NumberField label="行数" value={draft.camera.rows} unit="行" readOnly={cameraSource === "catalog"} onChange={(value) => updateCamera({ rows: value ?? 0 })} />
                <NumberField label="像元尺寸" value={draft.camera.pixelPitchUm} unit="μm" readOnly={cameraSource === "catalog"} onChange={(value) => updateCamera({ pixelPitchUm: value ?? 0 })} />
              </div>
              <div className="derived-strip">
                <span><small>传感器宽度</small><strong>{format(draftSensorWidth, 3)} mm</strong></span>
                <span><small>相机类型</small><strong>{draft.camera.sensorType ?? "未填写"}</strong></span>
                <span><small>数据接口</small><strong>{draft.camera.dataInterface ?? "未填写"}</strong></span>
                <span><small>镜头接口</small><strong>{draft.camera.lensMount ?? "未填写"}</strong></span>
              </div>
              {cameraSource === "custom" ? (
                <div className="field-grid field-grid--3 custom-text-fields">
                  <TextField label="相机类型" value={draft.camera.sensorType ?? ""} onChange={(value) => updateCamera({ sensorType: value || undefined })} />
                  <TextField label="数据接口" value={draft.camera.dataInterface ?? ""} onChange={(value) => updateCamera({ dataInterface: value || undefined })} />
                  <TextField label="镜头接口" value={draft.camera.lensMount ?? ""} onChange={(value) => updateCamera({ lensMount: value || undefined })} />
                </div>
              ) : null}
              <NumberField label="设计最高行频" value={draft.camera.maxLineRateKhz} unit="kHz" optional readOnly={cameraSource === "catalog"} note="缺省时运动采样结果为“无法判定”" onChange={(value) => updateCamera({ maxLineRateKhz: value })} />

              <div className="sheet-divider" />
              <SectionHeading number="02" title="三个工作面与硬约束" note="距离统一以物方主平面为基准" />
              <div className="plane-grid">
                <div className="plane-card plane-card--near">
                  <h3>近端工作面</h3>
                  <NumberField label="物距" value={draft.near.distanceMm} unit="mm" onChange={(value) => updateNear({ distanceMm: value ?? 0 })} />
                  <NumberField label="原始视场需求" value={draft.near.requiredFovMm} unit="mm" onChange={(value) => updateNear({ requiredFovMm: value ?? 0 })} />
                </div>
                <div className="plane-card plane-card--focus">
                  <h3>对焦面</h3>
                  <NumberField label="对焦距离" value={draft.focusDistanceMm} unit="mm" optional note="留空时自动计算" onChange={(value) => updateRoot({ focusDistanceMm: value })} />
                  <p><strong>空值自动平衡景深</strong><br />采用近、远端弥散圆要求相等的精确解，不是简单取中点。</p>
                </div>
                <div className="plane-card plane-card--far">
                  <h3>远端工作面</h3>
                  <NumberField label="物距" value={draft.far.distanceMm} unit="mm" onChange={(value) => updateFar({ distanceMm: value ?? 0 })} />
                  <NumberField label="原始视场需求" value={draft.far.requiredFovMm} unit="mm" onChange={(value) => updateFar({ requiredFovMm: value ?? 0 })} />
                </div>
              </div>
              <div className="field-grid field-grid--3">
                <NumberField label="全局视场设计余量" value={draft.fovMarginPercent} unit="%" note="同时作用于近端和远端；不属于光学公式" onChange={(value) => updateRoot({ fovMarginPercent: value ?? 0 })} />
                <NumberField label="最大允许物方像素当量" value={draft.maxObjectPixelMm} unit="mm/px" optional note="作为焦距筛选的硬约束" onChange={(value) => updateRoot({ maxObjectPixelMm: value })} />
                <NumberField label="最大允许 F 值" value={draft.maximumFNumber} unit="F 值" optional note="默认 F/11；再大的 F 值表示光圈更小" onChange={(value) => updateRoot({ maximumFNumber: value })} />
              </div>

              <div className="sheet-divider" />
              <SectionHeading
                number="03"
                title="运动方向采样"
                note="可选：校核固定相机的设计最高行频"
                aside={<label className="motion-toggle"><input type="checkbox" checked={draft.motion?.enabled ?? false} onChange={(event) => updateMotion({ enabled: event.target.checked })} /><span />启用</label>}
              />
              {draft.motion?.enabled ? (
                <div className="field-grid field-grid--2">
                  <NumberField label="最大运行速度" value={draft.motion.maximumSpeedKmh} unit="km/h" onChange={(value) => updateMotion({ maximumSpeedKmh: value })} />
                  <NumberField label="目标纵向采样" value={draft.motion.longitudinalSampleMm} unit="mm/line" onChange={(value) => updateMotion({ longitudinalSampleMm: value })} />
                </div>
              ) : <div className="optional-empty">未启用，不参与方案状态判定。</div>}

              {inputErrors.length > 0 ? (
                <div className="validation-box"><strong>请修正以下输入</strong><ul>{inputErrors.map((error) => <li key={error}>{error}</li>)}</ul></div>
              ) : null}

              <button className="calculate-button" onClick={calculate}>
                <span>计算并推荐焦距</span>
                <small>校核视场、分辨率、景深与运动采样</small>
              </button>
            </section>

            <aside className="result-column">
              <ResultSummary result={result} stale={stale} />
              <FovCone candidate={result.recommended} />
              <div className="assumption-card">
                <strong>本次计算口径</strong>
                <div><span>{result.assumptions.opticalModel}</span><span>弥散圆 = 2 × 像元</span><span>{result.assumptions.focusMethod}</span><span>{result.assumptions.diffractionReference}</span></div>
                <p>具体镜头主平面、畸变、MTF 与装调误差需在型号确定后复核。</p>
              </div>
            </aside>
          </div>
          <CandidateTable result={result} stale={stale} />
          <ParameterSheet
            sections={parameterSections}
            stale={stale}
            canExport={canExport}
            exportMessage={exportMessage}
            onCopy={copyPng}
            onDownload={downloadPng}
            onPrint={() => window.print()}
          />
          </>
        )}
      </div>
    </main>
  );
}

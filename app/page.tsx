"use client";

import { useMemo, useState } from "react";

type Mode = "2d" | "3d";
type Range = [number, number];

type Camera2D = {
  model: string;
  label: string;
  pixels: number;
  rows: number;
  pixelSizeUm: number;
  source: string;
};

type LensPreset = {
  id: string;
  scene: string;
  focalLength: number;
  viewAngle: number;
  detectionRange: Range;
  sourcePixels: number;
  sourceFov?: Range;
  sourceResolution: Range;
  note: string;
};

type SickCamera = {
  model: string;
  pixelsX: number;
  pixelsY: number;
  sensorWidthMm: number;
  sensorHeightMm: number;
};

const cameras2D: Camera2D[] = [
  {
    model: "MV-CL042-91GC",
    label: "MV-CL042-91GC · 4K 网口线阵 / 彩色",
    pixels: 4096,
    rows: 2,
    pixelSizeUm: 7,
    source: "方案文档 3-1 采集模组与相机规格图",
  },
];

const lensPresets: LensPreset[] = [
  {
    id: "track-bottom",
    scene: "轨内-底中 / 轨外-底部",
    focalLength: 18,
    viewAngle: 77,
    detectionRange: [685, 1650],
    sourcePixels: 4096,
    sourceFov: [1011, 2389],
    sourceResolution: [0.247, 0.583],
    note: "方案表给出视场 1011–2389 mm",
  },
  {
    id: "side-bogie",
    scene: "车侧-走行部",
    focalLength: 35,
    viewAngle: 44,
    detectionRange: [1100, 1450],
    sourcePixels: 4096,
    sourceResolution: [0.22, 0.29],
    note: "方案表检测精度 0.220–0.290 mm",
  },
  {
    id: "upper-bogie",
    scene: "走行部上侧到车窗下侧",
    focalLength: 25,
    viewAngle: 59,
    detectionRange: [900, 1400],
    sourcePixels: 4096,
    sourceResolution: [0.246, 0.387],
    note: "方案表检测精度 0.246–0.387 mm",
  },
  {
    id: "window",
    scene: "车窗",
    focalLength: 8,
    viewAngle: 83,
    detectionRange: [900, 1600],
    sourcePixels: 2048,
    sourceResolution: [0.785, 1.401],
    note: "方案表按 2048 有效列记录",
  },
  {
    id: "roof",
    scene: "车顶",
    focalLength: 60,
    viewAngle: 26,
    detectionRange: [2300, 2700],
    sourcePixels: 4096,
    sourceFov: [1060, 1240],
    sourceResolution: [0.26, 0.305],
    note: "方案表给出视场 1060–1240 mm",
  },
];

const sickCameras: SickCamera[] = [
  {
    model: "Ranger3-60",
    pixelsX: 2560,
    pixelsY: 832,
    sensorWidthMm: 15.36,
    sensorHeightMm: 4.992,
  },
  {
    model: "Ranger3-40",
    pixelsX: 2560,
    pixelsY: 832,
    sensorWidthMm: 15.36,
    sensorHeightMm: 4.992,
  },
  {
    model: "Ranger3-30",
    pixelsX: 1536,
    pixelsY: 832,
    sensorWidthMm: 9.216,
    sensorHeightMm: 4.992,
  },
];

const sickFocalLengths = [8, 12.5, 16, 25, 35, 50, 100];

function radians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function formatNumber(value: number, digits = 3) {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("zh-CN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

function formatRange(range: Range, digits = 0) {
  return `${formatNumber(range[0], digits)}–${formatNumber(range[1], digits)}`;
}

function positive(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegative(value: number, fallback: number) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function matchLenses(near: number, far: number) {
  const target: Range = [Math.min(near, far), Math.max(near, far)];
  const targetCenter = (target[0] + target[1]) / 2;
  const targetSpan = Math.max(target[1] - target[0], 1);

  return lensPresets
    .map((preset) => {
      const presetCenter =
        (preset.detectionRange[0] + preset.detectionRange[1]) / 2;
      const presetSpan = Math.max(
        preset.detectionRange[1] - preset.detectionRange[0],
        1,
      );
      const scale = Math.max(targetSpan, presetSpan);
      const overlap = Math.max(
        0,
        Math.min(target[1], preset.detectionRange[1]) -
          Math.max(target[0], preset.detectionRange[0]),
      );
      const gapPenalty = overlap > 0 ? 0 : targetSpan / scale;
      const distance =
        Math.abs(targetCenter - presetCenter) / scale * 0.58 +
        Math.abs(targetSpan - presetSpan) / scale * 0.3 +
        gapPenalty * 0.12;
      const confidence = Math.max(0, Math.min(99, Math.round(100 / (1 + distance))));
      return { preset, distance, confidence };
    })
    .sort((a, b) => a.distance - b.distance);
}

function calculate2D(
  camera: Camera2D,
  preset: LensPreset,
  near: number,
  far: number,
  pixelBasis: "source" | "native",
  cocMultiplier: number,
) {
  const focalLength = preset.focalLength;
  const distances: Range = [Math.min(near, far), Math.max(near, far)];
  const pixels = pixelBasis === "source" ? preset.sourcePixels : camera.pixels;
  const pixelSizeMm = camera.pixelSizeUm / 1000;
  const sensorWidthMm = pixelSizeMm * pixels;
  const cocMm = pixelSizeMm * cocMultiplier;
  const viewAngle = (2 * Math.atan(sensorWidthMm / (2 * focalLength)) * 180) / Math.PI;

  const atDistance = (distance: number) => {
    const projectedPixel = (pixelSizeMm * Math.max(distance - focalLength, 1)) / focalLength;
    const projectedFov = projectedPixel * pixels;
    const effectiveResolution =
      ((pixelSizeMm + cocMm) * Math.max(distance - focalLength, 1)) / focalLength;
    return {
      distance,
      projectedPixel,
      projectedFov,
      effectiveResolution,
    };
  };

  return {
    pixels,
    pixelSizeMm,
    sensorWidthMm,
    cocMm,
    viewAngle,
    near: atDistance(distances[0]),
    far: atDistance(distances[1]),
  };
}

function calculate3D(
  camera: SickCamera,
  focalLength: number,
  workingDistance: number,
  baseDistance: number,
  cameraAngle: number,
  laserAngle: number,
  fanAngle: number,
) {
  const fovWidth = (camera.sensorWidthMm * workingDistance) / focalLength;
  const fovHeight = (camera.sensorHeightMm * workingDistance) / focalLength;
  const pixelPitchUm = (camera.sensorWidthMm / camera.pixelsX) * 1000;
  const dx = fovWidth / camera.pixelsX;
  const depthDenominator = Math.sin(radians(cameraAngle + laserAngle));
  const dz =
    Math.abs(depthDenominator) > 0.0001
      ? (dx * Math.cos(radians(laserAngle))) / Math.abs(depthDenominator)
      : Number.POSITIVE_INFINITY;
  const laserWidth = 2 * workingDistance * Math.tan(radians(fanAngle / 2));
  const usefulWidth = Math.min(fovWidth, laserWidth);
  const gamma = 90 - cameraAngle;
  const intersectionDistance =
    Math.abs(Math.sin(radians(gamma))) > 0.0001
      ? baseDistance / Math.sin(radians(gamma))
      : Number.POSITIVE_INFINITY;
  const scheimpflugAngle =
    Number.isFinite(intersectionDistance) && intersectionDistance > 0
      ? (Math.atan(focalLength / intersectionDistance) * 180) / Math.PI
      : 0;

  return {
    fovWidth,
    fovHeight,
    pixelPitchUm,
    dx,
    dz,
    dz4: dz / 4,
    dz10: dz / 10,
    dz16: dz / 16,
    laserWidth,
    usefulWidth,
    scheimpflugAngle,
  };
}

function Metric({ label, value, unit, accent = "" }: { label: string; value: string; unit?: string; accent?: string }) {
  return (
    <div className={`metric-card ${accent}`}>
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      {unit ? <span className="metric-unit">{unit}</span> : null}
    </div>
  );
}

function NumberField({
  label,
  value,
  unit,
  step = 1,
  min = 0,
  onChange,
  helper,
}: {
  label: string;
  value: number;
  unit: string;
  step?: number;
  min?: number;
  onChange: (value: number) => void;
  helper?: string;
}) {
  return (
    <label className="input-field">
      <span className="field-label">{label}</span>
      <span className="input-wrap">
        <input
          type="number"
          min={min}
          step={step}
          value={Number.isFinite(value) ? value : ""}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span>{unit}</span>
      </span>
      {helper ? <small>{helper}</small> : null}
    </label>
  );
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("2d");
  const [cameraModel, setCameraModel] = useState(cameras2D[0].model);
  const [nearDistance, setNearDistance] = useState(685);
  const [farDistance, setFarDistance] = useState(1650);
  const [pixelBasis, setPixelBasis] = useState<"source" | "native">("source");
  const [cocMultiplier, setCocMultiplier] = useState(2);

  const [sickModel, setSickModel] = useState(sickCameras[0].model);
  const [sickFocalLength, setSickFocalLength] = useState(25);
  const [workingDistance, setWorkingDistance] = useState(1400);
  const [baseDistance, setBaseDistance] = useState(200);
  const [cameraAngle, setCameraAngle] = useState(30);
  const [laserAngle, setLaserAngle] = useState(0);
  const [fanAngle, setFanAngle] = useState(60);

  const activeCamera2D = cameras2D.find((camera) => camera.model === cameraModel) ?? cameras2D[0];
  const matches = useMemo(
    () => matchLenses(positive(nearDistance, 685), positive(farDistance, 1650)),
    [nearDistance, farDistance],
  );
  const bestMatch = matches[0];
  const result2D = useMemo(
    () =>
      calculate2D(
        activeCamera2D,
        bestMatch.preset,
        positive(nearDistance, 685),
        positive(farDistance, 1650),
        pixelBasis,
        nonNegative(cocMultiplier, 2),
      ),
    [activeCamera2D, bestMatch.preset, nearDistance, farDistance, pixelBasis, cocMultiplier],
  );
  const activeSickCamera = sickCameras.find((camera) => camera.model === sickModel) ?? sickCameras[0];
  const result3D = useMemo(
    () =>
      calculate3D(
        activeSickCamera,
        positive(sickFocalLength, 25),
        positive(workingDistance, 1400),
        positive(baseDistance, 200),
        cameraAngle,
        laserAngle,
        positive(fanAngle, 60),
      ),
    [activeSickCamera, sickFocalLength, workingDistance, baseDistance, cameraAngle, laserAngle, fanAngle],
  );

  const sourceFov: Range = bestMatch.preset.sourceFov ?? [
    bestMatch.preset.sourceResolution[0] * bestMatch.preset.sourcePixels,
    bestMatch.preset.sourceResolution[1] * bestMatch.preset.sourcePixels,
  ];
  const effectiveDepthResolution = Number.isFinite(result3D.dz);

  return (
    <main className="site-frame">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
          <div>
            <div className="brand-name">OPTICAL LAB</div>
            <div className="brand-subtitle">宁波 5 号线 · 360 检测方案</div>
          </div>
        </div>
        <div className="topbar-status"><span className="status-dot" />方案参数已载入 <span className="status-divider" /> V2</div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">OPTICAL SOLUTION WORKBENCH / 01</p>
          <h1>把检测范围，变成<br /><em>可落地的镜头参数。</em></h1>
          <p className="hero-copy">输入相机与检测距离，快速得到视场、视场角、焦距和分辨率。2D 参考宁波 5 号线方案，3D 参考 SICK Ranger3 Setup Assistant 的计算口径。</p>
        </div>
        <div className="hero-note">
          <span className="note-index">CALC</span>
          <strong>理论值优先</strong>
          <p>默认弥散圆 = 2 × 像元大小，结果同时保留不含弥散圆的像元采样值。</p>
        </div>
      </section>

      <nav className="mode-switch" aria-label="计算模式">
        <button className={mode === "2d" ? "active" : ""} onClick={() => setMode("2d")} role="tab" aria-selected={mode === "2d"}>
          <span className="tab-index">02D</span><span>2D 线阵相机</span><small>视场 / 像素分辨率</small>
        </button>
        <button className={mode === "3d" ? "active" : ""} onClick={() => setMode("3d")} role="tab" aria-selected={mode === "3d"}>
          <span className="tab-index">03D</span><span>3D 三角测量</span><small>SICK Ranger3 口径</small>
        </button>
      </nav>

      <div className="workspace-grid">
        <aside className="control-panel">
          {mode === "2d" ? (
            <>
              <div className="panel-heading"><div><span className="section-kicker">INPUT / 2D CAMERA</span><h2>采集模组参数</h2></div><span className="panel-number">01</span></div>
              <label className="select-field">
                <span className="field-label">2D 相机型号</span>
                <select value={cameraModel} onChange={(event) => setCameraModel(event.target.value)}>
                  {cameras2D.map((camera) => <option key={camera.model} value={camera.model}>{camera.label}</option>)}
                </select>
                <small>{activeCamera2D.source}</small>
              </label>
              <div className="mini-spec-grid">
                <Metric label="有效像素" value={`${activeCamera2D.pixels}`} unit={`× ${activeCamera2D.rows}`} />
                <Metric label="像元大小" value={`${activeCamera2D.pixelSizeUm}`} unit="μm" accent="lime" />
                <Metric label="传感器宽度" value={formatNumber((activeCamera2D.pixels * activeCamera2D.pixelSizeUm) / 1000, 3)} unit="mm" />
              </div>
              <div className="form-section">
                <div className="form-section-title"><span>检测范围</span><small>输入近端 / 远端物距</small></div>
                <div className="two-col">
                  <NumberField label="近端距离" value={nearDistance} unit="mm" min={1} onChange={setNearDistance} />
                  <NumberField label="远端距离" value={farDistance} unit="mm" min={1} onChange={setFarDistance} />
                </div>
              </div>
              <div className="form-section">
                <div className="form-section-title"><span>计算口径</span><small>可切换有效列数</small></div>
                <label className="select-field compact">
                  <span className="field-label">参与计算的像素列数</span>
                  <select value={pixelBasis} onChange={(event) => setPixelBasis(event.target.value as "source" | "native")}>
                    <option value="source">按当前方案条目（{bestMatch.preset.sourcePixels} px）</option>
                    <option value="native">按相机全宽（{activeCamera2D.pixels} px）</option>
                  </select>
                </label>
                <NumberField label="弥散圆" value={cocMultiplier} unit="× 像元" min={0} step={0.5} onChange={setCocMultiplier} helper={`当前 = ${formatNumber(result2D.cocMm * 1000, 1)} μm`} />
              </div>
              <div className="formula-note"><span className="formula-symbol">ƒ</span><div><strong>薄透镜近似</strong><p>像元采样 = 像元 × (物距 − 焦距) ÷ 焦距；含弥散圆值按“像元 + 弥散圆”计算。</p></div></div>
            </>
          ) : (
            <>
              <div className="panel-heading"><div><span className="section-kicker">INPUT / SICK 3D</span><h2>三角测量参数</h2></div><span className="panel-number">01</span></div>
              <label className="select-field">
                <span className="field-label">3D 相机型号</span>
                <select value={sickModel} onChange={(event) => setSickModel(event.target.value)}>
                  {sickCameras.map((camera) => <option key={camera.model} value={camera.model}>{camera.model}</option>)}
                </select>
                <small>参考 Ranger3 Setup Assistant 内置参数</small>
              </label>
              <div className="mini-spec-grid">
                <Metric label="分辨率" value={`${activeSickCamera.pixelsX}`} unit={`× ${activeSickCamera.pixelsY}`} />
                <Metric label="像元节距" value={formatNumber(result3D.pixelPitchUm, 2)} unit="μm" accent="cyan" />
                <Metric label="传感器尺寸" value={`${formatNumber(activeSickCamera.sensorWidthMm, 3)}`} unit={`× ${formatNumber(activeSickCamera.sensorHeightMm, 3)} mm`} />
              </div>
              <div className="form-section">
                <div className="form-section-title"><span>光学与空间</span><small>与官方工具同名参数</small></div>
                <label className="select-field compact"><span className="field-label">镜头焦距</span><select value={sickFocalLength} onChange={(event) => setSickFocalLength(Number(event.target.value))}>{sickFocalLengths.map((value) => <option key={value} value={value}>{value} mm</option>)}</select></label>
                <div className="two-col">
                  <NumberField label="工作距离" value={workingDistance} unit="mm" min={1} onChange={setWorkingDistance} />
                  <NumberField label="基线距离" value={baseDistance} unit="mm" min={1} onChange={setBaseDistance} />
                </div>
                <div className="three-col">
                  <NumberField label="相机角度" value={cameraAngle} unit="°" min={0} step={1} onChange={setCameraAngle} />
                  <NumberField label="激光角度" value={laserAngle} unit="°" min={0} step={1} onChange={setLaserAngle} />
                  <NumberField label="激光扇角" value={fanAngle} unit="°" min={1} step={1} onChange={setFanAngle} />
                </div>
              </div>
              <div className="formula-note cyan-note"><span className="formula-symbol">△</span><div><strong>SICK 工具口径</strong><p>dX = 相机视场宽 ÷ X 像素；dZ = dX × cos(激光角) ÷ sin(激光角 + 相机角)。</p></div></div>
            </>
          )}
        </aside>

        <section className="result-panel">
          {mode === "2d" ? (
            <>
              <div className="result-heading"><div><span className="section-kicker">MATCHED SOLUTION / 2D</span><h2>最接近的方案视场</h2></div><span className="confidence"><i />匹配度 {bestMatch.confidence}%</span></div>
              <div className="match-banner"><div><span className="match-label">方案库最接近</span><h3>{bestMatch.preset.scene}</h3><p>检测范围 {formatRange(bestMatch.preset.detectionRange)} mm · {bestMatch.preset.note}</p></div><div className="lens-badge"><span>推荐焦距</span><strong>{bestMatch.preset.focalLength}<small> mm</small></strong></div></div>
              <div className="result-metric-grid">
                <Metric label="视场角（理论）" value={formatNumber(result2D.viewAngle, 1)} unit="°" accent="lime" />
                <Metric label="近端理论视场" value={formatNumber(result2D.near.projectedFov, 1)} unit="mm" />
                <Metric label="远端理论视场" value={formatNumber(result2D.far.projectedFov, 1)} unit="mm" />
                <Metric label="有效传感器宽" value={formatNumber(result2D.sensorWidthMm, 3)} unit="mm" />
              </div>
              <div className="resolution-card">
                <div className="card-title-row"><div><span className="section-kicker">RESOLUTION / MM PER PIXEL</span><h3>近端 / 远端理论像素分辨率</h3></div><span className="coc-pill">弥散圆 {formatNumber(result2D.cocMm * 1000, 1)} μm</span></div>
                <div className="resolution-columns">
                  <div className="resolution-item near"><span>近端 · {formatNumber(result2D.near.distance, 0)} mm</span><strong>{formatNumber(result2D.near.projectedPixel, 3)}</strong><small>像元采样 mm/pixel</small><div className="bar"><i style={{ width: `${Math.min(100, result2D.near.projectedPixel / Math.max(result2D.far.effectiveResolution, 0.001) * 100)}%` }} /></div><p>含弥散圆 <b>{formatNumber(result2D.near.effectiveResolution, 3)}</b> mm/pixel</p></div>
                  <div className="resolution-item far"><span>远端 · {formatNumber(result2D.far.distance, 0)} mm</span><strong>{formatNumber(result2D.far.projectedPixel, 3)}</strong><small>像元采样 mm/pixel</small><div className="bar"><i style={{ width: "100%" }} /></div><p>含弥散圆 <b>{formatNumber(result2D.far.effectiveResolution, 3)}</b> mm/pixel</p></div>
                </div>
                <div className="resolution-footnote"><span>读法</span>上方大字是未计弥散圆的像元采样值；下方加粗值为默认弥散圆 = {formatNumber(cocMultiplier, 1)} × 像元后的保守理论分辨率。</div>
              </div>
              <div className="compare-card"><div className="card-title-row"><div><span className="section-kicker">SOURCE CHECK</span><h3>方案表与理论值对照</h3></div><span className="source-chip">Word / 3-1</span></div><div className="compare-grid"><div><span>方案表记录视场</span><strong>{formatRange(sourceFov, 0)} <small>mm</small></strong></div><div><span>本页理论视场</span><strong>{formatRange([result2D.near.projectedFov, result2D.far.projectedFov], 0)} <small>mm</small></strong></div><div><span>方案表精度</span><strong>{formatRange(bestMatch.preset.sourceResolution, 3)} <small>mm/pixel</small></strong></div><div><span>本页像元采样</span><strong>{formatRange([result2D.near.projectedPixel, result2D.far.projectedPixel], 3)} <small>mm/pixel</small></strong></div></div></div>
              <div className="candidate-card"><div className="card-title-row"><div><span className="section-kicker">CANDIDATES / RANGE MATCH</span><h3>检测范围匹配清单</h3></div><span className="muted-label">按范围中心与跨度排序</span></div><div className="candidate-table"><div className="table-row table-head"><span>位置</span><span>焦距</span><span>视场角</span><span>检测范围</span><span>有效列</span></div>{matches.map(({ preset, confidence }) => <div className={`table-row ${preset.id === bestMatch.preset.id ? "selected" : ""}`} key={preset.id}><span><b>{preset.scene}</b>{preset.id === bestMatch.preset.id ? <em>当前</em> : null}</span><span>{preset.focalLength} mm</span><span>{preset.viewAngle}°</span><span>{formatRange(preset.detectionRange)} mm</span><span>{preset.sourcePixels} px <small>{confidence}%</small></span></div>)}</div></div>
            </>
          ) : (
            <>
              <div className="result-heading"><div><span className="section-kicker">SICK METHOD / RANGER3</span><h2>三角测量分辨率</h2></div><span className="confidence cyan-confidence"><i />公式已对齐</span></div>
              <div className="match-banner cyan-banner"><div><span className="match-label">当前配置</span><h3>{activeSickCamera.model} · {sickFocalLength} mm</h3><p>工作距离 {formatNumber(workingDistance, 0)} mm · 基线 {formatNumber(baseDistance, 0)} mm · 激光扇角 {formatNumber(fanAngle, 0)}°</p></div><div className="lens-badge cyan-badge"><span>建议 Scheimpflug</span><strong>{formatNumber(result3D.scheimpflugAngle, 2)}<small>°</small></strong></div></div>
              <div className="result-metric-grid"><Metric label="相机横向视场" value={formatNumber(result3D.fovWidth, 1)} unit="mm" accent="cyan" /><Metric label="相机纵向视场" value={formatNumber(result3D.fovHeight, 1)} unit="mm" /><Metric label="激光覆盖宽度" value={formatNumber(result3D.laserWidth, 1)} unit="mm" /><Metric label="有效覆盖宽度" value={formatNumber(result3D.usefulWidth, 1)} unit="mm" /></div>
              <div className="resolution-card cyan-card"><div className="card-title-row"><div><span className="section-kicker">DEPTH RESOLUTION / D Z</span><h3>横向与深度分辨率</h3></div><span className="coc-pill cyan-pill">像元 {formatNumber(result3D.pixelPitchUm, 2)} μm</span></div><div className="three-result-grid"><div><span>横向 dX</span><strong>{formatNumber(result3D.dx, 3)}</strong><small>mm / pixel</small></div><div><span>深度 dZ · raw</span><strong>{effectiveDepthResolution ? formatNumber(result3D.dz, 3) : "—"}</strong><small>mm / pixel</small></div><div><span>深度 dZ · 1/4</span><strong>{effectiveDepthResolution ? formatNumber(result3D.dz4, 3) : "—"}</strong><small>mm / pixel</small></div><div><span>深度 dZ · 1/10</span><strong>{effectiveDepthResolution ? formatNumber(result3D.dz10, 3) : "—"}</strong><small>mm / pixel</small></div><div><span>深度 dZ · 1/16</span><strong>{effectiveDepthResolution ? formatNumber(result3D.dz16, 3) : "—"}</strong><small>mm / pixel</small></div></div><div className="resolution-footnote"><span>工具口径</span>dZ 仅在“激光角 + 相机角”不为 0° 时可定义；当前结果按官方工具中的 raw、1/4、1/10、1/16 亚像素比例列出。</div></div>
              <div className="compare-card"><div className="card-title-row"><div><span className="section-kicker">GEOMETRY CHECK</span><h3>三角测量几何量</h3></div><span className="source-chip cyan-source">Ranger3 Tool</span></div><div className="compare-grid"><div><span>传感器尺寸</span><strong>{formatNumber(activeSickCamera.sensorWidthMm, 3)} × {formatNumber(activeSickCamera.sensorHeightMm, 3)} <small>mm</small></strong></div><div><span>相机视场角（横向）</span><strong>{formatNumber((2 * Math.atan(activeSickCamera.sensorWidthMm / (2 * sickFocalLength)) * 180) / Math.PI, 2)} <small>°</small></strong></div><div><span>激光角 / 相机角</span><strong>{formatNumber(laserAngle, 0)}° / {formatNumber(cameraAngle, 0)}°</strong></div><div><span>基线 / 交汇距离</span><strong>{formatNumber(baseDistance, 0)} / {formatNumber(baseDistance / Math.max(Math.sin(radians(90 - cameraAngle)), 0.0001), 1)} <small>mm</small></strong></div></div></div>
              <div className="candidate-card method-card"><div className="card-title-row"><div><span className="section-kicker">METHOD NOTE</span><h3>与官方工具的边界</h3></div></div><div className="method-copy"><div className="method-mark">S3</div><p>本页复用了 Ranger3 Setup Assistant 中的相机传感器尺寸、镜头视场角、横向分辨率 dX、深度分辨率 dZ 与 Scheimpflug 角公式。设备安装后的完整 FOV 裁剪、激光线与相机 FOV 取最小值、姿态旋转仍建议回到官方工具或现场标定复核。</p></div></div>
            </>
          )}
        </section>
      </div>

      <footer className="site-footer"><span>OPTICAL LAB / 宁波 5 号线 360 检测</span><span>理论计算 · 结果需结合镜头实测与标定确认</span></footer>
    </main>
  );
}

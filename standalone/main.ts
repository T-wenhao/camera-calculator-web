import {
  solve2DDesign,
  type SchemeStatus,
  type TwoDDesignInput,
} from "../lib/optics/solve-2d-design";
import { buildFovConeGeometry } from "../lib/optics/fov-cone-geometry";

type ParameterSection = { title: string; rows: Array<{ label: string; value: string }> };

const statusLabels: Record<SchemeStatus, string> = {
  incomplete: "待完善输入",
  feasible: "存在可行方案",
  review: "可行但需复核",
  none: "无可行方案",
};

function element<T extends HTMLElement>(id: string) {
  const found = document.getElementById(id);
  if (!found) throw new Error(`缺少页面元素：${id}`);
  return found as T;
}

function numericValue(id: string, optional = false) {
  const raw = element<HTMLInputElement>(id).value.trim();
  if (optional && raw === "") return null;
  return Number(raw);
}

function format(value: number | null | undefined, digits = 1) {
  if (value == null || Number.isNaN(value)) return "—";
  if (value === Number.POSITIVE_INFINITY) return "∞";
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
  })[character] ?? character);
}

function focalRangeText(range: ReturnType<typeof solve2DDesign>["focalRangeMm"], digits = 1) {
  if (range.minimum != null && range.maximum != null && range.minimum > range.maximum) return "无连续可行区间";
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

function readInput(): TwoDDesignInput {
  const custom = element<HTMLSelectElement>("camera-source").value === "custom";
  return {
    camera: {
      model: element<HTMLInputElement>("camera-model").value.trim(),
      horizontalPixels: numericValue("pixels") ?? 0,
      rows: numericValue("rows") ?? 0,
      pixelPitchUm: numericValue("pitch") ?? 0,
      maxLineRateKhz: numericValue("line-rate", true),
      sensorType: custom ? undefined : "彩色线扫",
      dataInterface: custom ? undefined : "GigE",
      lensMount: custom ? undefined : "M42",
    },
    near: {
      distanceMm: numericValue("near-distance") ?? 0,
      requiredFovMm: numericValue("near-fov") ?? 0,
    },
    focusDistanceMm: numericValue("focus-distance", true),
    far: {
      distanceMm: numericValue("far-distance") ?? 0,
      requiredFovMm: numericValue("far-fov") ?? 0,
    },
    fovMarginPercent: numericValue("margin") ?? 0,
    maxObjectPixelMm: numericValue("max-resolution", true),
    maximumFNumber: numericValue("max-f-number", true),
    motion: {
      enabled: element<HTMLInputElement>("motion-enabled").checked,
      maximumSpeedKmh: numericValue("speed", true),
      longitudinalSampleMm: numericValue("sample", true),
    },
  };
}

function motionLabel(status: ReturnType<typeof solve2DDesign>["motion"]["status"]) {
  return { "not-requested": "未启用", pass: "满足", fail: "不满足", unknown: "无法判定" }[status];
}

function buildSections(input: TwoDDesignInput, result: ReturnType<typeof solve2DDesign>): ParameterSection[] {
  const recommendation = result.recommended;
  const marginFactor = 1 + input.fovMarginPercent / 100;
  return [
    { title: "相机参数", rows: [
      { label: "相机型号", value: input.camera.model },
      { label: "相机分辨率", value: `${format(input.camera.horizontalPixels, 0)} × ${format(input.camera.rows, 0)}` },
      { label: "像元尺寸", value: `${format(input.camera.pixelPitchUm, 2)} μm` },
      { label: "传感器宽度", value: `${format(result.sensorWidthMm, 3)} mm` },
      { label: "设计最高行频", value: input.camera.maxLineRateKhz == null ? "未提供" : `${format(input.camera.maxLineRateKhz, 2)} kHz` },
      { label: "数值标识", value: "理论选型值" },
    ] },
    { title: "设计输入", rows: [
      { label: "目标工作区间", value: `${format(input.near.distanceMm, 0)}–${format(input.far.distanceMm, 0)} mm` },
      { label: "对焦位置", value: `${format(result.resolvedFocusDistanceMm, 0)} mm（${result.focusMode === "automatic" ? "自动平衡近远端" : "手动指定"}）` },
      { label: "近端视场需求", value: `${format(input.near.requiredFovMm, 0)} → ${format(input.near.requiredFovMm * marginFactor, 0)} mm` },
      { label: "远端视场需求", value: `${format(input.far.requiredFovMm, 0)} → ${format(input.far.requiredFovMm * marginFactor, 0)} mm` },
      { label: "视场余量 / 最大像素当量", value: `${format(input.fovMarginPercent, 1)} % / ${input.maxObjectPixelMm == null ? "未约束" : `${format(input.maxObjectPixelMm, 3)} mm/px`}` },
      { label: "最大允许 F 值", value: input.maximumFNumber == null ? "未约束" : `F/${format(input.maximumFNumber, 1)}` },
    ] },
    { title: "光学选型与计算结果", rows: [
      { label: "连续焦距可行区间", value: focalRangeText(result.focalRangeMm, 2) },
      { label: "推荐标准焦距", value: recommendation ? `${format(recommendation.focalLengthMm, 1)} mm` : "无（详见候选表）" },
      { label: "景深最低 / 建议工作光圈", value: recommendation ? `≥ F/${format(recommendation.requiredFNumber, 2)} / F/${format(recommendation.operatingFNumber, 2)}` : "—" },
      { label: "理论景深范围（工作光圈，2×像元）", value: recommendation ? `${format(recommendation.designDofNearMm, 0)}–${format(recommendation.designDofFarMm, 0)} mm` : "—" },
      { label: "参考景深范围（3×像元）", value: recommendation ? `${format(recommendation.referenceDofNearMm, 0)}–${format(recommendation.referenceDofFarMm, 0)} mm` : "—" },
      { label: "近 / 对焦 / 远像素当量", value: recommendation ? `${format(recommendation.near.objectPixelMm, 3)} / ${format(recommendation.focus.objectPixelMm, 3)} / ${format(recommendation.far.objectPixelMm, 3)} mm/px` : "—" },
    ] },
    { title: "运动采样与提示", rows: [
      { label: "最大运行速度", value: input.motion?.enabled ? `${format(input.motion.maximumSpeedKmh, 1)} km/h` : "未启用" },
      { label: "目标纵向采样", value: input.motion?.enabled ? `${format(input.motion.longitudinalSampleMm, 3)} mm/line` : "未启用" },
      { label: "所需行频", value: result.motion.requiredLineRateKhz == null ? "—" : `${format(result.motion.requiredLineRateKhz, 3)} kHz` },
      { label: "理论行周期", value: result.motion.theoreticalLinePeriodUs == null ? "—" : `${format(result.motion.theoreticalLinePeriodUs, 2)} μs` },
      { label: "方案状态", value: statusLabels[result.status] },
      { label: "复核提示", value: recommendation?.diffractionReview ? "衍射、具体镜头主平面与 MTF" : "具体镜头主平面与 MTF" },
    ] },
  ];
}

function renderStatus(target: HTMLElement, status: SchemeStatus) {
  target.textContent = statusLabels[status];
  target.className = `standalone-status scheme-status--${status}`;
}

function renderCone(result: ReturnType<typeof solve2DDesign>) {
  const recommendation = result.recommended;
  const ids = ["cone-near", "cone-focus", "cone-far"];
  const labels = ["近端", "对焦", "远端"];
  const stage = element<HTMLDivElement>("cone-stage");
  const legend = element<HTMLDivElement>("cone-legend");
  const empty = element<HTMLDivElement>("cone-no-result");
  if (!recommendation) {
    stage.hidden = true;
    legend.hidden = true;
    empty.hidden = false;
    element("cone-angle").textContent = "物方主平面基准";
    ids.forEach((id) => { element(id).hidden = true; });
    return;
  }
  stage.hidden = false;
  legend.hidden = false;
  empty.hidden = true;
  const planes = [recommendation.near, recommendation.focus, recommendation.far];
  const geometry = buildFovConeGeometry(planes);
  stage.style.setProperty("--cone-origin-x", `${geometry.originXPercent}%`);
  stage.style.setProperty("--cone-axis-y", `${geometry.axisYPercent}%`);
  stage.style.setProperty("--cone-far-x", `${geometry.farXPercent}%`);
  stage.style.setProperty("--cone-far-half", `${geometry.farHalfHeightPercent}%`);
  stage.style.setProperty("--cone-ray-length", `${geometry.rayLengthPercent}%`);
  stage.style.setProperty("--cone-ray-angle", `${geometry.rayAngleDeg}deg`);
  stage.style.setProperty("--cone-ray-angle-negative", `${-geometry.rayAngleDeg}deg`);
  element("cone-angle").textContent = `水平全视场角 ${format(geometry.fullViewAngleDeg, 1)}° · 物方主平面基准`;
  geometry.planes.forEach((plane, index) => {
    const target = element<HTMLDivElement>(ids[index]);
    target.hidden = false;
    target.style.setProperty("--plane-left", `${plane.leftPercent}%`);
    target.style.setProperty("--plane-height", `${plane.heightPercent}%`);
    target.title = `${labels[index]}：${format(plane.distanceMm, 0)} mm，FOV ${format(plane.actualFovMm, 0)} mm`;
    element(`cone-legend-${index + 1}-distance`).textContent = `${labels[index]} · ${format(plane.distanceMm, 0)} mm`;
    element(`cone-legend-${index + 1}-fov`).textContent = `FOV ${format(plane.actualFovMm, 0)} mm`;
  });
}

function renderCandidates(result: ReturnType<typeof solve2DDesign>) {
  const recommended = result.recommended?.focalLengthMm;
  element("candidate-count").textContent = `${result.candidates.filter((candidate) => candidate.feasible).length} / ${result.candidates.length} 可行`;
  element("candidate-body").innerHTML = result.candidates.map((candidate) => {
    const selected = candidate.focalLengthMm === recommended;
    const state = candidate.feasible ? (candidate.diffractionReview ? "review" : "pass") : "fail";
    const stateText = candidate.feasible ? (candidate.diffractionReview ? "需复核" : "可行") : "不满足";
    return `<tr class="${selected ? "recommended" : ""}"><td><strong>${format(candidate.focalLengthMm, 1)} mm</strong>${selected ? "<em>推荐</em>" : ""}</td><td>${format(candidate.near.actualFovMm, 0)} / ${format(candidate.near.requiredFovWithMarginMm, 0)} mm</td><td>${format(candidate.far.actualFovMm, 0)} / ${format(candidate.far.requiredFovWithMarginMm, 0)} mm</td><td>${format(candidate.far.objectPixelMm, 3)} mm/px</td><td>≥ F/${format(candidate.requiredFNumber, 1)}<small>设定 F/${format(candidate.operatingFNumber, 1)}</small></td><td><span class="candidate-status ${state}">${stateText}</span><small>${escapeHtml(candidate.reasons.join("；"))}</small></td></tr>`;
  }).join("");
}

function renderParameters(sections: ParameterSection[]) {
  element("parameter-grid").innerHTML = sections.map((section) => `<div class="parameter-group"><h3>${escapeHtml(section.title)}</h3><dl>${section.rows.map((row) => `<div><dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(row.value)}</dd></div>`).join("")}</dl></div>`).join("");
}

let committedInput = readInput();
let currentResult = solve2DDesign(committedInput);
let currentSections = buildSections(committedInput, currentResult);

function render(input: TwoDDesignInput, result: ReturnType<typeof solve2DDesign>) {
  renderStatus(element("top-status"), result.status);
  renderStatus(element("result-status"), result.status);
  element("status-message").textContent = result.statusMessage;
  const recommendation = result.recommended;
  element("recommended").textContent = recommendation ? `${format(recommendation.focalLengthMm, 1)} mm` : "暂无推荐";
  element("focal-range").textContent = focalRangeText(result.focalRangeMm, 1);
  element("f-number").textContent = recommendation ? `F/${format(recommendation.operatingFNumber, 1)}` : "—";
  element("required-f-number").textContent = recommendation ? `≥ F/${format(recommendation.requiredFNumber, 1)}` : "—";
  element("work-range").textContent = `${format(input.near.distanceMm, 0)}–${format(input.far.distanceMm, 0)} mm`;
  element("dof-range").textContent = recommendation ? `${format(recommendation.designDofNearMm, 0)}–${format(recommendation.designDofFarMm, 0)} mm` : "—";
  element("focus-result").textContent = `${format(result.resolvedFocusDistanceMm, 0)} mm · ${result.focusMode === "automatic" ? "自动" : "手动"}`;
  element("near-pixel").textContent = recommendation ? `${format(recommendation.near.objectPixelMm, 3)} mm/px` : "—";
  element("far-pixel").textContent = recommendation ? `${format(recommendation.far.objectPixelMm, 3)} mm/px` : "—";
  element("required-line-rate").textContent = result.motion.requiredLineRateKhz == null ? "未校核" : `${format(result.motion.requiredLineRateKhz, 2)} kHz`;
  element("motion-status").textContent = motionLabel(result.motion.status);
  element("focus-method").textContent = result.assumptions.focusMethod;
  element("diffraction-warning").hidden = !recommendation?.diffractionReview;
  element("diffraction-text").textContent = recommendation ? `550 nm 参考下理论艾里斑约 ${format(recommendation.airyDiameterUm, 1)} μm，大于设计弥散圆 ${format(result.designCircleOfConfusionUm, 1)} μm；仅提示复核，不单独否决。` : "";
  element("no-result").hidden = Boolean(recommendation);
  element("no-result").textContent = noResultDetail(result);
  renderCone(result);
  renderCandidates(result);
  currentSections = buildSections(input, result);
  renderParameters(currentSections);
}

function setStale(stale: boolean) {
  element("dirty-label").hidden = !stale;
  element("stale-banner").hidden = !stale;
  element("parameter-stale").hidden = !stale;
  ["copy-png", "download-png", "print-pdf"].forEach((id) => {
    element<HTMLButtonElement>(id).disabled = stale;
  });
  element("candidate-count").className = stale ? "output-age output-age--stale" : "output-age";
  if (stale) element("candidate-count").textContent = "上次有效结果";
}

function updateLiveDerived() {
  element("sensor-width").textContent = `${format((numericValue("pixels") ?? 0) * (numericValue("pitch") ?? 0) / 1000, 3)} mm`;
}

function applyCameraSource() {
  const custom = element<HTMLSelectElement>("camera-source").value === "custom";
  ["camera-model", "pixels", "rows", "pitch", "line-rate"].forEach((id) => {
    element<HTMLInputElement>(id).readOnly = !custom;
  });
  if (!custom) {
    element<HTMLInputElement>("camera-model").value = "MV-CL042-91GC";
    element<HTMLInputElement>("pixels").value = "4096";
    element<HTMLInputElement>("rows").value = "2";
    element<HTMLInputElement>("pitch").value = "7";
    element<HTMLInputElement>("line-rate").value = "28";
  } else {
    element<HTMLInputElement>("camera-model").value = "自定义相机";
    element<HTMLInputElement>("line-rate").value = "";
  }
  updateLiveDerived();
  setStale(true);
}

document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select").forEach((control) => {
  control.addEventListener("input", () => {
    updateLiveDerived();
    setStale(true);
    element("export-message").hidden = true;
  });
});
element("camera-source").addEventListener("change", applyCameraSource);
element("motion-enabled").addEventListener("change", () => {
  element("motion-fields").hidden = !element<HTMLInputElement>("motion-enabled").checked;
});

element("calculate").addEventListener("click", () => {
  const attemptedInput = readInput();
  const attemptedResult = solve2DDesign(attemptedInput);
  if (attemptedResult.status === "incomplete") {
    const validation = element("validation");
    validation.hidden = false;
    validation.innerHTML = `<strong>请修正以下输入</strong><ul>${attemptedResult.validationErrors.map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul>`;
    return;
  }
  committedInput = attemptedInput;
  currentResult = attemptedResult;
  element("validation").hidden = true;
  setStale(false);
  render(committedInput, currentResult);
  const message = element("export-message");
  message.textContent = "计算结果已更新，可以导出。";
  message.hidden = false;
});

function createPng() {
  const canvas = document.createElement("canvas");
  canvas.width = 1800;
  canvas.height = 1120;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("当前浏览器无法创建图片画布。"));
  const positions = [[60, 190], [930, 190], [60, 620], [930, 620]];
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#18232e";
  context.font = "700 42px 'Microsoft YaHei','Segoe UI',sans-serif";
  context.fillText("光学方案参数表", 60, 78);
  context.fillStyle = "#66727f";
  context.font = "22px 'Microsoft YaHei','Segoe UI',sans-serif";
  context.fillText("二维线扫相机 · 理论选型值 · 距离基准：物方主平面", 60, 122);
  context.fillStyle = "#9a5a18";
  context.font = "700 22px 'Microsoft YaHei','Segoe UI',sans-serif";
  context.textAlign = "right";
  context.fillText(statusLabels[currentResult.status], 1740, 82);
  context.textAlign = "left";
  const clipped = (text: string, x: number, y: number, width: number) => {
    let output = text;
    while (context.measureText(output).width > width && output.length > 2) output = `${output.slice(0, -2)}…`;
    context.fillText(output, x, y);
  };
  currentSections.slice(0, 4).forEach((section, index) => {
    const [x, y] = positions[index];
    context.strokeStyle = "#aeb8c2";
    context.lineWidth = 2;
    context.strokeRect(x, y, 810, 390);
    context.fillStyle = "#e9edf1";
    context.fillRect(x, y, 810, 48);
    context.fillStyle = "#18232e";
    context.font = "700 22px 'Microsoft YaHei','Segoe UI',sans-serif";
    context.fillText(section.title, x + 18, y + 32);
    section.rows.slice(0, 6).forEach((row, rowIndex) => {
      const rowY = y + 48 + rowIndex * 57;
      context.fillStyle = rowIndex % 2 ? "#fff" : "#f8f9fa";
      context.fillRect(x, rowY, 810, 57);
      context.strokeStyle = "#d8dee5";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, rowY);
      context.lineTo(x + 810, rowY);
      context.moveTo(x + 305, rowY);
      context.lineTo(x + 305, rowY + 57);
      context.stroke();
      context.fillStyle = "#66727f";
      context.font = "19px 'Microsoft YaHei','Segoe UI',sans-serif";
      clipped(row.label, x + 16, rowY + 36, 270);
      context.fillStyle = "#18232e";
      context.font = "600 19px 'Microsoft YaHei','Segoe UI',sans-serif";
      clipped(row.value, x + 325, rowY + 36, 455);
    });
  });
  context.fillStyle = "#66727f";
  context.font = "18px 'Microsoft YaHei','Segoe UI',sans-serif";
  context.fillText("实际镜头需复核主平面、畸变、MTF 与装调误差。", 60, 1070);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG 生成失败。")), "image/png"));
}

function showExportMessage(text: string) {
  const message = element("export-message");
  message.textContent = text;
  message.hidden = false;
}

element("copy-png").addEventListener("click", async () => {
  try {
    const blob = await createPng();
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("当前浏览器不支持直接复制图片，请使用“下载 PNG”。");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    showExportMessage("参数表 PNG 已复制到剪贴板。");
  } catch (error) {
    showExportMessage(error instanceof Error ? error.message : "复制失败，请使用“下载 PNG”。");
  }
});

element("download-png").addEventListener("click", async () => {
  try {
    const blob = await createPng();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `光学方案参数表-${committedInput.camera.model.replace(/[<>:"/\\|?*]/g, "_")}.png`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    showExportMessage("参数表 PNG 已下载。");
  } catch (error) {
    showExportMessage(error instanceof Error ? error.message : "PNG 下载失败。");
  }
});
element("print-pdf").addEventListener("click", () => window.print());

render(committedInput, currentResult);
setStale(false);

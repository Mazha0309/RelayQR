import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { Download, Image as ImageIcon } from "lucide-react";
import type { QrStyle } from "../types";

interface Props {
  value: string;
  style: QrStyle;
  iconUrl: string | null;
}

const SIZE = 1000;

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fill();
}

function matrixFor(value: string) {
  return QRCode.create(value || "https://relayqr.local", { errorCorrectionLevel: "H" }).modules;
}

async function loadIcon(url: string | null) {
  if (!url) return null;
  const response = await fetch(url);
  if (!response.ok) return null;
  const blob = await response.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("图标加载失败"));
    image.src = dataUrl;
  });
  return { image, dataUrl };
}

function geometry(style: QrStyle, matrixSize: number) {
  const textSpace = style.textEnabled ? 110 : 0;
  const qrOuter = 830;
  const qrX = (SIZE - qrOuter) / 2;
  const qrY = style.textEnabled && style.textPosition === "top" ? 120 : 55;
  const moduleSize = qrOuter / (matrixSize + 8);
  return { textSpace, qrOuter, qrX, qrY, moduleSize };
}

async function drawCanvas(canvas: HTMLCanvasElement, value: string, style: QrStyle, iconUrl: string | null) {
  const context = canvas.getContext("2d")!;
  const matrix = matrixFor(value);
  const { qrOuter, qrX, qrY, moduleSize } = geometry(style, matrix.size);
  context.clearRect(0, 0, SIZE, SIZE);
  if (style.backgroundMode === "solid") {
    context.fillStyle = style.backgroundColor;
    context.fillRect(0, 0, SIZE, SIZE);
  }
  context.fillStyle = "#111827";
  for (let row = 0; row < matrix.size; row += 1) {
    for (let column = 0; column < matrix.size; column += 1) {
      if (matrix.data[row * matrix.size + column]) {
        const x = qrX + (column + 4) * moduleSize;
        const y = qrY + (row + 4) * moduleSize;
        context.fillRect(Math.floor(x), Math.floor(y), Math.ceil(moduleSize), Math.ceil(moduleSize));
      }
    }
  }

  const icon = await loadIcon(iconUrl);
  if (icon) {
    const iconSize = qrOuter * (style.iconSize / 100);
    const x = (SIZE - iconSize) / 2;
    const y = qrY + (qrOuter - iconSize) / 2;
    const pad = 14;
    context.fillStyle = style.backgroundMode === "solid" ? style.backgroundColor : "#ffffff";
    roundedRect(context, x - pad, y - pad, iconSize + pad * 2, iconSize + pad * 2, 24);
    context.drawImage(icon.image, x, y, iconSize, iconSize);
  }

  if (style.textEnabled && style.text.trim()) {
    context.fillStyle = style.textColor;
    context.font = `${style.textWeight} ${style.textSize}px Inter, system-ui, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    const textY = style.textPosition === "top" ? 55 : qrY + qrOuter + 55;
    context.fillText(style.text.trim(), SIZE / 2, textY, 880);
  }
}

function xml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
}

async function buildSvg(value: string, style: QrStyle, iconUrl: string | null) {
  const matrix = matrixFor(value);
  const { qrOuter, qrX, qrY, moduleSize } = geometry(style, matrix.size);
  const path: string[] = [];
  for (let row = 0; row < matrix.size; row += 1) {
    for (let column = 0; column < matrix.size; column += 1) {
      if (matrix.data[row * matrix.size + column]) {
        const x = qrX + (column + 4) * moduleSize;
        const y = qrY + (row + 4) * moduleSize;
        path.push(`M${x.toFixed(3)} ${y.toFixed(3)}h${moduleSize.toFixed(3)}v${moduleSize.toFixed(3)}h-${moduleSize.toFixed(3)}z`);
      }
    }
  }
  const icon = await loadIcon(iconUrl);
  const background = style.backgroundMode === "solid" ? `<rect width="1000" height="1000" fill="${style.backgroundColor}"/>` : "";
  let iconSvg = "";
  if (icon) {
    const iconSize = qrOuter * (style.iconSize / 100);
    const x = (SIZE - iconSize) / 2;
    const y = qrY + (qrOuter - iconSize) / 2;
    iconSvg = `<rect x="${x - 14}" y="${y - 14}" width="${iconSize + 28}" height="${iconSize + 28}" rx="24" fill="${style.backgroundMode === "solid" ? style.backgroundColor : "#fff"}"/><image href="${icon.dataUrl}" x="${x}" y="${y}" width="${iconSize}" height="${iconSize}" preserveAspectRatio="xMidYMid meet"/>`;
  }
  const textY = style.textPosition === "top" ? 55 : qrY + qrOuter + 55;
  const textSvg = style.textEnabled && style.text.trim()
    ? `<text x="500" y="${textY}" text-anchor="middle" dominant-baseline="middle" fill="${style.textColor}" font-family="Inter,system-ui,sans-serif" font-size="${style.textSize}" font-weight="${style.textWeight}">${xml(style.text.trim())}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">${background}<path fill="#111827" d="${path.join("")}"/>${iconSvg}${textSvg}</svg>`;
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function QrDesigner({ value, style, iconUrl }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [renderError, setRenderError] = useState("");
  const renderKey = useMemo(() => JSON.stringify([value, style, iconUrl]), [value, style, iconUrl]);

  useEffect(() => {
    if (!canvasRef.current) return;
    setRenderError("");
    drawCanvas(canvasRef.current, value, style, iconUrl).catch(() => setRenderError("二维码预览生成失败"));
  }, [renderKey]);

  const downloadPng = async () => {
    if (!canvasRef.current) return;
    await drawCanvas(canvasRef.current, value, style, iconUrl);
    canvasRef.current.toBlob((blob) => blob && saveBlob(blob, "relayqr.png"), "image/png");
  };

  const downloadSvg = async () => saveBlob(new Blob([await buildSvg(value, style, iconUrl)], { type: "image/svg+xml" }), "relayqr.svg");

  return (
    <div className="designer-preview">
      <div className={`canvas-shell ${style.backgroundMode === "transparent" ? "checkerboard" : ""}`}>
        <canvas ref={canvasRef} width={SIZE} height={SIZE} aria-label="二维码预览" />
        {renderError && <div className="preview-error">{renderError}</div>}
      </div>
      <div className="download-row">
        <button className="button secondary" onClick={downloadPng}><Download size={16} /> PNG</button>
        <button className="button secondary" onClick={downloadSvg}><ImageIcon size={16} /> SVG</button>
      </div>
      <p className="hint">中心图标会自动使用高容错二维码。导出后请用实际设备扫码验证。</p>
    </div>
  );
}

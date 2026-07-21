import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import { RGBLuminanceSource } from "@zxing/library";
import { decodeQrLuminance, decodeQrPixels } from "./qrDecoder";

function qrSource(value: string, inverted = false) {
  const matrix = QRCode.create(value, { errorCorrectionLevel: "H" }).modules;
  const margin = 4;
  const moduleSize = 8;
  const size = (matrix.size + margin * 2) * moduleSize;
  const light = inverted ? 0 : 255;
  const dark = inverted ? 255 : 0;
  const pixels = new Uint8ClampedArray(size * size).fill(light);

  for (let row = 0; row < matrix.size; row += 1) {
    for (let column = 0; column < matrix.size; column += 1) {
      if (!matrix.data[row * matrix.size + column]) continue;

      const startX = (column + margin) * moduleSize;
      const startY = (row + margin) * moduleSize;
      for (let y = startY; y < startY + moduleSize; y += 1) {
        pixels.fill(dark, y * size + startX, y * size + startX + moduleSize);
      }
    }
  }

  return new RGBLuminanceSource(pixels, size, size);
}

function colourfulQrPixels(value: string) {
  const matrix = QRCode.create(value, { errorCorrectionLevel: "H" }).modules;
  const margin = 4;
  const moduleSize = 8;
  const size = (matrix.size + margin * 2) * moduleSize;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  const colours = [[255, 0, 0], [0, 190, 0], [0, 0, 255]];

  for (let row = 0; row < matrix.size; row += 1) {
    for (let column = 0; column < matrix.size; column += 1) {
      if (!matrix.data[row * matrix.size + column]) continue;

      const colour = colours[(row + column) % colours.length];
      for (let y = 0; y < moduleSize; y += 1) {
        for (let x = 0; x < moduleSize; x += 1) {
          const pixel = (((row + margin) * moduleSize + y) * size + (column + margin) * moduleSize + x) * 4;
          pixels[pixel] = colour[0];
          pixels[pixel + 1] = colour[1];
          pixels[pixel + 2] = colour[2];
        }
      }
    }
  }

  return { pixels, size };
}

describe("QR generation dependency", () => {
  it("creates a high-error-correction matrix for a RelayQR URL", () => {
    const qr = QRCode.create("https://relay.example/r/AbCd234567", { errorCorrectionLevel: "H" });
    expect(qr.modules.size).toBeGreaterThan(20);
    expect(qr.modules.data.some((module) => module === 1)).toBe(true);
  });

  it.each([["standard", false], ["inverted", true]] as const)("decodes %s QR images", (_label, inverted) => {
    const value = "https://weixin.qq.com/g/example-group-link";
    expect(decodeQrLuminance(qrSource(value, inverted))).toBe(value);
  });

  it("decodes QR images with multicolour modules", () => {
    const value = "https://weixin.qq.com/g/example-group-link";
    const { pixels, size } = colourfulQrPixels(value);
    expect(decodeQrPixels(pixels, size, size)).toBe(value);
  });
});

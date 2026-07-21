import { describe, expect, it } from "vitest";
import QRCode from "qrcode";

describe("QR generation dependency", () => {
  it("creates a high-error-correction matrix for a RelayQR URL", () => {
    const qr = QRCode.create("https://relay.example/r/AbCd234567", { errorCorrectionLevel: "H" });
    expect(qr.modules.size).toBeGreaterThan(20);
    expect(qr.modules.data.some((module) => module === 1)).toBe(true);
  });
});

import { z } from "zod";

export const qrStyleSchema = z.object({
  backgroundMode: z.enum(["transparent", "solid"]),
  backgroundColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  textEnabled: z.boolean(),
  text: z.string().max(120),
  textPosition: z.enum(["top", "bottom"]),
  textSize: z.number().int().min(14).max(72),
  textColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  textWeight: z.enum(["400", "500", "600", "700"]),
  iconSize: z.number().int().min(10).max(28),
});

export type QrStyle = z.infer<typeof qrStyleSchema>;

export const defaultQrStyle: QrStyle = {
  backgroundMode: "solid",
  backgroundColor: "#ffffff",
  textEnabled: false,
  text: "",
  textPosition: "bottom",
  textSize: 28,
  textColor: "#111827",
  textWeight: "600",
  iconSize: 20,
};

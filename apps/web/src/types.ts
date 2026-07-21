export interface User {
  id: string;
  username: string;
}

export interface QrStyle {
  backgroundMode: "transparent" | "solid";
  backgroundColor: string;
  textEnabled: boolean;
  text: string;
  textPosition: "top" | "bottom";
  textSize: number;
  textColor: string;
  textWeight: "400" | "500" | "600" | "700";
  iconSize: number;
}

export interface RelayCode {
  id: string;
  slug: string;
  name: string;
  target: string;
  protocol: string;
  style: QrStyle;
  hasIcon: boolean;
  iconUrl: string | null;
  redirectEnabled: boolean;
  disabledReason: string | null;
  publicUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface Revision {
  id: string;
  target: string;
  protocol: string;
  created_at: string;
  createdAt: string;
  isActive: boolean;
}

export interface Stats {
  total: number;
  days: number;
  daily: Array<{ date: string; count: number }>;
  devices: Array<{ label: string; count: number }>;
  referrers: Array<{ label: string; count: number }>;
}

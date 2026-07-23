export interface User {
  id: string;
  username: string;
  isAdmin: boolean;
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

export type GateQuestion = {
  id: string;
  prompt: string;
} & ({
  type: "choice";
  options: string[];
  correctOption: number;
} | {
  type: "text";
  correctAnswer: string;
});

export interface GateSettings {
  enabled: boolean;
  locationEnabled: boolean;
  allowedRegions: string[];
  questions: GateQuestion[];
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
  hasSourceQr: boolean;
  sourceQrUrl: string | null;
  fallbackEnabled: boolean;
  showTargetLink: boolean;
  gate: GateSettings;
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
  regions: Array<{ label: string; count: number }>;
  recentScans: Array<{
    scannedAt: string;
    ipAddress: string;
    region: string;
    device: string;
    referrer: string;
  }>;
}

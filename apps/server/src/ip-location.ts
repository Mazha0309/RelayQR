import { isIP } from "node:net";
import { defaultDbFile, loadContentFromFile, newWithBuffer } from "ip2region-ts";

export interface IpLocation {
  ip: string;
  country: string | null;
  province: string | null;
  city: string | null;
  isp: string | null;
  label: string;
  searchableParts: string[];
}

const searcher = newWithBuffer(loadContentFromFile(defaultDbFile));
const cache = new Map<string, IpLocation>();

export function normalizeIp(value: string) {
  const withoutZone = value.split("%")[0] ?? value;
  if (withoutZone.startsWith("::ffff:")) return withoutZone.slice(7);
  return withoutZone.slice(0, 64);
}

function useful(value: string | undefined) {
  if (!value || value === "0") return null;
  return value.trim() || null;
}

function localLocation(ip: string): IpLocation {
  return { ip, country: null, province: null, city: null, isp: null, label: "内网/本机", searchableParts: [] };
}

function unknownLocation(ip: string): IpLocation {
  return { ip, country: null, province: null, city: null, isp: null, label: "未知属地", searchableParts: [] };
}

export async function locateIp(input: string): Promise<IpLocation> {
  const ip = normalizeIp(input);
  const cached = cache.get(ip);
  if (cached) return cached;

  if (isIP(ip) !== 4) {
    const result = ip === "::1" ? localLocation(ip) : unknownLocation(ip);
    cache.set(ip, result);
    return result;
  }
  if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)) {
    const result = localLocation(ip);
    cache.set(ip, result);
    return result;
  }

  try {
    const result = await searcher.search(ip);
    const [countryRaw, , provinceRaw, cityRaw, ispRaw] = (result.region ?? "").split("|");
    const country = useful(countryRaw);
    const province = useful(provinceRaw);
    const city = useful(cityRaw);
    const isp = useful(ispRaw);
    const searchableParts = [country, province, city].filter((part): part is string => Boolean(part));
    const location: IpLocation = {
      ip,
      country,
      province,
      city,
      isp,
      label: [...searchableParts, isp].filter(Boolean).join(" · ") || "未知属地",
      searchableParts,
    };
    if (cache.size >= 20_000) cache.delete(cache.keys().next().value!);
    cache.set(ip, location);
    return location;
  } catch {
    return unknownLocation(ip);
  }
}

function comparable(value: string) {
  return value.toLocaleLowerCase("zh-CN").replace(/[\s·|,，省市区县自治区特别行政区]/g, "");
}

export function locationAllowed(parts: string[], allowedRegions: string[]) {
  if (!parts.length) return false;
  return allowedRegions.some((allowed) => {
    const expected = comparable(allowed);
    return expected.length >= 2 && parts.some((part) => {
      const actual = comparable(part);
      return actual.includes(expected) || expected.includes(actual);
    });
  });
}

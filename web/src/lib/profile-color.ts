function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

const PROFILE_TAG_SATURATION = 68;
const PROFILE_TAG_LIGHTNESS = 58;

export function profileColor(name: string | null | undefined): string | null {
  const key = (name ?? "").trim();
  if (!key || key === "default") {
    return null;
  }
  const hue = hashString(key) % 360;
  return `hsl(${hue} ${PROFILE_TAG_SATURATION}% ${PROFILE_TAG_LIGHTNESS}%)`;
}

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  MOBILE_SW_BUILD_PLACEHOLDER,
  MOBILE_SW_CACHE_PREFIX,
  isMobileShellNavigationPath,
  mobileSwCacheName,
  shouldBypassServiceWorkerCache,
  shouldDeleteOldMobileShellCache,
} from "@/lib/mobile-sw-policy";

const publicSwPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public/sw.js");

describe("mobile-sw-policy", () => {
  it("bypasses all /api paths", () => {
    expect(shouldBypassServiceWorkerCache("/api")).toBe(true);
    expect(shouldBypassServiceWorkerCache("/api/mobile/roster")).toBe(true);
    expect(shouldBypassServiceWorkerCache("/api/sessions/x/messages")).toBe(true);
    expect(shouldBypassServiceWorkerCache("/mobile")).toBe(false);
    expect(shouldBypassServiceWorkerCache("/assets/index.js")).toBe(false);
  });

  it("deletes prior hermes-mobile-shell caches on activate", () => {
    const current = mobileSwCacheName("build-abc");
    expect(shouldDeleteOldMobileShellCache("hermes-mobile-shell-v1", current)).toBe(true);
    expect(shouldDeleteOldMobileShellCache("hermes-mobile-shell-v2", current)).toBe(true);
    expect(shouldDeleteOldMobileShellCache(current, current)).toBe(false);
    expect(shouldDeleteOldMobileShellCache("other-cache", current)).toBe(false);
  });

  it("treats /mobile and login as shell navigations", () => {
    expect(isMobileShellNavigationPath("/mobile")).toBe(true);
    expect(isMobileShellNavigationPath("/login")).toBe(true);
    expect(isMobileShellNavigationPath("/api/mobile/roster")).toBe(false);
  });

  it("public sw.js encodes /api bypass, cache prefix, and build placeholder", () => {
    const source = readFileSync(publicSwPath, "utf8");
    expect(source).toContain(MOBILE_SW_CACHE_PREFIX);
    expect(source).toContain(MOBILE_SW_BUILD_PLACEHOLDER);
    expect(source).toMatch(/pathname\.startsWith\("\/api\/"\)|startsWith\("\/api\/"\)/);
    expect(source).toContain("clients.claim");
    expect(source).toContain("skipWaiting");
    expect(source).toContain("hermes-mobile-shell-");
    // Network-first for navigations / hashed assets — not bare cache-first for JS.
    expect(source).toContain("isShellNavigation");
    expect(source).toContain("isHashedAsset");
  });

  it("cache name changes when build id changes", () => {
    expect(mobileSwCacheName("a")).not.toBe(mobileSwCacheName("b"));
    expect(mobileSwCacheName("6150452")).toMatch(/^hermes-mobile-shell-/);
  });
});

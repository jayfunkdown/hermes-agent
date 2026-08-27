// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";

import { MobileHubFooter } from "@/components/mobile/MobileHubFooter";

vi.mock("@/components/ProfileSwitcher", () => ({
  ProfileSwitcher: () => <div data-testid="profile-switcher">ProfileSwitcher</div>,
}));

vi.mock("@/components/AuthWidget", () => ({
  AuthWidget: ({ compact }: { compact?: boolean }) => (
    <div data-testid="auth-widget" data-compact={compact ? "true" : "false"}>
      AuthWidget
    </div>
  ),
}));

let container: HTMLDivElement;
let root: Root;

async function render(ui: ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(ui));
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
});

describe("MobileHubFooter", () => {
  it("hides ProfileSwitcher and uses compact auth on mobile layout", async () => {
    await render(<MobileHubFooter isMobileLayout />);
    expect(container.querySelector('[data-testid="profile-switcher"]')).toBeNull();
    expect(container.querySelector('[data-testid="auth-widget"]')?.getAttribute("data-compact")).toBe(
      "true",
    );
  });

  it("keeps the desktop profile switcher on wide layout", async () => {
    await render(<MobileHubFooter isMobileLayout={false} />);
    expect(container.querySelector('[data-testid="profile-switcher"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="auth-widget"]')?.getAttribute("data-compact")).toBe(
      "false",
    );
  });
});

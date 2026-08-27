// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { AuthWidget } from "@/components/AuthWidget";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    getAuthMe: vi.fn(),
    logout: vi.fn(),
  },
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.__HERMES_AUTH_REQUIRED__ = true;
  vi.mocked(api.getAuthMe).mockResolvedValue({
    user_id: "user-abcdefghijklmnop",
    provider: "nous",
    display_name: "",
    email: "",
    org_id: "",
    expires_at: 0,
  });
});

afterEach(async () => {
  delete window.__HERMES_AUTH_REQUIRED__;
  await act(async () => root?.unmount());
  container?.remove();
  vi.clearAllMocks();
});

describe("AuthWidget compact", () => {
  it("renders a single logged-in line without the desktop sidebar chrome", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<AuthWidget compact />));
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Logged in as");
    expect(container.textContent).toContain("user-abcdefghi");
    expect(container.textContent).not.toContain("via nous");
  });
});

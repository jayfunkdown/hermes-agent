// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { MobileChatErrorBoundary } from "@/components/mobile/MobileChatErrorBoundary";

function Boom(): never {
  throw new Error("render boom");
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => root?.unmount());
  container?.remove();
});

describe("MobileChatErrorBoundary", () => {
  it("shows reload affordance instead of a blank screen", async () => {
    const onReload = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root.render(
        <MobileChatErrorBoundary onReload={onReload}>
          <Boom />
        </MobileChatErrorBoundary>,
      );
    });

    expect(container.textContent).toContain("This chat couldn't be displayed.");
    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});

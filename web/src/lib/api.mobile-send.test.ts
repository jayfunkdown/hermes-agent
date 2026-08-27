// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { api } from "./api";

describe("mobile session message API", () => {
  it("posts plain text to the session-scoped endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, accepted: true, session_id: "s1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await api.submitSessionMessage("s1", "hello", "boss-bot");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/sessions/s1/messages?profile=boss-bot"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ text: "hello" }),
      }),
    );
    fetchMock.mockRestore();
  });
});

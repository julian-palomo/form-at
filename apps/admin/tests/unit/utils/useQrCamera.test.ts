import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useQrCamera } from "~/utils/useQrCamera";

// jsdom has no camera, so `getUserMedia` is stubbed; what's checked is how the
// hook reports the camera and that it always turns it off. Decoding is
// covered by qrRoundTrip.test.ts.

function stubCamera(getUserMedia: () => Promise<MediaStream>) {
  vi.stubGlobal("navigator", { ...navigator, mediaDevices: { getUserMedia } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useQrCamera", () => {
  it("asks for the rear camera, runs, and stops the camera on unmount", async () => {
    const stop = vi.fn();
    const getUserMedia = vi.fn(
      async () => ({ getTracks: () => [{ stop }] }) as unknown as MediaStream,
    );
    stubCamera(getUserMedia);
    const video = document.createElement("video");
    vi.spyOn(video, "play").mockResolvedValue();

    const { result, unmount } = renderHook(() => useQrCamera({ current: video }, vi.fn()));

    await waitFor(() => expect(result.current).toBe("running"));
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: "environment" },
      audio: false,
    });
    unmount();
    expect(stop).toHaveBeenCalled();
  });

  it("reports denied when the permission is refused", async () => {
    stubCamera(async () => {
      throw new DOMException("denied", "NotAllowedError");
    });
    const { result } = renderHook(() => useQrCamera({ current: null }, vi.fn()));
    await waitFor(() => expect(result.current).toBe("denied"));
  });

  it("reports unavailable when the browser has no camera API", async () => {
    vi.stubGlobal("navigator", { ...navigator, mediaDevices: undefined });
    const { result } = renderHook(() => useQrCamera({ current: null }, vi.fn()));
    await waitFor(() => expect(result.current).toBe("unavailable"));
  });
});

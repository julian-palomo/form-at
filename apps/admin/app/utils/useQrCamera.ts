import jsQR from "jsqr";
import { type RefObject, useEffect, useEffectEvent, useState } from "react";

// The rear camera, read for QR codes a few times a second. jsQR decodes in
// plain JS from canvas pixels, so the same decoder runs on Chromium and
// Safari (`BarcodeDetector` exists only in Chromium) and needs no Worker,
// WASM or CSP change. Only DoorScanner imports this, and DoorList loads
// DoorScanner lazily, so jsQR stays out of every other page's bundle.

export type CameraState = "starting" | "running" | "denied" | "unavailable";

/** How often a frame is decoded; fast enough to feel instant, light on a phone's battery. */
const SCAN_INTERVAL_MS = 150;
/** Frames are scaled down so their longer side is at most this, which keeps jsQR quick. */
const MAX_FRAME_SIDE = 640;

export function useQrCamera(
  videoRef: RefObject<HTMLVideoElement | null>,
  onCode: (text: string) => void,
): CameraState {
  const [state, setState] = useState<CameraState>("starting");
  // Reads the latest `onCode` from inside the interval, so a new callback
  // doesn't restart the camera.
  const emitCode = useEffectEvent(onCode);

  // biome-ignore lint/correctness/useExhaustiveDependencies: an Effect Event never goes in a dependency list; Biome doesn't know useEffectEvent.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });

    const scanFrame = () => {
      const video = videoRef.current;
      if (!video || !context || video.readyState < video.HAVE_CURRENT_DATA) return;
      const scale = Math.min(1, MAX_FRAME_SIDE / Math.max(video.videoWidth, video.videoHeight));
      const width = Math.round(video.videoWidth * scale);
      const height = Math.round(video.videoHeight * scale);
      if (width === 0 || height === 0) return;
      canvas.width = width;
      canvas.height = height;
      context.drawImage(video, 0, 0, width, height);
      const { data } = context.getImageData(0, 0, width, height);
      const code = jsQR(data, width, height, { inversionAttempts: "dontInvert" });
      if (code?.data) emitCode(code.data);
    };

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState("unavailable");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
      } catch (error) {
        setState(
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "denied"
            : "unavailable",
        );
        return;
      }
      // The scanner closed while the permission prompt was open.
      if (cancelled) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => {});
      }
      setState("running");
      timer = setInterval(scanFrame, SCAN_INTERVAL_MS);
    };

    void start();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      if (stream) for (const track of stream.getTracks()) track.stop();
    };
  }, [videoRef]);

  return state;
}

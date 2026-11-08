import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DoorScanner from "~/components/DoorScanner";
import type { CheckInResponseBody } from "~/routes/api/tickets/check-in";
import type { CameraState } from "~/utils/useQrCamera";

// The camera and decoder are replaced by a hook that hands the test the
// `onCode` callback, so each test "scans" a string and checks what the door
// sees. jsdom has no camera; the decoder itself is covered by
// utils/qrRoundTrip.test.ts.

let scan: (code: string) => Promise<void> | void = () => {};
let cameraState: CameraState = "running";

vi.mock("~/utils/useQrCamera", () => ({
  useQrCamera: (_ref: unknown, onCode: (code: string) => Promise<void> | void) => {
    scan = onCode;
    return cameraState;
  },
}));

// 23:42 UTC on 5 Dec is 23:42 in Glasgow (GMT in winter).
const AT = Date.UTC(2026, 11, 5, 23, 42);
const TOKEN = "ticket-1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function respond(status: number, body?: CheckInResponseBody) {
  const fetchMock = vi.fn(async () =>
    body ? Response.json(body, { status }) : new Response(null, { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function scanned(code: string) {
  await act(async () => {
    await scan(code);
  });
}

beforeEach(() => {
  cameraState = "running";
  vi.stubGlobal("navigator", { ...navigator, vibrate: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DoorScanner", () => {
  it("shows IN with the name and the seat, sends the token and tells the list", async () => {
    const fetchMock = respond(200, {
      status: "checked_in",
      checkedInAt: AT,
      name: "Isla Grant",
      seq: 1,
      quantity: 3,
    });
    const onCheckIn = vi.fn();
    render(<DoorScanner onCheckIn={onCheckIn} />);

    await scanned(TOKEN);

    expect(screen.getByText("IN · Isla Grant (2 of 3)")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tickets/check-in",
      expect.objectContaining({ body: JSON.stringify({ token: TOKEN }) }),
    );
    expect(onCheckIn).toHaveBeenCalledWith("ticket-1", expect.objectContaining({ seq: 1 }));
    expect(navigator.vibrate).toHaveBeenCalledWith([80]);
  });

  it("leaves out the seat for an order of one", async () => {
    respond(200, { status: "checked_in", checkedInAt: AT, name: "Ada", seq: 0, quantity: 1 });
    render(<DoorScanner onCheckIn={vi.fn()} />);
    await scanned(TOKEN);
    expect(screen.getByText("IN · Ada")).toBeInTheDocument();
  });

  it("shows ALREADY USED with the first time and who let it in", async () => {
    respond(409, {
      status: "already_used",
      checkedInAt: AT,
      checkedInBy: "door@example.com",
      name: "Isla Grant",
      seq: 0,
      quantity: 1,
    });
    render(<DoorScanner onCheckIn={vi.fn()} />);

    await scanned(TOKEN);

    expect(screen.getByText("ALREADY USED at 23:42")).toBeInTheDocument();
    expect(screen.getByText("by door@example.com")).toBeInTheDocument();
    expect(navigator.vibrate).toHaveBeenCalledWith([250, 100, 250]);
  });

  it.each([404, 400])("shows NOT VALID for a %i", async (status) => {
    const onCheckIn = vi.fn();
    respond(status);
    render(<DoorScanner onCheckIn={onCheckIn} />);

    await scanned("https://example.com/not-a-ticket");

    expect(screen.getByText("NOT VALID")).toBeInTheDocument();
    expect(onCheckIn).not.toHaveBeenCalled();
  });

  it("says when the scanner isn't set up", async () => {
    respond(503);
    render(<DoorScanner onCheckIn={vi.fn()} />);
    await scanned(TOKEN);
    expect(screen.getByText(/scanner not set up/)).toBeInTheDocument();
  });

  it("says to check the signal when the request throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    render(<DoorScanner onCheckIn={vi.fn()} />);
    await scanned(TOKEN);
    expect(screen.getByText(/check your signal/)).toBeInTheDocument();
  });

  it("ignores the same QR read again straight away, but not a different one", async () => {
    const fetchMock = respond(200, {
      status: "checked_in",
      checkedInAt: AT,
      name: "Isla Grant",
      seq: 0,
      quantity: 1,
    });
    render(<DoorScanner onCheckIn={vi.fn()} />);

    await scanned(TOKEN);
    await scanned(TOKEN);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await scanned("ticket-2.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("checks the same QR again once the ignore window has passed", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(AT);
    const fetchMock = respond(200, {
      status: "checked_in",
      checkedInAt: AT,
      name: "Isla Grant",
      seq: 0,
      quantity: 1,
    });
    render(<DoorScanner onCheckIn={vi.fn()} />);

    await scanned(TOKEN);
    now.mockReturnValue(AT + 10_001);
    await scanned(TOKEN);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it.each([
    ["denied", /Camera blocked/],
    ["unavailable", /No camera here/],
    ["starting", /starting the camera/],
  ] as const)("explains a %s camera", (state, message) => {
    cameraState = state;
    render(<DoorScanner onCheckIn={vi.fn()} />);
    expect(screen.getByText(message)).toBeInTheDocument();
  });
});

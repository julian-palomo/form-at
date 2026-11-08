import { type MusicSet, getSet } from "@form-at/data/sets";
import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { type CatalogueSlice, createCatalogueSlice, getCatalogueSet } from "./catalogueSlice";
import { type OfflineSetState, type OfflineSlice, createOfflineSlice } from "./offlineSlice";
import {
  type PlayerSlice,
  createPlayerSlice,
  stampedDurationsOnly,
  stampedPeaksOnly,
} from "./playerSlice";
import { type StoredTicket, type TicketsSlice, createTicketsSlice } from "./ticketsSlice";
import { type UiSlice, createUiSlice } from "./uiSlice";

export type AppStore = PlayerSlice & UiSlice & OfflineSlice & CatalogueSlice & TicketsSlice;

export const useStore = create<AppStore>()(
  persist(
    (...a) => ({
      ...createPlayerSlice(...a),
      ...createUiSlice(...a),
      ...createOfflineSlice(...a),
      ...createCatalogueSlice(...a),
      ...createTicketsSlice(...a),
    }),
    {
      name: "format-player",
      // Wait until <HydrateStore> mounts before reading localStorage. Without this,
      // SSR (no localStorage → empty) and the first client render (synchronous
      // localStorage read → restored track) disagree, and React's reconciliation
      // produces a visible re-render of the player.
      skipHydration: true,
      partialize: (state) => ({
        nowPlayingId: state.nowPlaying?.id ?? null,
        positions: state.positions,
        peaksCache: state.peaksCache,
        durations: state.durations,
        // PWA install state — both booleans persisted so a returning user is
        // remembered as installed-or-dismissed across visits. `deferredPrompt`
        // is DELIBERATELY OMITTED: it's a non-serializable BeforeInstallPrompt
        // event with native methods (`.prompt()`, `.userChoice`) that would
        // either crash JSON.parse or yield a useless plain object on rehydrate.
        // The event is re-captured each page load when Chrome fires it.
        pwaInstalled: state.pwaInstalled,
        pwaInstallDismissed: state.pwaInstallDismissed,
        pushOptInDismissed: state.pushOptInDismissed,
        // Offline: persist ONLY confirmed-saved entries + the "first save
        // already requested persistent storage" flag. Mid-download state,
        // failures, and evictions are ephemeral — reconciled at boot from
        // IDB. A reload during a download = aborted (correct semantics).
        offlineSets: Object.fromEntries(
          Object.entries(state.offlineSets).filter(([, s]) => s.status === "saved"),
        ),
        hasRequestedPersist: state.hasRequestedPersist,
        // The live-merged catalogue from the last successful boot fetch —
        // persisted so a later fully-offline boot has more than just the bare
        // snapshot to work with, which narrows the "uploaded and saved in the
        // same deploy window" gap.
        // Deliberately NOT `catalogueReady`/`catalogueConfirmed`
        // — both must start false every session; see catalogueSlice.ts.
        catalogueSets: state.catalogueSets,
        // The tickets this device holds, by token. Plain strings and numbers
        // only; the event itself is looked up from `getEvent` at render time.
        tickets: state.tickets,
        celebratedOrders: state.celebratedOrders,
      }),
      merge: (persisted, current) => {
        // zustand calls merge(undefined, current) when the storage key does
        // not exist yet — i.e. on every true first visit. Without this guard
        // the destructure below throws, persist swallows the TypeError in its
        // internal .catch, `hasHydrated` never flips, and every surface gated
        // on useStoreHydrated() (the save gate, save-for-offline buttons,
        // OfflineReconciler) stays hidden for the whole session.
        if (!persisted) return current;
        const {
          nowPlayingId,
          positions,
          peaksCache,
          durations,
          pwaInstalled,
          pwaInstallDismissed,
          pushOptInDismissed,
          offlineSets,
          hasRequestedPersist,
          catalogueSets: persistedCatalogueSets,
          tickets,
          celebratedOrders,
        } = persisted as {
          nowPlayingId: string | null;
          positions: Record<string, number>;
          peaksCache: unknown;
          durations: unknown;
          pwaInstalled?: boolean;
          pwaInstallDismissed?: boolean;
          pushOptInDismissed?: boolean;
          offlineSets?: Record<string, OfflineSetState>;
          hasRequestedPersist?: boolean;
          catalogueSets?: MusicSet[];
          tickets?: Record<string, StoredTicket>;
          celebratedOrders?: string[];
        };
        // Falls back to `current.catalogueSets` (the bare snapshot default
        // from createCatalogueSlice) for a payload persisted before this
        // field existed — never `undefined`, so the lookup below always has
        // something to check.
        const catalogueSets = persistedCatalogueSets ?? current.catalogueSets;
        return {
          ...current,
          catalogueSets,
          // ALWAYS false on rehydrate, regardless of what a previous
          // session (or a hand-edited localStorage blob) might claim —
          // this session hasn't settled or confirmed anything yet. See
          // catalogueSlice.ts for why these are two distinct flags.
          catalogueReady: false,
          catalogueConfirmed: false,
          // Prefer the merged catalogue (covers a set uploaded since the
          // last deploy that this device has already fetched once) over the
          // bare static snapshot; `getSet` stays as the final fallback for a
          // payload predating catalogueSets entirely.
          nowPlaying: nowPlayingId
            ? (getCatalogueSet(catalogueSets, nowPlayingId) ?? getSet(nowPlayingId) ?? null)
            : null,
          positions: positions ?? {},
          peaksCache: stampedPeaksOnly(peaksCache),
          durations: stampedDurationsOnly(durations),
          pwaInstalled: pwaInstalled ?? false,
          pwaInstallDismissed: pwaInstallDismissed ?? false,
          pushOptInDismissed: pushOptInDismissed ?? false,
          offlineSets: offlineSets ?? {},
          hasRequestedPersist: hasRequestedPersist ?? false,
          tickets: tickets ?? {},
          celebratedOrders: celebratedOrders ?? [],
        };
      },
      // Rehydration failures are otherwise fully silent — persist catches
      // them internally and moves on. That silence is exactly how the
      // first-visit merge crash above went unnoticed; keep future ones loud.
      onRehydrateStorage: () => (_state, error) => {
        if (error) console.error("[store] persist rehydration failed:", error);
      },
    },
  ),
);

// Returns `true` once Zustand's persist middleware has finished rehydrating
// from localStorage, `false` before that. Use for components that gate
// rendering on persisted state (e.g. useSaveGate reading pwaInstalled)
// so they don't flash the wrong UI for one frame between mount and the
// `HydrateStore` effect firing `persist.rehydrate()`.
//
// Implemented via `useSyncExternalStore` so the React 19 compiler treats it
// as a proper external subscription — no stale-closure pitfalls, SSR-safe
// (returns false on the server), and re-renders any consumer the moment
// `onFinishHydration` fires.
export function useStoreHydrated(): boolean {
  return useSyncExternalStore(
    (cb) => useStore.persist.onFinishHydration(cb),
    () => useStore.persist.hasHydrated(),
    () => false,
  );
}

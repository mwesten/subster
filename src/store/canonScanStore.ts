import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { scanCuratedSongs } from '../metadata/curatedFetch'
import type { ServerConfig } from './configStore'

export interface CanonScanResult {
  inLibrary: number
  byArtists: number
  bundled: number
}

export type CanonScan =
  | { state: 'running'; done: number; total: number }
  | ({ state: 'done' } & CanonScanResult)
  | { state: 'failed' }

/**
 * The famous-songs scan (see scanCuratedSongs), per server id. Lives outside
 * the server screen so a scan keeps showing its progress after leaving and
 * coming back, and a second press can't start a second scan alongside. The
 * last result is remembered, so the app knows which servers were never
 * scanned and can recommend it there.
 */
interface CanonScanState {
  scans: Record<string, CanonScan>
  start: (serverId: string, config: ServerConfig) => Promise<void>
  /** Forget every result — the cache they describe was cleared. */
  reset: () => void
}

/**
 * What is persisted. Only finished scans are worth keeping: one still running
 * when the app closed did not finish, and a failure is not worth reporting
 * later.
 */
export function finishedScans(scans: Record<string, CanonScan>): Record<string, CanonScan> {
  return Object.fromEntries(Object.entries(scans).filter(([, v]) => v.state === 'done'))
}

export const useCanonScanStore = create<CanonScanState>()(
  persist(
    (set, get) => ({
      scans: {},
      async start(serverId, config) {
        if (get().scans[serverId]?.state === 'running') return
        const put = (scan: CanonScan) => set((s) => ({ scans: { ...s.scans, [serverId]: scan } }))
        put({ state: 'running', done: 0, total: 0 })
        const result = await scanCuratedSongs(config, (done, total) =>
          put({ state: 'running', done, total }),
        )
        put(result ? { state: 'done', ...result } : { state: 'failed' })
      },
      reset: () => set({ scans: {} }),
    }),
    {
      name: 'subster.canonScan',
      version: 1,
      partialize: (s) => ({ scans: finishedScans(s.scans) }),
    },
  ),
)

/** Whether this server has been scanned, for recommending it where it hasn't. */
export function useNeedsCanonScan(serverId: string | undefined): boolean {
  return useCanonScanStore((s) => {
    const state = serverId ? s.scans[serverId]?.state : 'done'
    return state !== 'done' && state !== 'running'
  })
}

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerConfig } from './configStore'

let finish: (r: { inLibrary: number; byArtists: number; bundled: number } | null) => void = () => {}
const scanCuratedSongs = vi.fn(
  (_c: ServerConfig, onProgress?: (done: number, total: number) => void) =>
    new Promise((resolve) => {
      onProgress?.(0, 10)
      finish = resolve
    }),
)
vi.mock('../metadata/curatedFetch', () => ({ scanCuratedSongs }))

const { finishedScans, useCanonScanStore } = await import('./canonScanStore')

const config = { id: 's1', name: '', baseUrl: 'http://x', username: 'u', salt: 'a', token: 'b' }

beforeEach(() => {
  scanCuratedSongs.mockClear()
  useCanonScanStore.getState().reset()
})

describe('canonScanStore', () => {
  it('runs one scan per server at a time, and keeps its progress and result', async () => {
    const first = useCanonScanStore.getState().start('s1', config)
    void useCanonScanStore.getState().start('s1', config) // pressed again while running
    expect(scanCuratedSongs).toHaveBeenCalledTimes(1)
    expect(useCanonScanStore.getState().scans.s1).toEqual({ state: 'running', done: 0, total: 10 })

    finish({ inLibrary: 5, byArtists: 10, bundled: 100 })
    await first
    expect(useCanonScanStore.getState().scans.s1).toEqual({
      state: 'done',
      inLibrary: 5,
      byArtists: 10,
      bundled: 100,
    })
  })

  it('persists only finished scans', async () => {
    const done = useCanonScanStore.getState().start('s1', config)
    finish({ inLibrary: 1, byArtists: 2, bundled: 3 })
    await done
    void useCanonScanStore.getState().start('s2', config) // still running
    expect(Object.keys(finishedScans(useCanonScanStore.getState().scans))).toEqual(['s1'])
  })
})

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { exclusionId, type Exclusion } from '../subsonic/exclusions'

/**
 * The player's exclusion list (see Exclusion). Device-wide, not per server:
 * a song someone can't bear to hear stays excluded whichever server is active.
 */
interface ExclusionState {
  items: Exclusion[]
  add: (e: Exclusion) => void
  remove: (id: string) => void
  /** Add if absent, remove if present. */
  toggle: (e: Exclusion) => void
  /** Replace a playlist's snapshot with its current songs. */
  refreshPlaylist: (id: string, songs: Array<{ artist: string; title: string }>) => void
}

export const useExclusionStore = create<ExclusionState>()(
  persist(
    (set, get) => ({
      items: [],
      add: (e) =>
        set((s) =>
          s.items.some((x) => exclusionId(x) === exclusionId(e)) ? s : { items: [...s.items, e] },
        ),
      remove: (id) => set((s) => ({ items: s.items.filter((x) => exclusionId(x) !== id) })),
      toggle: (e) => {
        const id = exclusionId(e)
        if (get().items.some((x) => exclusionId(x) === id)) get().remove(id)
        else get().add(e)
      },
      refreshPlaylist: (id, songs) =>
        set((s) => ({
          items: s.items.map((x) =>
            x.kind === 'playlist' && exclusionId(x) === id ? { ...x, songs } : x,
          ),
        })),
    }),
    { name: 'subster.exclusions', version: 1 },
  ),
)

/** Is this exact entry on the list? (hook form) */
export function useIsExcluded(e: Exclusion): boolean {
  const id = exclusionId(e)
  return useExclusionStore((s) => s.items.some((x) => exclusionId(x) === id))
}

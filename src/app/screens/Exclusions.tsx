import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Layout } from '../Layout'
import { useActiveServer, useEffectiveServer } from '../../store/configStore'
import { useExclusionStore } from '../../store/exclusionStore'
import {
  getPlaylists,
  getPlaylistSongs,
  searchLibrary,
  type LibraryAlbum,
  type LibraryArtist,
  type Playlist,
  type Song,
} from '../../subsonic/client'
import { exclusionId, type Exclusion } from '../../subsonic/exclusions'
import { useT } from '../../i18n'

interface Results {
  artists: LibraryArtist[]
  albums: LibraryAlbum[]
  songs: Song[]
  playlists: Playlist[]
}

/**
 * Manage the exclusion list: search the active server for something to
 * exclude, and review or remove what is already on the list. The search reads
 * from the server; the list itself never touches it.
 */
export function Exclusions() {
  const navigate = useNavigate()
  const server = useEffectiveServer()
  const serverId = useActiveServer()?.id
  const t = useT()
  const { items, toggle, remove } = useExclusionStore()
  const excludedIds = new Set(items.map(exclusionId))

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Results | null>(null)
  const [failed, setFailed] = useState(false)
  // Playlists aren't covered by search3; fetched once and filtered here.
  const [allPlaylists, setAllPlaylists] = useState<Playlist[]>([])
  const [busyPlaylist, setBusyPlaylist] = useState<string | null>(null)

  useEffect(() => {
    if (!server) return
    getPlaylists(server)
      .then(setAllPlaylists)
      .catch(() => setAllPlaylists([]))
  }, [server])

  useEffect(() => {
    const q = query.trim()
    if (!server || q.length < 2) {
      setResults(null)
      setFailed(false)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      searchLibrary(server, q)
        .then((r) => {
          if (cancelled) return
          const lower = q.toLowerCase()
          setResults({ ...r, playlists: allPlaylists.filter((p) => p.name.toLowerCase().includes(lower)) })
          setFailed(false)
        })
        .catch(() => !cancelled && setFailed(true))
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, server, allPlaylists])

  // Enough of a playlist exclusion to know its identity; songs come on adding.
  const playlistRef = (p: Playlist, id: string): Extract<Exclusion, { kind: 'playlist' }> =>
    ({ kind: 'playlist', name: p.name, songs: [], serverId: id, playlistId: p.id })

  async function togglePlaylist(p: Playlist) {
    if (!server || !serverId) return
    const ref = playlistRef(p, serverId)
    if (excludedIds.has(exclusionId(ref))) {
      remove(exclusionId(ref))
      return
    }
    setBusyPlaylist(p.id)
    try {
      const songs = await getPlaylistSongs(server, p.id)
      toggle({ ...ref, songs: songs.map((s) => ({ artist: s.artist, title: s.title })) })
    } catch {
      setFailed(true)
    } finally {
      setBusyPlaylist(null)
    }
  }

  const empty =
    results &&
    !results.artists.length &&
    !results.albums.length &&
    !results.songs.length &&
    !results.playlists.length

  return (
    <Layout>
      <header className="flex items-center gap-3 py-4">
        <button className="text-slate-400" onClick={() => navigate('/setup')} aria-label={t.a11y.back}>
          ←
        </button>
        <h1 className="text-xl font-bold">{t.exclusions.title}</h1>
      </header>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto pb-4">
        <p className="text-sm text-slate-400">{t.exclusions.intro}</p>

        <input
          type="search"
          className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 outline-none focus:border-brand-500"
          placeholder={t.exclusions.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={!server}
        />

        {failed && <p className="text-sm text-red-400">{t.exclusions.searchFailed}</p>}
        {empty && <p className="text-sm text-slate-500">{t.exclusions.noResults}</p>}

        {results && (
          <>
            <ResultGroup title={t.exclusions.artists}>
              {results.artists.map((a) => {
                const e: Exclusion = { kind: 'artist', name: a.name }
                return (
                  <ResultRow key={a.id} title={a.name} on={excludedIds.has(exclusionId(e))} onToggle={() => toggle(e)} />
                )
              })}
            </ResultGroup>
            <ResultGroup title={t.exclusions.albums}>
              {results.albums.map((a) => {
                const e: Exclusion = { kind: 'album', name: a.name, artist: a.artist }
                return (
                  <ResultRow
                    key={a.id}
                    title={a.name}
                    sub={a.artist}
                    on={excludedIds.has(exclusionId(e))}
                    onToggle={() => toggle(e)}
                  />
                )
              })}
            </ResultGroup>
            <ResultGroup title={t.exclusions.songs}>
              {results.songs.map((s) => {
                const e: Exclusion = { kind: 'song', title: s.title, artist: s.artist }
                return (
                  <ResultRow
                    key={s.id}
                    title={s.title}
                    sub={s.artist}
                    on={excludedIds.has(exclusionId(e))}
                    onToggle={() => toggle(e)}
                  />
                )
              })}
            </ResultGroup>
            <ResultGroup title={t.exclusions.playlists}>
              {results.playlists.map((p) => (
                <ResultRow
                  key={p.id}
                  title={p.name}
                  sub={t.exclusions.playlistSongs(p.songCount)}
                  on={!!serverId && excludedIds.has(exclusionId(playlistRef(p, serverId)))}
                  busy={busyPlaylist === p.id}
                  onToggle={() => void togglePlaylist(p)}
                />
              ))}
            </ResultGroup>
          </>
        )}

        {!results &&
          (items.length === 0 ? (
            <p className="text-sm text-slate-500">{t.exclusions.empty}</p>
          ) : (
            KINDS.map((kind) => (
              <ResultGroup key={kind} title={kindLabel(t, kind)}>
                {items
                  .filter((e) => e.kind === kind)
                  .map((e) => (
                    <div key={exclusionId(e)} className="flex items-center gap-3 rounded-xl bg-slate-800/60 px-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{describe(e)}</span>
                        {sub(t, e) && <span className="block truncate text-sm text-slate-400">{sub(t, e)}</span>}
                      </span>
                      <button
                        className="px-2 text-slate-500"
                        onClick={() => remove(exclusionId(e))}
                        aria-label={t.exclusions.remove}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
              </ResultGroup>
            ))
          ))}
      </div>
    </Layout>
  )
}

type T = ReturnType<typeof useT>

const KINDS: Array<Exclusion['kind']> = ['artist', 'album', 'song', 'playlist']

function kindLabel(t: T, kind: Exclusion['kind']): string {
  return {
    artist: t.exclusions.artists,
    album: t.exclusions.albums,
    song: t.exclusions.songs,
    playlist: t.exclusions.playlists,
  }[kind]
}

function describe(e: Exclusion): string {
  return e.kind === 'song' ? e.title : e.name
}

function sub(t: T, e: Exclusion): string | undefined {
  if (e.kind === 'song' || e.kind === 'album') return e.artist
  if (e.kind === 'playlist') return t.exclusions.playlistSongs(e.songs.length)
  return undefined
}

function ResultGroup({ title, children }: { title: string; children: React.ReactNode[] }) {
  if (!children.length) return null
  return (
    <section className="flex flex-col gap-1">
      <h2 className="mb-1 text-sm font-semibold text-slate-400">{title}</h2>
      {children}
    </section>
  )
}

function ResultRow(props: { title: string; sub?: string; on: boolean; busy?: boolean; onToggle: () => void }) {
  const t = useT()
  return (
    <div className="flex items-center gap-3 rounded-xl bg-slate-800/60 px-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate">{props.title}</span>
        {props.sub && <span className="block truncate text-sm text-slate-400">{props.sub}</span>}
      </span>
      <button
        className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset ${
          props.on ? 'bg-brand-500/20 text-brand-100 ring-brand-500' : 'bg-slate-800 text-slate-300 ring-slate-700'
        }`}
        aria-pressed={props.on}
        disabled={props.busy}
        onClick={props.onToggle}
      >
        {props.busy ? '…' : props.on ? t.exclusions.excluded : t.exclusions.exclude}
      </button>
    </div>
  )
}

import { useEffect, useRef, useState, type ReactNode } from 'react'

type Notice = {
  id: string
  title: string
  buyer: string
  estimated_value: number | null
  currency: string
  deadline: string | null
  published: string | null
  main_cpv: string
  url: string
}

type Step = { tool: string; args: Record<string, unknown>; result_ids: string[] }

type Turn = {
  question: string
  askedAt: Date
  answeredAt?: Date
  answer?: string
  trace?: Step[]
  notices?: Notice[]
  conversation_id?: string
  error?: string
}

const EXAMPLES = [
  { label: 'Azure alle 500 k€', color: 'bg-sky-400', q: 'Onko viimeisen puolen vuoden aikana tullut Azure-osaamiseen liittyviä kilpailutuksia, joiden arvo on alle 500 000 €?' },
  { label: 'Auki olevat ohjelmistokehitykset', color: 'bg-lime-400', q: 'Mitkä ohjelmistokehityksen tarjouspyynnöt ovat vielä auki?' },
  { label: 'Testausautomaatio', color: 'bg-fuchsia-400', q: 'Löytyykö testausautomaation tai laadunvarmistuksen kilpailutuksia?' },
  { label: 'Hyvinvointialueet', color: 'bg-amber-400', q: 'Onko hyvinvointialueilta tullut tietojärjestelmähankintoja viime kuukausina?' },
]

const eur = (v: number | null) =>
  v == null ? 'Arvo ei tiedossa' : v.toLocaleString('fi-FI', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString('fi-FI') : '–')
const clock = (d?: Date) => (d ? d.toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' }) : '')
const isOpen = (s: string | null) => !!s && new Date(s) > new Date()

/* ---------- icons (inline, stroke = currentColor) ---------- */
const I = {
  logo: <path d="M12 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm0 12a3 3 0 1 1 0 6 3 3 0 0 1 0-6ZM6 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm12 0a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  home: <path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  chat: <path d="M4 5h16v11H8l-4 4z" />,
  folder: <path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />,
  send: <path d="M5 12h14M13 6l6 6-6 6" />,
  copy: <path d="M9 9h10v10H9zM5 15V5h10" />,
  retry: <path d="M4 4v6h6M20 20v-6h-6M5 15a7 7 0 0 0 12 3M19 9A7 7 0 0 0 7 6" />,
  ext: <path d="M14 4h6v6M20 4 10 14M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />,
  steps: <path d="M4 6h16M4 12h10M4 18h6" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
}
function Icon({ d, className = 'size-4' }: { d: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {d}
    </svg>
  )
}

/* ---------- minimal markdown: links, **bold**, line breaks ---------- */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*)/g)
  return (
    <div className="whitespace-pre-wrap leading-relaxed">
      {parts.map((p, i) => {
        const link = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
        if (link)
          return (
            <a key={i} href={link[2]} target="_blank" rel="noreferrer" className="font-medium text-violet-700 underline decoration-violet-300 underline-offset-2 hover:decoration-violet-600">
              {link[1]}
            </a>
          )
        const bold = p.match(/^\*\*([^*]+)\*\*$/)
        if (bold) return <strong key={i}>{bold[1]}</strong>
        return <span key={i}>{p}</span>
      })}
    </div>
  )
}

function BotAvatar() {
  return (
    <div className="grid size-9 shrink-0 place-items-center rounded-full bg-lime-soft text-lime-700">
      <Icon d={I.logo} className="size-4" />
    </div>
  )
}

function UserAvatar() {
  return <div className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-xs font-semibold text-white">SI</div>
}

function NoticeCard({ n }: { n: Notice }) {
  const open = isOpen(n.deadline)
  return (
    <a
      href={n.url}
      target="_blank"
      rel="noreferrer"
      className="group flex flex-col gap-2 rounded-2xl border border-lilac-line bg-lilac-soft p-4 transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="line-clamp-2 text-sm font-semibold text-ink">{n.title}</p>
        <Icon d={I.ext} className="size-4 shrink-0 text-violet-400 group-hover:text-violet-700" />
      </div>
      <p className="line-clamp-1 text-xs text-zinc-500">{n.buyer}</p>
      <div className="mt-auto flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-white px-2 py-0.5 font-medium tabular-nums text-ink">{eur(n.estimated_value)}</span>
        <span className={`rounded-full px-2 py-0.5 font-medium ${open ? 'bg-lime-soft text-lime-800' : 'bg-zinc-200 text-zinc-600'}`}>
          {open ? 'Auki' : 'Päättynyt'} · {day(n.deadline)}
        </span>
        <span className="text-zinc-400">HILMA {n.id}</span>
      </div>
    </a>
  )
}

function Thinking() {
  return (
    <div className="flex items-center gap-1 rounded-2xl border border-zinc-200 bg-white px-4 py-3">
      {[0, 150, 300].map((d) => (
        <span key={d} className="size-2 animate-bounce rounded-full bg-zinc-400" style={{ animationDelay: `${d}ms` }} />
      ))}
      <span className="ml-2 text-xs text-zinc-500">Agentti hakee ja lukee ilmoituksia…</span>
    </div>
  )
}

export default function App() {
  const [q, setQ] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)
  const [sidebar, setSidebar] = useState(false)
  const [copied, setCopied] = useState<number | null>(null)
  const bottom = useRef<HTMLDivElement>(null)

  // Braces matter: newer Chromium returns a Promise from scrollIntoView, and React treats any
  // non-function return value from an effect as a broken cleanup and unmounts the app.
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns])

  async function ask(question: string) {
    if (!question.trim() || busy) return
    setBusy(true)
    setQ('')
    setSidebar(false)
    // Foundry keeps the conversation server-side; the local backend needs the history resent.
    const conversation_id = turns.findLast((t) => t.conversation_id)?.conversation_id
    const history = turns
      .filter((t) => t.answer)
      .flatMap((t) => [
        { role: 'user', content: t.question },
        { role: 'assistant', content: t.answer },
      ])
    const askedAt = new Date()
    setTurns((ts) => [...ts, { question, askedAt }])
    try {
      const r = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history, conversation_id }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.detail || (r.status === 500 ? 'Backend ei vastaa (käynnissä portissa 8000?)' : `HTTP ${r.status}`))
      setTurns((ts) => [...ts.slice(0, -1), { question, askedAt, answeredAt: new Date(), ...data }])
    } catch (e) {
      setTurns((ts) => [...ts.slice(0, -1), { question, askedAt, error: e instanceof Error ? e.message : String(e) }])
    } finally {
      setBusy(false)
    }
  }

  function copy(i: number, text: string) {
    navigator.clipboard?.writeText(text)
    setCopied(i)
    setTimeout(() => setCopied(null), 1500)
  }

  const navBtn = 'flex w-full items-center gap-3 rounded-xl bg-panel-2/60 px-3 py-2.5 text-sm text-zinc-300 transition hover:bg-panel-2 hover:text-white'

  return (
    <div className="flex h-full gap-2 p-2">
      {/* ---------- sidebar ---------- */}
      <aside
        className={`${sidebar ? 'fixed inset-2 z-20 flex' : 'hidden'} w-72 shrink-0 flex-col gap-5 overflow-y-auto rounded-3xl bg-panel p-4 text-zinc-300 md:static md:flex`}
      >
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2 text-white">
            <Icon d={I.logo} className="size-6" />
            <span className="text-sm font-semibold tracking-wide">HILMA</span>
          </div>
          <button className="rounded-lg p-1 text-zinc-400 hover:text-white md:hidden" onClick={() => setSidebar(false)} aria-label="Sulje valikko">
            ✕
          </button>
        </div>

        <div className="space-y-2">
          <button className={navBtn} onClick={() => setTurns([])}>
            <Icon d={I.plus} /> Uusi keskustelu
          </button>
        </div>

        <div className="space-y-2">
          <button className={navBtn} onClick={() => setTurns([])}>
            <Icon d={I.home} /> Etusivu
          </button>
          <div className={navBtn}>
            <Icon d={I.chat} /> Keskustelut <span className="ml-auto text-xs text-zinc-500">{turns.length}</span>
          </div>
        </div>

        <section>
          <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wider text-zinc-500">Tallennetut haut</p>
          <div className="space-y-1.5">
            {EXAMPLES.map((e) => (
              <button key={e.label} onClick={() => ask(e.q)} disabled={busy} className="group relative flex w-full items-center gap-3 overflow-hidden rounded-xl bg-panel-2/60 py-2.5 pl-4 pr-3 text-left text-sm transition hover:bg-panel-2 hover:text-white disabled:opacity-50">
                <span className={`absolute inset-y-2 left-0 w-1 rounded-full ${e.color}`} />
                <Icon d={I.folder} className="size-4 text-zinc-500" />
                <span className="truncate">{e.label}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="min-h-0 flex-1">
          <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wider text-zinc-500">Tänään</p>
          {turns.length === 0 ? (
            <p className="px-1 text-xs text-zinc-600">Ei vielä kysymyksiä.</p>
          ) : (
            <div className="space-y-1.5">
              {turns.map((t, i) => (
                <button
                  key={i}
                  onClick={() => document.getElementById(`turn-${i}`)?.scrollIntoView({ behavior: 'smooth' })}
                  className="flex w-full items-center gap-3 rounded-xl bg-panel-2/60 px-3 py-2.5 text-left text-sm transition hover:bg-panel-2 hover:text-white"
                >
                  <Icon d={I.chat} className="size-4 shrink-0 text-zinc-500" />
                  <span className="truncate [mask-image:linear-gradient(90deg,#000_75%,transparent)]">{t.question}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <p className="px-1 text-[11px] leading-snug text-zinc-600">ICT- ja konsultointi-ilmoitukset HILMAsta, viimeiset 12 kk · Azure AI Search + Foundry Agent Service</p>
      </aside>

      {/* ---------- main ---------- */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-3xl bg-white">
        <header className="flex items-center justify-between gap-3 border-b border-zinc-100 px-5 py-4 md:px-8">
          <div className="flex items-center gap-3">
            <button className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 md:hidden" onClick={() => setSidebar(true)} aria-label="Avaa valikko">
              <Icon d={I.menu} className="size-5" />
            </button>
            <h1 className="text-xl font-bold tracking-tight">
              Tarjouspyyntö<span className="text-violet-600">tutka</span>
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-2 rounded-full bg-lime-soft px-4 py-2 text-sm font-medium text-lime-900 sm:flex">
              <span className="size-2 rounded-full bg-lime-500" /> 1 150 ilmoitusta
            </span>
            <button onClick={() => setTurns([])} className="flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800">
              <Icon d={I.plus} /> Uusi
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8">
          <div className="mx-auto flex max-w-4xl flex-col gap-6">
            {/* greeting */}
            <div className="flex items-start gap-3">
              <BotAvatar />
              <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm">
                Hei! Olen Tarjouspyyntötutka. Kysy julkisista ICT-hankinnoista suomeksi, niin etsin, luen ja perustelen, lähdeviitteineen.
              </div>
            </div>

            {turns.length === 0 && (
              <div className="grid gap-3 pl-12 sm:grid-cols-2">
                {EXAMPLES.map((e) => (
                  <button key={e.label} onClick={() => ask(e.q)} className="rounded-2xl border border-zinc-200 p-4 text-left text-sm text-zinc-700 transition hover:border-violet-300 hover:bg-lilac-soft">
                    <span className={`mb-2 block h-1 w-8 rounded-full ${e.color}`} />
                    {e.q}
                  </button>
                ))}
              </div>
            )}

            {turns.map((t, i) => (
              <div key={i} id={`turn-${i}`} className="flex flex-col gap-6">
                {/* user bubble */}
                <div className="flex items-start justify-end gap-3">
                  <div className="max-w-[80%] rounded-2xl border border-lilac-line bg-lilac-soft px-4 py-3 text-sm">
                    <p>{t.question}</p>
                    <p className="mt-1 text-right text-[11px] text-zinc-400">{clock(t.askedAt)}</p>
                  </div>
                  <UserAvatar />
                </div>

                {/* assistant */}
                <div className="flex items-start gap-3">
                  <BotAvatar />
                  <div className="min-w-0 flex-1 space-y-3">
                    {!t.answer && !t.error && <Thinking />}

                    {t.error && (
                      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                        <p className="font-medium">Kysely epäonnistui</p>
                        <p className="mt-1 break-words text-red-700">{t.error}</p>
                        <button onClick={() => ask(t.question)} disabled={busy} className="mt-2 text-xs font-medium underline">
                          Yritä uudelleen
                        </button>
                      </div>
                    )}

                    {t.answer && (
                      <>
                        <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-800">
                          <Rich text={t.answer} />
                          <p className="mt-2 text-right text-[11px] text-zinc-400">{clock(t.answeredAt)}</p>
                        </div>

                        {t.notices && t.notices.length > 0 && (
                          <div className="grid gap-3 sm:grid-cols-2">
                            {t.notices.map((n) => (
                              <NoticeCard key={n.id} n={n} />
                            ))}
                          </div>
                        )}

                        <div className="flex items-center gap-1 text-zinc-400">
                          <button onClick={() => ask(t.question)} disabled={busy} className="rounded-lg p-1.5 hover:bg-zinc-100 hover:text-zinc-700" title="Kysy uudelleen">
                            <Icon d={I.retry} />
                          </button>
                          <button onClick={() => copy(i, t.answer!)} className="rounded-lg p-1.5 hover:bg-zinc-100 hover:text-zinc-700" title="Kopioi vastaus">
                            <Icon d={I.copy} />
                          </button>
                          {copied === i && <span className="text-xs text-lime-700">Kopioitu</span>}
                          {t.trace && t.trace.length > 0 && (
                            <details className="ml-2 text-xs">
                              <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-1.5 py-1 hover:bg-zinc-100 hover:text-zinc-700">
                                <Icon d={I.steps} className="size-3.5" /> {t.trace.length} työvaihetta
                              </summary>
                              <ol className="mt-2 space-y-1 rounded-xl bg-zinc-50 p-3 font-mono text-[11px] text-zinc-600">
                                {t.trace.map((s, j) => (
                                  <li key={j} className="break-all">
                                    <span className="text-violet-700">{s.tool}</span> {JSON.stringify(s.args)} → {s.result_ids.length}
                                  </li>
                                ))}
                              </ol>
                            </details>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
            <div ref={bottom} />
          </div>
        </div>

        {/* composer */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            ask(q)
          }}
          className="px-4 pb-5 md:px-8"
        >
          <div className="mx-auto flex max-w-4xl items-center gap-3 rounded-full border border-zinc-200 bg-zinc-50 p-2 shadow-sm focus-within:border-violet-300 focus-within:bg-white">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-white">
              <Icon d={I.logo} />
            </span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Kysy hankinnoista suomeksi…"
              disabled={busy}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400"
            />
            <button
              disabled={busy || !q.trim()}
              className="grid size-10 shrink-0 place-items-center rounded-full bg-lime-accent text-ink transition hover:brightness-95 disabled:opacity-40"
              aria-label="Lähetä"
            >
              <Icon d={I.send} className="size-5" />
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}

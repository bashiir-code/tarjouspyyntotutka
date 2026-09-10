import { useState } from 'react'
import './App.css'

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
  answer?: string
  trace?: Step[]
  notices?: Notice[]
  conversation_id?: string
  error?: string
}

const EXAMPLES = [
  'Onko viimeisen puolen vuoden aikana tullut Azure-osaamiseen liittyviä kilpailutuksia, joiden arvo on alle 500 000 €?',
  'Mitkä ohjelmistokehityksen tarjouspyynnöt ovat vielä auki?',
  'Löytyykö testausautomaation tai laadunvarmistuksen kilpailutuksia hyvinvointialueilta?',
]

const eur = (v: number | null) =>
  v == null ? 'ei ilmoitettu' : v.toLocaleString('fi-FI', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString('fi-FI') : '–')

// Render agent markdown links [text](url) as anchors; everything else as plain text.
function Answer({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\))/g)
  return (
    <div className="answer">
      {parts.map((p, i) => {
        const m = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
        return m ? (
          <a key={i} href={m[2]} target="_blank" rel="noreferrer">
            {m[1]}
          </a>
        ) : (
          <span key={i}>{p}</span>
        )
      })}
    </div>
  )
}

export default function App() {
  const [q, setQ] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)

  async function ask(question: string) {
    if (!question.trim() || busy) return
    setBusy(true)
    setQ('')
    // Foundry keeps the conversation server-side; the local backend needs the history resent.
    const conversation_id = turns.findLast((t) => t.conversation_id)?.conversation_id
    const history = turns
      .filter((t) => t.answer)
      .flatMap((t) => [
        { role: 'user', content: t.question },
        { role: 'assistant', content: t.answer },
      ])
    setTurns((ts) => [...ts, { question }])
    try {
      const r = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history, conversation_id }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      setTurns((ts) => [...ts.slice(0, -1), { question, ...data }])
    } catch (e) {
      setTurns((ts) => [...ts.slice(0, -1), { question, error: String(e) }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <main>
      <header>
        <h1>Tarjouspyyntötutka</h1>
        <p>HILMA-ilmoitukset · ICT ja konsultointi · viimeiset 12 kk</p>
      </header>

      {turns.length === 0 && (
        <section className="examples">
          {EXAMPLES.map((e) => (
            <button key={e} onClick={() => ask(e)}>
              {e}
            </button>
          ))}
        </section>
      )}

      {turns.map((t, i) => (
        <article key={i} className="turn">
          <p className="question">{t.question}</p>
          {!t.answer && !t.error && <p className="muted">Agentti hakee ja lukee ilmoituksia…</p>}
          {t.error && <p className="error">Virhe: {t.error}</p>}
          {t.answer && <Answer text={t.answer} />}
          {t.notices && t.notices.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Ilmoitus</th>
                    <th>Hankintayksikkö</th>
                    <th>Arvo</th>
                    <th>Määräaika</th>
                  </tr>
                </thead>
                <tbody>
                  {t.notices.map((n) => (
                    <tr key={n.id}>
                      <td>
                        <a href={n.url} target="_blank" rel="noreferrer">
                          {n.title}
                        </a>
                        <small>HILMA {n.id} · CPV {n.main_cpv}</small>
                      </td>
                      <td>{n.buyer}</td>
                      <td className="num">{eur(n.estimated_value)}</td>
                      <td>{day(n.deadline)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {t.trace && t.trace.length > 0 && (
            <details>
              <summary>Agentin työvaiheet ({t.trace.length})</summary>
              <ol>
                {t.trace.map((s, j) => (
                  <li key={j}>
                    <code>{s.tool}</code> {JSON.stringify(s.args)} → {s.result_ids.length} tulosta
                  </li>
                ))}
              </ol>
            </details>
          )}
        </article>
      ))}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          ask(q)
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Kysy hankinnoista suomeksi…" disabled={busy} />
        <button disabled={busy || !q.trim()}>{busy ? '…' : 'Kysy'}</button>
      </form>
    </main>
  )
}

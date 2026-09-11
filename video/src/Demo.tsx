import type { CSSProperties, ReactNode } from 'react'
import { AbsoluteFill, Easing, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import events from './events.json'

export const FPS = 30

// Event timestamps (ms into the real recording) written by record.cjs.
const at = (name: string) => {
  const e = events.find((x) => x.name === name)
  if (!e) throw new Error(`missing event ${name}`)
  return e.ms
}

type Segment = {
  from: number // ms in recording
  to: number
  rate?: number // >1 = fast-forward (agent working)
  step: string
  caption: string
  detail?: string
}

// Real time 1x everywhere except while the agent works; that part is sped up and labelled as such.
const SEGMENTS: Segment[] = [
  { from: at('loaded') + 400, to: at('sent1') + 900, step: '1', caption: 'Kysymys suomeksi', detail: 'rajaukset: aikaväli + arvo alle 500 000 €' },
  { from: at('sent1') + 900, to: at('answer1'), rate: 32, step: '2', caption: 'Agentti hakee ja lukee ilmoituksia', detail: 'hybridihaku (BM25 fi + vektori) + semantic ranker · Foundry Agent Service' },
  { from: at('answer1'), to: at('done1'), step: '3', caption: 'Vastaus lähdeviitteineen', detail: 'jokainen väite viittaa HILMA-ilmoitukseen · arvo, määräaika, perustelu' },
  { from: at('type2') - 300, to: at('sent2') + 900, step: '4', caption: 'Jatkokysymys samassa keskustelussa', detail: 'keskusteluhistoria säilyy Foundryssa' },
  { from: at('sent2') + 900, to: at('answer2'), rate: 20, step: '5', caption: 'Sopivuusarvio kyvykkyysprofiilia vasten', detail: 'assess_fit-työkalu: pisteet, osaamisaukot, riskit' },
  { from: at('answer2'), to: at('end'), step: '5', caption: 'Sopivuusarvio kyvykkyysprofiilia vasten', detail: 'assess_fit-työkalu: pisteet, osaamisaukot, riskit' },
]

const INTRO = 3.2 * FPS
const OUTRO = 5 * FPS
const msToFrames = (ms: number) => Math.round((ms / 1000) * FPS)
const segFrames = (s: Segment) => Math.round(msToFrames(s.to - s.from) / (s.rate ?? 1))
const TIMELINE = SEGMENTS.reduce<{ seg: Segment; start: number; dur: number }[]>((acc, seg) => {
  const start = acc.length ? acc[acc.length - 1].start + acc[acc.length - 1].dur : INTRO
  return [...acc, { seg, start, dur: segFrames(seg) }]
}, [])
const SESSION_END = TIMELINE[TIMELINE.length - 1].start + TIMELINE[TIMELINE.length - 1].dur
export const totalFrames = SESSION_END + OUTRO

/* ---------------- styling ---------------- */
const INK = '#16161a'
const LIME = '#b6ec7a'
const LILAC = '#8b5cf6'
const font: CSSProperties = { fontFamily: 'Inter, "Segoe UI", system-ui, sans-serif' }
const bg: CSSProperties = {
  background: 'radial-gradient(1200px 700px at 15% 0%, #2a2540 0%, transparent 60%), radial-gradient(900px 600px at 100% 100%, #1f3320 0%, transparent 55%), #0c0c0f',
}

function useEnter(delay = 0) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: 18 })
}

function Chip({ children, color = 'rgba(255,255,255,.08)', text = '#e4e4e7' }: { children: ReactNode; color?: string; text?: string }) {
  return <span style={{ background: color, color: text, padding: '10px 18px', borderRadius: 999, fontSize: 22, fontWeight: 500 }}>{children}</span>
}

/* ---------------- intro / outro ---------------- */
function Intro() {
  const a = useEnter(4)
  const b = useEnter(14)
  const frame = useCurrentFrame()
  const out = interpolate(frame, [INTRO - 10, INTRO], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <AbsoluteFill style={{ ...bg, ...font, justifyContent: 'center', alignItems: 'center', opacity: out }}>
      <div style={{ textAlign: 'center', transform: `translateY(${(1 - a) * 30}px)`, opacity: a }}>
        <div style={{ color: '#a1a1aa', fontSize: 28, letterSpacing: 6, textTransform: 'uppercase', marginBottom: 20 }}>HILMA · julkiset hankinnat</div>
        <div style={{ color: 'white', fontSize: 120, fontWeight: 800, letterSpacing: -3 }}>
          Tarjouspyyntö<span style={{ color: LILAC }}>tutka</span>
        </div>
        <div style={{ color: '#d4d4d8', fontSize: 36, marginTop: 16 }}>Kysy suomeksi, saat vastauksen lähdeviitteineen</div>
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 56, opacity: b, transform: `translateY(${(1 - b) * 20}px)` }}>
        <Chip>1 150 ICT-ilmoitusta · 12 kk</Chip>
        <Chip>Azure AI Search · hybridihaku</Chip>
        <Chip color={LIME} text={INK}>Foundry Agent Service</Chip>
      </div>
    </AbsoluteFill>
  )
}

function Metric({ label, value, highlight = false, delay }: { label: string; value: string; highlight?: boolean; delay: number }) {
  const e = useEnter(delay)
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 40, padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,.08)', opacity: e, transform: `translateX(${(1 - e) * 20}px)` }}>
      <span style={{ color: highlight ? 'white' : '#a1a1aa', fontSize: 28, fontWeight: highlight ? 600 : 400 }}>{label}</span>
      <span style={{ color: highlight ? LIME : '#e4e4e7', fontSize: 30, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}

function Outro() {
  const a = useEnter(0)
  return (
    <AbsoluteFill style={{ ...bg, ...font, justifyContent: 'center', alignItems: 'center', opacity: a }}>
      <div style={{ display: 'flex', gap: 80, alignItems: 'flex-start' }}>
        <div style={{ width: 640 }}>
          <div style={{ color: '#a1a1aa', fontSize: 24, letterSpacing: 4, textTransform: 'uppercase', marginBottom: 12 }}>Haun osuvuus · R@5</div>
          <div style={{ color: '#71717a', fontSize: 20, marginBottom: 16 }}>30 known-item-kysymystä, eri taivutusmuodot</div>
          <Metric label="BM25 (fi.microsoft)" value="0.80" delay={6} />
          <Metric label="Pelkkä vektori" value="0.77–0.80" delay={10} />
          <Metric label="Hybridi" value="0.77" delay={14} />
          <Metric label="Hybridi + semantic ranker" value="0.93" highlight delay={18} />
        </div>
        <div style={{ width: 560 }}>
          <div style={{ color: '#a1a1aa', fontSize: 24, letterSpacing: 4, textTransform: 'uppercase', marginBottom: 12 }}>Agentin luotettavuus</div>
          <div style={{ color: '#71717a', fontSize: 20, marginBottom: 16 }}>tarkistetaan jokaisessa ajossa</div>
          <Metric label="Viitteet aitoja ja haettuja" value="1.00" highlight delay={22} />
          <Metric label="Käyttäjän arvoraja pidetään" value="1.00" highlight delay={26} />
          <Metric label="Eval ajetaan CI:ssä" value="✓" delay={30} />
        </div>
      </div>
      <div style={{ color: '#71717a', fontSize: 24, marginTop: 64, opacity: useEnter(36) }}>github.com/bashiir-code/tarjouspyyntotutka</div>
    </AbsoluteFill>
  )
}

/* ---------------- session ---------------- */
const WIN_X = 240
const WIN_Y = 150 // leaves room above the window for the two-line caption
const BAR = 34

function Caption({ seg }: { seg: Segment }) {
  const e = useEnter(0)
  return (
    <div style={{ position: 'absolute', left: WIN_X, top: 30, display: 'flex', alignItems: 'center', gap: 18, opacity: e, transform: `translateY(${(1 - e) * -12}px)` }}>
      <span style={{ display: 'grid', placeItems: 'center', width: 52, height: 52, borderRadius: 999, background: LIME, color: INK, fontSize: 26, fontWeight: 800 }}>{seg.step}</span>
      <div>
        <div style={{ color: 'white', fontSize: 32, fontWeight: 700, lineHeight: 1.1 }}>{seg.caption}</div>
        {seg.detail && <div style={{ color: '#a1a1aa', fontSize: 20, marginTop: 4 }}>{seg.detail}</div>}
      </div>
    </div>
  )
}

function FastForward({ seg, dur }: { seg: Segment; dur: number }) {
  const frame = useCurrentFrame()
  const realSeconds = interpolate(frame, [0, dur], [0, (seg.to - seg.from) / 1000], { extrapolateRight: 'clamp' })
  const e = useEnter(0)
  return (
    <div
      style={{
        position: 'absolute', right: WIN_X, top: 38, display: 'flex', alignItems: 'center', gap: 12,
        background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 999, padding: '10px 20px',
        color: '#e4e4e7', fontSize: 22, fontVariantNumeric: 'tabular-nums', opacity: e,
      }}
    >
      <span style={{ color: LIME, fontWeight: 800 }}>⏩ {seg.rate}×</span>
      <span>agentti työskentelee · {realSeconds.toFixed(0)} s</span>
    </div>
  )
}

function Window({ children }: { children: ReactNode }) {
  return (
    <div style={{ position: 'absolute', left: WIN_X, top: WIN_Y - BAR, width: 1440, height: 900 + BAR, borderRadius: 18, overflow: 'hidden', boxShadow: '0 40px 120px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.08)', background: '#000' }}>
      <div style={{ height: BAR, background: '#1c1c21', display: 'flex', alignItems: 'center', padding: '0 14px', gap: 8 }}>
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
          <span key={c} style={{ width: 12, height: 12, borderRadius: 99, background: c }} />
        ))}
        <span style={{ margin: '0 auto', color: '#a1a1aa', fontSize: 15, background: '#2a2a31', padding: '4px 60px', borderRadius: 8 }}>localhost:5173</span>
      </div>
      <div style={{ position: 'relative', width: 1440, height: 900 }}>{children}</div>
    </div>
  )
}

function Session() {
  const frame = useCurrentFrame()
  // Window settles in from slightly smaller when the session starts.
  const scale = interpolate(frame, [0, 30], [0.96, 1], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })
  return (
    <AbsoluteFill style={{ ...bg, ...font }}>
      <div style={{ position: 'absolute', inset: 0, transform: `scale(${scale})`, transformOrigin: '50% 55%' }}>
        <Window>
          {TIMELINE.map(({ seg, start, dur }, i) => (
            <Sequence key={i} from={start - INTRO} durationInFrames={dur} layout="none">
              <OffthreadVideo
                src={staticFile('session.mp4')}
                trimBefore={msToFrames(seg.from)}
                playbackRate={seg.rate ?? 1}
                muted
                style={{ position: 'absolute', inset: 0, width: 1440, height: 900 }}
              />
            </Sequence>
          ))}
        </Window>
      </div>
      {TIMELINE.map(({ seg, start, dur }, i) => {
        const prev = TIMELINE[i - 1]
        const sameCaption = prev && prev.seg.caption === seg.caption
        return (
          <Sequence key={`c${i}`} from={start - INTRO} durationInFrames={dur} layout="none">
            {!sameCaption && <Caption seg={seg} />}
            {sameCaption && <CaptionStatic seg={seg} />}
            {seg.rate && <FastForward seg={seg} dur={dur} />}
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}

// Continuation of the previous caption (no re-entry animation).
function CaptionStatic({ seg }: { seg: Segment }) {
  return (
    <div style={{ position: 'absolute', left: WIN_X, top: 30, display: 'flex', alignItems: 'center', gap: 18 }}>
      <span style={{ display: 'grid', placeItems: 'center', width: 52, height: 52, borderRadius: 999, background: LIME, color: INK, fontSize: 26, fontWeight: 800 }}>{seg.step}</span>
      <div>
        <div style={{ color: 'white', fontSize: 32, fontWeight: 700, lineHeight: 1.1 }}>{seg.caption}</div>
        {seg.detail && <div style={{ color: '#a1a1aa', fontSize: 20, marginTop: 4 }}>{seg.detail}</div>}
      </div>
    </div>
  )
}

export function Demo() {
  return (
    <AbsoluteFill style={{ background: '#0c0c0f' }}>
      <Sequence durationInFrames={INTRO}>
        <Intro />
      </Sequence>
      <Sequence from={INTRO} durationInFrames={SESSION_END - INTRO}>
        <Session />
      </Sequence>
      <Sequence from={SESSION_END} durationInFrames={OUTRO}>
        <Outro />
      </Sequence>
    </AbsoluteFill>
  )
}

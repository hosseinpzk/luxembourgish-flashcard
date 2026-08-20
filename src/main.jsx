import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

const CORE_CATEGORIES = ['All','A1','A2','B1','Family','Travel','Work','Food','Home','Health','School','Shopping','Time','Nature','People','Transport','Sports']

function norm(s='') { return s.toLocaleLowerCase('lb-LU').normalize('NFKC').trim() }

function App() {
  const [cards, setCards] = useState([])
  const [meta, setMeta] = useState(null)
  const [category, setCategory] = useState('All')
  const [query, setQuery] = useState('')
  const [idx, setIdx] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [learned, setLearned] = useState(() => new Set(JSON.parse(localStorage.getItem('lod-learned') || '[]')))
  const [audioReady, setAudioReady] = useState(false)
  const audioRef = useRef(null)

  useEffect(() => {
    Promise.all([
      fetch(`${import.meta.env.BASE_URL}data/lod-cards.json`).then(r => r.ok ? r.json() : []),
      fetch(`${import.meta.env.BASE_URL}data/lod-meta.json`).then(r => r.ok ? r.json() : null).catch(() => null)
    ]).then(([c,m]) => { setCards(c); setMeta(m) })
  }, [])

  const availableCore = useMemo(() => CORE_CATEGORIES.filter(c => {
    if (c === 'All') return true
    if (['A1','A2','B1'].includes(c)) return cards.some(x => x.levels?.includes(c))
    return cards.some(x => x.studyTopics?.includes(c))
  }), [cards])

  const extraLodTopics = useMemo(() => {
    const counts = new Map()
    cards.forEach(c => (c.lodCategories || []).forEach(x => counts.set(x.name, (counts.get(x.name)||0)+1)))
    return [...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,60)
  }, [cards])

  const filtered = useMemo(() => {
    const q = norm(query)
    return cards.filter(c => {
      const categoryMatch = category === 'All'
        || ['A1','A2','B1'].includes(category) && c.levels?.includes(category)
        || c.studyTopics?.includes(category)
        || c.lodCategories?.some(x => x.name === category)
      if (!categoryMatch) return false
      if (!q) return true
      return norm(`${c.lb} ${c.en} ${c.ipa || ''}`).includes(q)
    })
  }, [cards, category, query])

  useEffect(() => { setIdx(0); setRevealed(false) }, [category, query])
  useEffect(() => { setRevealed(false); setAudioReady(false) }, [idx, filtered])

  const card = filtered[idx] || null

  useEffect(() => {
    if (!card?.audioUrl) { setAudioReady(false); return }
    const a = new Audio()
    audioRef.current = a
    let triedFallback = false
    const ready = () => setAudioReady(true)
    const bad = () => {
      if (!triedFallback && card.audioFallback) {
        triedFallback = true
        a.src = card.audioFallback
        a.load()
      } else setAudioReady(false)
    }
    a.preload = 'metadata'
    a.addEventListener('canplay', ready)
    a.addEventListener('error', bad)
    a.src = card.audioUrl
    a.load()
    return () => { a.removeEventListener('canplay', ready); a.removeEventListener('error', bad); a.pause(); a.src=''; audioRef.current=null }
  }, [card?.id, card?.audioUrl, card?.audioFallback])

  function move(delta) {
    if (!filtered.length) return
    setIdx(i => (i + delta + filtered.length) % filtered.length)
  }
  function shuffle() {
    if (filtered.length < 2) return
    let next = idx
    while (next === idx) next = Math.floor(Math.random()*filtered.length)
    setIdx(next)
  }
  function toggleLearned() {
    if (!card) return
    const n = new Set(learned)
    n.has(card.id) ? n.delete(card.id) : n.add(card.id)
    setLearned(n)
    localStorage.setItem('lod-learned', JSON.stringify([...n]))
  }
  function resetProgress() {
    if (!learned.size) return
    if (!window.confirm('Reset all learning progress? This will mark every card as not learned.')) return
    setLearned(new Set())
    localStorage.removeItem('lod-learned')
  }
  function playAudio(e) {
    e.stopPropagation()
    if (audioReady && audioRef.current) { audioRef.current.currentTime=0; audioRef.current.play().catch(()=>{}) }
  }

  useEffect(() => {
    const key = e => {
      if (e.target.matches('input,select,textarea')) return
      if (e.code === 'Space') { e.preventDefault(); setRevealed(v=>!v) }
      if (e.key === 'ArrowRight') move(1)
      if (e.key === 'ArrowLeft') move(-1)
      if (e.key === 'ArrowUp') playAudio(e)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  return <main className="app">
    <header className="hero">
      <div>
        <div className="eyebrow">OFFICIAL LOD DATA • LËTZEBUERGESCH → ENGLISH</div>
        <h1>Luxembourgish Flashcards</h1>
        <p>Learn from the complete LOD dataset. Official LOD audio only — no text-to-speech.</p>
        <p><b></b>USE -> key for next, <- key for previous, ^ up key for play sound, and space key to reveal.</b></p>
      </div>
      <div className="stats">
        <div><strong>{cards.length.toLocaleString()}</strong><span>cards</span></div>
        <div><strong>{learned.size.toLocaleString()}</strong><span>learned</span></div>
        <div><strong>{meta?.audioCount?.toLocaleString?.() ?? '—'}</strong><span>official audio</span></div>
      </div>
    </header>

    <section className="toolbar panel">
      <div className="chips">
        {availableCore.map(c => <button key={c} className={category===c?'chip active':'chip'} onClick={()=>setCategory(c)}>{c}</button>)}
      </div>
      <div className="tools">
        <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search Luxembourgish or English…" />
        {!!extraLodTopics.length && <select value={extraLodTopics.some(([n])=>n===category)?category:''} onChange={e=>e.target.value && setCategory(e.target.value)}>
          <option value="">More LOD topics…</option>
          {extraLodTopics.map(([n,c]) => <option key={n} value={n}>{n} ({c})</option>)}
        </select>}
      </div>
    </section>

    {!card ? <section className="empty panel">
      <h2>{cards.length ? 'No cards in this filter' : 'LOD data not synced yet'}</h2>
      <p>{cards.length ? 'Try another category or search.' : 'Run: npm run sync:lod'}</p>
    </section> : <>
      <section className={`flashcard ${revealed?'revealed':''}`} onClick={()=>setRevealed(v=>!v)}>
        <div className="cardtop">
          <div className="badges">
            {(card.levels||[]).map(x=><span className="badge level" key={x}>{x}</span>)}
            {card.pos && <span className="badge">{card.pos}</span>}
          </div>
          {audioReady && <button className="audio" onClick={playAudio} aria-label="Play official LOD pronunciation">🔊 <span>LOD audio</span></button>}
        </div>
        <div className="front">
          <div className="language">LËTZEBUERGESCH</div>
          <div className="word">{card.lb}</div>
          {card.ipa && <div className="ipa">{card.ipa}</div>}
        </div>
        <div className="divider" />
        <div className="answer">
          {revealed ? <>
            <div className="language">ENGLISH</div>
            <div className="meaning">{card.en}</div>
            {!!card.examples?.length && <div className="exampleBox">
              <div className="exampleLabel">LOD {card.examples.length > 1 ? 'EXAMPLES' : 'EXAMPLE'}</div>
              <div className="exampleList">
                {card.examples.slice(0,3).map((example,i)=><div className="exampleSentence" key={`${card.id}-example-${i}`}>{example}</div>)}
              </div>
            </div>}
            {!!card.lodCategories?.length && <div className="sourceTags">{card.lodCategories.slice(0,5).map(x=><span key={x.code}>{x.name}</span>)}</div>}
          </> : <button className="reveal">Reveal answer</button>}
        </div>
        <div className="hint">Click card or press Space</div>
      </section>

      <section className="controls">
        <button onClick={()=>move(-1)}>← Previous</button>
        <div className="counter">{(idx+1).toLocaleString()} / {filtered.length.toLocaleString()}</div>
        <button onClick={()=>move(1)}>Next →</button>
      </section>
      <section className="secondary">
        <button onClick={shuffle}>⤨ Shuffle</button>
        <button className={learned.has(card.id)?'learned':''} onClick={toggleLearned}>{learned.has(card.id)?'✓ Learned':'Mark learned'}</button>
        <button className="resetProgress" onClick={resetProgress} disabled={!learned.size}>↺ Reset progress</button>
        <a href={card.lodUrl} target="_blank" rel="noreferrer">Open in LOD ↗</a>
      </section>
    </>}

    <footer>
      <div className="footerSource">
        Vocabulary, translations, phonetics and audio references come from LOD / Zenter fir d'Lëtzebuerger Sprooch. Audio is only exposed when the official LOD file successfully loads.
      </div>
      <div className="footerCredit">
        <span>Built by <strong>Hossein Pazouki</strong></span>
        <span className="footerDot">•</span>
        <a href="https://github.com/hosseinpzk" target="_blank" rel="noreferrer">GitHub ↗</a>
        <span className="footerDot">•</span>
        <a href="https://hosseinpzk.github.io/portfolio" target="_blank" rel="noreferrer">Portfolio ↗</a>
      </div>
    </footer>
  </main>
}

createRoot(document.getElementById('root')).render(<App />)

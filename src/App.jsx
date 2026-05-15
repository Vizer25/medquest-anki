import { createClient } from '@supabase/supabase-js'
import { useEffect, useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import {
  Trophy, XCircle, Flame, Target, Star, LogOut, Lock, RotateCcw, Upload,
  CheckCircle2, Eye, CalendarDays, ListChecks, Clock, Settings, ImageIcon,
  Brain, BarChart3, Plus, Download
} from 'lucide-react'
const supabase = createClient(
  'https://lgmfmdpzmqunouysuwjp.supabase.co',
  'sb_publishable_q0Kj-XQCbt89nVlQPdsG3A_pJPvVP-7'
)
const DAY = 24 * 60 * 60 * 1000

const DEFAULT_CONFIG = {
  againMinutes: 10,
  hardMinutes: 30,
  goodDays: 1,
  easyDays: 4,
  dailyGoal: 100
}

const DEFAULT_STATS = {
  xp: 0,
  level: 1,
  correct: 0,
  wrong: 0,
  streak: 0,
  record: 0,
  daily: {},
  studyStreak: 0,
  lastStudyDate: '',
  history: [],
  totalAnswerSeconds: 0,
  fastestSeconds: null,
  slowestSeconds: 0,
  byGrade: { again: 0, hard: 0, good: 0, easy: 0 }
}

const DEFAULT_CARDS = [
  {
    id: 'default-1',
    pergunta: 'Qual é a conduta no megacólon tóxico por retocolite ulcerativa com indicação cirúrgica?',
    resposta: 'Colectomia total com ileostomia e preservação do reto.',
    htmlFront: 'Qual é a conduta no megacólon tóxico por retocolite ulcerativa com indicação cirúrgica?',
    htmlBack: 'Colectomia total com ileostomia e preservação do reto.',
    dueAt: Date.now(),
    reps: 0,
    interval: 0,
    ease: 2500,
    palavras: ['colectomia', 'ileostomia', 'reto']
  }
]

function formatTime(totalSeconds) {
  const n = Number(totalSeconds || 0)
  const h = Math.floor(n / 3600)
  const m = Math.floor((n % 3600) / 60)
  const s = n % 60
  if (h > 0) return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
}

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripHtml(text) {
  const div = document.createElement('div')
  div.innerHTML = String(text || '')
  return (div.textContent || div.innerText || '').replace(/\s+/g, ' ').trim()
}

function decodeHtmlEntities(value) {
  const div = document.createElement('div')
  div.innerHTML = String(value || '')
  return div.textContent || div.innerText || ''
}

function extractClozeText(raw) {
  const source = String(raw || '')
  const answers = []

  const hidden = source.replace(/\{\{c\d+::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g, (match, answer, hint) => {
    const cleanAnswer = stripHtml(decodeHtmlEntities(answer)).trim()
    const cleanHint = stripHtml(decodeHtmlEntities(hint || '')).trim()
    if (cleanAnswer) answers.push(cleanAnswer)
    return cleanHint ? `[...] (${cleanHint})` : '[...]'
  })

  return {
    isCloze: answers.length > 0,
    front: hidden,
    answers,
    answer: answers.join(' / ')
  }
}

function buildQuestionAndAnswerFromFields(fields) {
  const allText = fields.join('<br>')
  const cloze = extractClozeText(allText)

  if (cloze.isCloze) {
    return {
      isCloze: true,
      frontHtml: cloze.front,
      backHtml: cloze.answers.map((a, i) => `${i + 1}. ${a}`).join('<br>'),
      pergunta: stripHtml(cloze.front),
      resposta: cloze.answers.join(' / '),
      clozeAnswers: cloze.answers
    }
  }

  const frontHtml = fields[0] || ''
  const backHtml = fields.length > 1 ? fields.slice(1).join('<br>') : ''
  return {
    isCloze: false,
    frontHtml,
    backHtml,
    pergunta: stripHtml(frontHtml),
    resposta: stripHtml(backHtml),
    clozeAnswers: []
  }
}

function safeStats(raw) {
  const s = raw && typeof raw === 'object' ? raw : {}
  return {
    ...DEFAULT_STATS,
    ...s,
    daily: s.daily && typeof s.daily === 'object' ? s.daily : {},
    history: Array.isArray(s.history) ? s.history : [],
    byGrade: { ...DEFAULT_STATS.byGrade, ...(s.byGrade || {}) }
  }
}

function splitCSVLine(line) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') inQuotes = !inQuotes
    else if ((ch === ';' || ch === ',') && !inQuotes) {
      out.push(cur.replace(/^"|"$/g, '').trim())
      cur = ''
    } else cur += ch
  }
  out.push(cur.replace(/^"|"$/g, '').trim())
  return out
}

function parseCSV(text) {
  return text.split(/\r?\n/).filter(Boolean).map((line, idx) => {
    const p = splitCSVLine(line)
    if (!p[0] || !p[1]) return null
    if (idx === 0 && ['pergunta','front','frente','question'].includes(normalize(p[0]))) return null
    const front = p[0]
    const back = p[1]
    const built = buildQuestionAndAnswerFromFields([front, back])
    return {
      id: `csv-${Date.now()}-${idx}`,
      pergunta: built.pergunta || '[Frente sem texto]',
      resposta: built.resposta || '[Sem resposta]',
      htmlFront: built.frontHtml || built.pergunta,
      htmlBack: built.backHtml || built.resposta,
      isCloze: built.isCloze,
      clozeAnswers: built.clozeAnswers,
      dueAt: Date.now(),
      reps: 0,
      interval: 0,
      ease: 2500,
      palavras: normalize(built.resposta).split(' ').filter(w => w.length > 3).slice(0, 12)
    }
  }).filter(Boolean)
}

function replaceMedia(html, mediaMap) {
  return String(html || '').replace(/src=["']([^"']+)["']/g, (match, filename) => {
    const decodedName = decodeURIComponent(filename)
    const cleanName = decodedName.split('/').pop()
    const mediaSrc = mediaMap[decodedName] || mediaMap[cleanName] || mediaMap[filename]
    return mediaSrc ? `src="${mediaSrc}"` : match
  })
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

async function buildMediaMap(zip) {
  const map = {}
  const mediaFile = zip.file('media')
  if (!mediaFile) return map

  let mediaJson = {}
  try {
    mediaJson = JSON.parse(await mediaFile.async('string'))
  } catch {
    return map
  }

  const mimeFor = (name) => {
    const lower = String(name).toLowerCase()
    if (lower.endsWith('.png')) return 'image/png'
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
    if (lower.endsWith('.gif')) return 'image/gif'
    if (lower.endsWith('.webp')) return 'image/webp'
    if (lower.endsWith('.svg')) return 'image/svg+xml'
    if (lower.endsWith('.mp3')) return 'audio/mpeg'
    if (lower.endsWith('.ogg')) return 'audio/ogg'
    return 'application/octet-stream'
  }

  for (const [zipName, realName] of Object.entries(mediaJson)) {
    const file = zip.file(zipName)
    if (!file) continue
    const blob = await file.async('blob')
    const dataUrl = await blobToDataUrl(new Blob([blob], { type: mimeFor(realName) }))
    const cleanName = String(realName).split('/').pop()
    map[realName] = dataUrl
    map[cleanName] = dataUrl
  }

  return map
}

function stableCardKey(card) {
  return normalize(`${card.noteId || ''} ${card.pergunta || ''} ${card.resposta || ''}`).slice(0, 240)
}

function mergeImportedCards(oldCards, importedCards) {
  const oldById = new Map(oldCards.map(c => [String(c.id), c]))
  const oldByKey = new Map(oldCards.map(c => [stableCardKey(c), c]))
  let added = 0
  let updated = 0
  let preservedEdited = 0

  const merged = [...oldCards]

  importedCards.forEach(newCard => {
    const idKey = String(newCard.id)
    const contentKey = stableCardKey(newCard)
    const existing = oldById.get(idKey) || oldByKey.get(contentKey)

    if (existing) {
      const index = merged.findIndex(c => c.id === existing.id)
      if (index >= 0) {
        if (existing.manualEditedAt) {
          merged[index] = {
            ...existing,
            tags: newCard.tags,
            cardType: newCard.cardType,
            interval: newCard.interval,
            ease: newCard.ease,
            ankiDue: newCard.ankiDue,
            sourceUpdatedAt: new Date().toISOString()
          }
          updated += 1
          preservedEdited += 1
          return
        }
        merged[index] = {
          ...existing,
          // Atualiza texto/mídia caso o deck tenha sido corrigido no Anki,
          // mas preserva estatísticas do jogo.
          pergunta: newCard.pergunta,
          resposta: newCard.resposta,
          htmlFront: newCard.htmlFront,
          htmlBack: newCard.htmlBack,
          isCloze: newCard.isCloze,
          clozeAnswers: newCard.clozeAnswers,
          tags: newCard.tags,
          cardType: newCard.cardType,
          interval: newCard.interval,
          ease: newCard.ease,
          ankiDue: newCard.ankiDue,
          palavras: newCard.palavras
        }
        updated += 1
      }
    } else {
      merged.push(newCard)
      added += 1
    }
  })

  return { merged, added, updated, preservedEdited }
}


function getCardView(card) {
  if (!card) return null

  const rawFront = String(card.htmlFront || card.pergunta || '')
  const rawBack = String(card.htmlBack || card.resposta || '')
  const source = rawFront.includes('{{c') ? rawFront : `${rawFront}<br>${rawBack}`
  const cloze = extractClozeText(source)

  if (!cloze.isCloze) return card

  const frontHtml = cloze.front
  const backHtml = cloze.answers.map((a, i) => `${i + 1}. ${a}`).join('<br>')
  const resposta = cloze.answers.join(' / ')

  return {
    ...card,
    isCloze: true,
    htmlFront: frontHtml,
    htmlBack: backHtml,
    pergunta: stripHtml(frontHtml),
    resposta,
    clozeAnswers: cloze.answers,
    palavras: cloze.answers
      .flatMap(item => normalize(item).split(' '))
      .filter(w => w.length > 2)
      .slice(0, 12)
  }
}

function RichTextEditor({ value, onChange }) {
  const editorRef = useRef(null)
  const lastHtmlRef = useRef(null)

  useEffect(() => {
    if (!editorRef.current || value === lastHtmlRef.current) return
    editorRef.current.innerHTML = value || ''
    lastHtmlRef.current = value || ''
  }, [value])

  function emitChange() {
    const html = editorRef.current?.innerHTML || ''
    lastHtmlRef.current = html
    onChange(html)
  }

  function runCommand(command, option = null) {
    document.execCommand(command, false, option)
    emitChange()
    editorRef.current?.focus()
  }

  function insertSymbol(symbol) {
    editorRef.current?.focus()
    document.execCommand('insertText', false, symbol)
    emitChange()
  }

  return (
    <div className="rich-editor">
      <div className="rich-toolbar">
        <button type="button" className="tool-button" onMouseDown={e => { e.preventDefault(); runCommand('bold') }}>B</button>
        <button type="button" className="tool-button" onMouseDown={e => { e.preventDefault(); insertSymbol('≥') }}>≥</button>
        <button type="button" className="tool-button" onMouseDown={e => { e.preventDefault(); insertSymbol('≤') }}>≤</button>
        {['#111827', '#2563eb', '#b42318', '#167047'].map(color => (
          <button
            type="button"
            aria-label={`Cor ${color}`}
            className="color-button"
            key={color}
            style={{ background: color }}
            onMouseDown={e => { e.preventDefault(); runCommand('foreColor', color) }}
          />
        ))}
      </div>
      <div
        ref={editorRef}
        className="rich-input"
        contentEditable
        suppressContentEditableWarning
        onInput={emitChange}
      />
    </div>
  )
}


export default function App() {
  const [ready, setReady] = useState(false)
  const [logged, setLogged] = useState(false)
  const [user, setUser] = useState(null)
  const [login, setLogin] = useState('')
  const [senha, setSenha] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [syncStatus, setSyncStatus] = useState('')
  const [cards, setCards] = useState(DEFAULT_CARDS)
  const [config, setConfig] = useState(DEFAULT_CONFIG)
  const [stats, setStats] = useState(DEFAULT_STATS)
  const [index, setIndex] = useState(0)
  const [answer, setAnswer] = useState('')
  const [feedback, setFeedback] = useState(null)
  const [pendingGrade, setPendingGrade] = useState(null)
  const [lastAnsweredId, setLastAnsweredId] = useState(null)
  const [editing, setEditing] = useState(false)
  const [editFront, setEditFront] = useState('')
  const [editBack, setEditBack] = useState('')
  const [random, setRandom] = useState(false)
  const [tab, setTab] = useState('study')
  const [siteSeconds, setSiteSeconds] = useState(0)
  const [cardSeconds, setCardSeconds] = useState(0)
  const [importLog, setImportLog] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [newFront, setNewFront] = useState('')
  const [newBack, setNewBack] = useState('')

  async function loadCloudProgress(authedUser, seedCards = cards, seedStats = stats) {
    if (!authedUser) return

    setSyncStatus('Carregando progresso salvo...')

    const { data, error } = await supabase
      .from('profiles')
      .select('cards, stats')
      .eq('id', authedUser.id)
      .maybeSingle()

    if (error) throw error

    const hasCloudCards = Array.isArray(data?.cards) && data.cards.length > 0
    const hasCloudStats = data?.stats && typeof data.stats === 'object'

    if (hasCloudCards) setCards(data.cards)
    if (hasCloudStats) setStats(safeStats(data.stats))

    if (!hasCloudCards && !hasCloudStats) {
      await supabase
        .from('profiles')
        .upsert({
          id: authedUser.id,
          email: authedUser.email,
          cards: seedCards,
          stats: seedStats
        })
      setSyncStatus('Progresso local enviado para sua conta.')
      return
    }

    setSyncStatus('Progresso sincronizado.')
  }

  useEffect(() => {
    let active = true

    async function boot() {
      let nextCards = DEFAULT_CARDS
      let nextConfig = DEFAULT_CONFIG
      let nextStats = DEFAULT_STATS
      let nextLastAnswered = null

      try {
        const savedCards = localStorage.getItem('mq_cards')
        const savedConfig = localStorage.getItem('mq_config')
        const savedStats = localStorage.getItem('mq_stats')
        const savedLastAnswered = localStorage.getItem('mq_last_answered')

        if (savedCards) nextCards = JSON.parse(savedCards)
        if (savedConfig) nextConfig = { ...DEFAULT_CONFIG, ...JSON.parse(savedConfig) }
        if (savedStats) nextStats = safeStats(JSON.parse(savedStats))
        if (savedLastAnswered) nextLastAnswered = savedLastAnswered
      } catch {
        localStorage.removeItem('mq_stats')
      }

      try {
        const { data } = await supabase.auth.getSession()
        const sessionUser = data.session?.user || null

        if (active) {
          setCards(nextCards)
          setConfig(nextConfig)
          setStats(nextStats)
          if (nextLastAnswered) setLastAnsweredId(nextLastAnswered)
        }

        if (sessionUser) {
          await loadCloudProgress(sessionUser, nextCards, nextStats)
          if (active) {
            setUser(sessionUser)
            setLogged(true)
          }
        }
      } catch (err) {
        console.error(err)
        if (active) {
          setFeedback({ type: 'bad', text: 'NÃ£o consegui sincronizar seu progresso agora.' })
        }
      } finally {
        if (active) setReady(true)
      }
    }

    boot()
    return () => { active = false }
  }, [])

  const dueCards = useMemo(() => cards.filter(c => !c.dueAt || c.dueAt <= Date.now()), [cards])
  const current = dueCards.length ? dueCards[index % dueCards.length] : null
  const currentView = current ? getCardView(current) : null
  const todayDone = stats.daily?.[todayKey()] || 0
  const remainingToday = Math.max(0, Number(config.dailyGoal || 0) - todayDone)
  const totalAnswered = Number(stats.correct || 0) + Number(stats.wrong || 0)
  const accuracy = totalAnswered ? Math.round((Number(stats.correct || 0) / totalAnswered) * 100) : 0
  const avgTime = totalAnswered ? Math.round(Number(stats.totalAnswerSeconds || 0) / totalAnswered) : 0
  const dailyValues = Object.entries(stats.daily || {}).slice(-14)
  const maxDaily = Math.max(1, ...dailyValues.map(([, value]) => Number(value || 0)))
  const progress = Math.min(100, Number(stats.xp || 0) % 100)
  const currentAlreadyAnswered = !!current && (
    pendingGrade?.cardId === current.id ||
    feedback?.cardId === current.id
  )
  const filteredCards = cards.filter(c => {
    const q = normalize(searchTerm)
    if (!q) return true
    return normalize(`${c.pergunta || ''} ${c.resposta || ''} ${c.tags || ''}`).includes(q)
  })

  useEffect(() => {
  if (!ready || !logged || !user) return

  localStorage.setItem('mq_cards', JSON.stringify(cards))

  const saveCards = async () => {
    setSyncStatus('Salvando progresso...')
    const { error } = await supabase
      .from('profiles')
      .upsert({
        id: user.id,
        email: user.email,
        cards: cards
      })

    setSyncStatus(error ? 'Erro ao salvar cards.' : 'Progresso salvo.')
  }

  saveCards()
}, [cards, ready, logged, user])

  useEffect(() => {
    if (!ready) return
    localStorage.setItem('mq_config', JSON.stringify(config))
  }, [config, ready])

  useEffect(() => {
  if (!ready || !logged || !user) return

  localStorage.setItem('mq_stats', JSON.stringify(stats))

  const saveStats = async () => {
    setSyncStatus('Salvando progresso...')
    const { error } = await supabase
      .from('profiles')
      .upsert({
        id: user.id,
        email: user.email,
        stats: stats
      })

    setSyncStatus(error ? 'Erro ao salvar estatÃ­sticas.' : 'Progresso salvo.')
  }

  saveStats()
}, [stats, ready, logged, user])

  useEffect(() => {
    if (!ready || !logged) return

    let lastActivity = Date.now()
    const markActive = () => { lastActivity = Date.now() }

    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart']
    events.forEach(eventName => window.addEventListener(eventName, markActive))

    const t = setInterval(() => {
      const inactiveTooLong = Date.now() - lastActivity > 3 * 60 * 1000
      if (document.hidden || inactiveTooLong) return

      setSiteSeconds(prev => prev + 1)
      setCardSeconds(prev => prev + 1)
    }, 1000)

    return () => {
      clearInterval(t)
      events.forEach(eventName => window.removeEventListener(eventName, markActive))
    }
  }, [ready, logged])

  useEffect(() => {
    setCardSeconds(0)
  }, [index, current?.id])

  function enter() {
    if (login.trim().toLowerCase() === 'leo' && senha === '1234') {
      localStorage.setItem('mq_logged', 'true')
      setLogged(true)
      setFeedback(null)
    } else {
      setFeedback({ type: 'bad', text: 'Login ou senha inválidos.' })
    }
  }

  function logout() {
    localStorage.removeItem('mq_logged')
    setLogged(false)
    setFeedback(null)
    setSiteSeconds(0)
    setCardSeconds(0)
  }

  async function cloudEnter() {
    const email = login.trim()
    if (!email || !senha) {
      setFeedback({ type: 'bad', text: 'Digite email e senha.' })
      return
    }

    setAuthLoading(true)
    setFeedback(null)

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: senha
    })

    if (error || !data.user) {
      setAuthLoading(false)
      setFeedback({ type: 'bad', text: 'Login ou senha invalidos.' })
      return
    }

    try {
      await loadCloudProgress(data.user)
      setUser(data.user)
      setLogged(true)
      setSenha('')
    } catch (err) {
      console.error(err)
      setFeedback({ type: 'bad', text: 'Entrei, mas nao consegui carregar o progresso salvo.' })
    } finally {
      setAuthLoading(false)
    }
  }

  async function createAccount() {
    const email = login.trim()
    if (!email || senha.length < 6) {
      setFeedback({ type: 'bad', text: 'Use um email e uma senha com pelo menos 6 caracteres.' })
      return
    }

    setAuthLoading(true)
    setFeedback(null)

    const { data, error } = await supabase.auth.signUp({
      email,
      password: senha
    })

    if (error) {
      setAuthLoading(false)
      setFeedback({ type: 'bad', text: error.message || 'Nao consegui criar a conta.' })
      return
    }

    if (!data.session || !data.user) {
      setAuthLoading(false)
      setFeedback({ type: 'good', text: 'Conta criada. Confirme seu email e depois entre novamente.' })
      return
    }

    try {
      await loadCloudProgress(data.user)
      setUser(data.user)
      setLogged(true)
      setSenha('')
    } catch (err) {
      console.error(err)
      setFeedback({ type: 'bad', text: 'Conta criada, mas nao consegui salvar o progresso inicial.' })
    } finally {
      setAuthLoading(false)
    }
  }

  async function cloudLogout() {
    await supabase.auth.signOut()
    setUser(null)
    setLogged(false)
    setFeedback(null)
    setSyncStatus('')
    setSiteSeconds(0)
    setCardSeconds(0)
  }

  function markDailyDone(oldStats) {
    const t = todayKey()
    const yesterday = new Date(Date.now() - DAY).toISOString().slice(0, 10)
    const daily = { ...(oldStats.daily || {}), [t]: (oldStats.daily?.[t] || 0) + 1 }
    let studyStreak = oldStats.studyStreak || 0
    if (oldStats.lastStudyDate !== t) {
      studyStreak = oldStats.lastStudyDate === yesterday ? studyStreak + 1 : 1
    }
    return { daily, studyStreak, lastStudyDate: t }
  }

  function scheduleCard(card, grade) {
    const isWrong = grade === 'again' || grade === 'hard'
    const previousCorrect = Number(card.correctCount || 0)
    const correctCount = isWrong ? previousCorrect : previousCorrect + 1

    let delay

    if (isWrong) {
      // Errou ou ficou abaixo do corte: volta em 10 minutos até acertar.
      delay = 10 * 60 * 1000
    } else if (correctCount === 1) {
      // Primeiro acerto: ainda volta no mesmo dia para consolidar.
      delay = 10 * 60 * 1000
    } else if (correctCount === 2) {
      // Segundo acerto: para de repetir no mesmo dia e volta amanhã.
      delay = 1 * DAY
    } else if (correctCount === 3) {
      delay = 7 * DAY
    } else if (correctCount === 4) {
      delay = 15 * DAY
    } else {
      // Quinto acerto ou mais: espaçamento máximo de 1 mês.
      delay = 30 * DAY
    }

    return {
      ...card,
      dueAt: Date.now() + delay,
      reps: (card.reps || 0) + 1,
      correctCount,
      lastGrade: grade,
      lastIntervalMs: delay
    }
  }

  function evaluate() {
    if (!current) return
    if (currentAlreadyAnswered) return

    const cardForAnswer = getCardView(current)
    const userText = normalize(answer)
    let percent = 0

    if (cardForAnswer.isCloze && cardForAnswer.clozeAnswers?.length) {
      const hits = cardForAnswer.clozeAnswers.filter(item => {
        const itemText = normalize(item)
        if (!itemText) return false
        const words = itemText.split(' ').filter(w => w.length > 2)
        if (userText.includes(itemText)) return true
        if (!words.length) return false
        const wordHits = words.filter(w => userText.includes(w)).length
        return wordHits / words.length > 0.5
      }).length
      percent = Math.round((hits / cardForAnswer.clozeAnswers.length) * 100)
    } else {
      const keywords = (cardForAnswer.palavras?.length ? cardForAnswer.palavras : normalize(cardForAnswer.resposta).split(' ').filter(w => w.length > 4).slice(0, 8)).map(normalize)
      const hits = keywords.filter(k => userText.includes(k)).length
      percent = keywords.length ? Math.round((hits / keywords.length) * 100) : 0
    }

    const grade = percent <= 50 ? 'again' : percent < 70 ? 'hard' : percent < 90 ? 'good' : 'easy'
    const isCorrect = percent > 50
    const xpDelta = isCorrect ? Math.max(5, Math.round(25 * percent / 100)) : -5

    setStats(prevRaw => {
      const prev = safeStats(prevRaw)
      const dailyPatch = markDailyDone(prev)
      const newXp = Math.max(0, (prev.xp || 0) + xpDelta)
      const newStreak = isCorrect ? (prev.streak || 0) + 1 : 0
      const historyItem = {
        id: current.id,
        pergunta: cardForAnswer.pergunta,
        percent,
        grade,
        correct: isCorrect,
        seconds: cardSeconds,
        date: new Date().toISOString()
      }

      return {
        ...prev,
        ...dailyPatch,
        xp: newXp,
        level: Math.floor(newXp / 100) + 1,
        correct: (prev.correct || 0) + (isCorrect ? 1 : 0),
        wrong: (prev.wrong || 0) + (isCorrect ? 0 : 1),
        streak: newStreak,
        record: Math.max(prev.record || 0, newStreak),
        history: [...(prev.history || []), historyItem].slice(-500),
        totalAnswerSeconds: (prev.totalAnswerSeconds || 0) + cardSeconds,
        fastestSeconds: prev.fastestSeconds == null ? cardSeconds : Math.min(prev.fastestSeconds, cardSeconds),
        slowestSeconds: Math.max(prev.slowestSeconds || 0, cardSeconds),
        byGrade: { ...prev.byGrade, [grade]: ((prev.byGrade || {})[grade] || 0) + 1 }
      }
    })

    setLastAnsweredId(current.id)
    localStorage.setItem('mq_last_answered', current.id)
    setPendingGrade({ cardId: current.id, grade })
    const nextCorrectCount = isCorrect ? Number(current.correctCount || 0) + 1 : Number(current.correctCount || 0)
    const scheduleLabel = !isCorrect
      ? '10 minutos'
      : nextCorrectCount === 1
        ? '10 minutos'
        : nextCorrectCount === 2
          ? '1 dia'
          : nextCorrectCount === 3
            ? '1 semana'
            : nextCorrectCount === 4
              ? '15 dias'
              : '1 mês'

    setFeedback({
      cardId: current.id,
      type: isCorrect ? 'good' : 'bad',
      grade,
      percent,
      text: `Você acertou ${percent}% da resposta em ${formatTime(cardSeconds)}.`,
      expected: cardForAnswer.isCloze && cardForAnswer.clozeAnswers?.length ? cardForAnswer.clozeAnswers.join(' / ') : (cardForAnswer.resposta || stripHtml(cardForAnswer.htmlBack)),
      scheduleLabel
    })
  }

  function nextCard() {
    const updatedCards = pendingGrade
      ? cards.map(c => c.id === pendingGrade.cardId ? scheduleCard(c, pendingGrade.grade) : c)
      : cards

    const freshDue = updatedCards.filter(c => !c.dueAt || c.dueAt <= Date.now())

    setCards(updatedCards)
    setAnswer('')
    setFeedback(null)
    setPendingGrade(null)

    if (freshDue.length <= 1) {
      setIndex(0)
      return
    }

    if (random) {
      setIndex(Math.floor(Math.random() * freshDue.length))
    } else {
      setIndex(prev => {
        const next = prev + 1
        return next >= freshDue.length ? 0 : next
      })
    }
  }

  function resetAll() {
    setStats(DEFAULT_STATS)
    setCards(cards.map(c => ({ ...c, dueAt: Date.now(), reps: 0 })))
    setSiteSeconds(0)
    setCardSeconds(0)
    setIndex(0)
    setAnswer('')
    setFeedback(null)
    setPendingGrade(null)
  }



  function createCard() {
    if (!newFront.trim() || !newBack.trim()) {
      setImportLog('Preencha a pergunta e a resposta para criar um card.')
      return
    }

    const built = buildQuestionAndAnswerFromFields([newFront, newBack])
    const card = {
      id: `manual-${Date.now()}`,
      pergunta: built.pergunta || stripHtml(newFront),
      resposta: built.resposta || stripHtml(newBack),
      htmlFront: built.frontHtml || newFront,
      htmlBack: built.backHtml || newBack,
      isCloze: built.isCloze,
      clozeAnswers: built.clozeAnswers || [],
      dueAt: Date.now(),
      reps: 0,
      correctCount: 0,
      interval: 0,
      ease: 2500,
      tags: 'manual',
      manualEditedAt: new Date().toISOString(),
      palavras: normalize(built.resposta || newBack).split(' ').filter(w => w.length > 3).slice(0, 12)
    }

    setCards(prev => [...prev, card])
    setNewFront('')
    setNewBack('')
    setImportLog('Novo card criado.')
    setTab('study')
    setIndex(0)
  }

  function goToLastAnswered() {
    if (!lastAnsweredId) return
    const updated = cards.map(c => c.id === lastAnsweredId ? { ...c, dueAt: Date.now() } : c)
    const freshDue = updated.filter(c => !c.dueAt || c.dueAt <= Date.now())
    const pos = freshDue.findIndex(c => c.id === lastAnsweredId)
    setCards(updated)
    setIndex(pos >= 0 ? pos : 0)
    setAnswer('')
    setFeedback(null)
    setPendingGrade(null)
    setEditing(false)
  }

  function startEdit() {
    if (!current) return
    const v = getCardView(current)
    setEditFront(v.htmlFront || v.pergunta || '')
    setEditBack(v.htmlBack || v.resposta || '')
    setEditing(true)
  }

  function saveEdit() {
    if (!current) return
    const editingCardId = current.id
    const pergunta = stripHtml(editFront)
    const resposta = stripHtml(editBack)
    setCards(prev => prev.map(c => c.id === editingCardId ? {
      ...c,
      pergunta,
      resposta,
      htmlFront: editFront,
      htmlBack: editBack,
      manualEditedAt: new Date().toISOString(),
      palavras: normalize(resposta).split(' ').filter(w => w.length > 4).slice(0, 10)
    } : c))
    if (feedback?.cardId === editingCardId) {
      setFeedback(prev => prev ? {
        ...prev,
        expected: resposta || stripHtml(editBack)
      } : prev)
    }
    setEditing(false)
  }

  function tsvCell(value) {
    return String(value || '')
      .replace(/\t/g, ' ')
      .replace(/\r?\n/g, '<br>')
      .trim()
  }

  function exportToAnki() {
    const header = [
      '#separator:tab',
      '#html:true',
      '#columns:Frente\tVerso\tTags'
    ].join('\n')

    const rows = cards.map(card => {
      const v = getCardView(card)
      return [
        tsvCell(v.htmlFront || v.pergunta),
        tsvCell(v.htmlBack || v.resposta),
        tsvCell(v.tags || '')
      ].join('\t')
    })

    const content = `${header}\n${rows.join('\n')}`
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `medquest-cards-${todayKey()}.txt`
    a.click()
    URL.revokeObjectURL(url)
    setImportLog(`${cards.length} cards exportados para importar no Anki.`)
  }

  function importCSV(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const imported = parseCSV(String(reader.result || ''))
      if (imported.length) {
        setCards(prev => {
          const result = mergeImportedCards(prev, imported)
          setImportLog(`${result.added} cards novos adicionados; ${result.updated} antigos encontrados; ${result.preservedEdited} edições do site preservadas por CSV.`)
          return result.merged
        })
        setIndex(0)
        setTab('study')
      } else {
        setImportLog('Não consegui ler o CSV. Use: pergunta;resposta;imagem(opcional)')
      }
    }
    reader.readAsText(file, 'utf-8')
  }

  async function importAPKG(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setImportLog('Importando APKG...')
    try {
      const zip = await JSZip.loadAsync(file)
      const mediaMap = await buildMediaMap(zip)
      const dbFile = zip.file('collection.anki21b') || zip.file('collection.anki21') || zip.file('collection.anki2')
      if (!dbFile) throw new Error('Banco collection.anki2/anki21 não encontrado.')
      const SQL = await initSqlJs({ locateFile: () => wasmUrl })
      const bytes = await dbFile.async('uint8array')
      const db = new SQL.Database(bytes)
      const rows = db.exec(`
        SELECT notes.id, notes.flds, notes.tags, cards.id, cards.type, cards.ivl, cards.factor, cards.reps, cards.due
        FROM cards
        JOIN notes ON cards.nid = notes.id
        ORDER BY cards.due ASC
      `)
      if (!rows.length) throw new Error('Nenhum card encontrado.')

      const imported = rows[0].values.map((row, idx) => {
        const fields = String(row[1] || '').split('\x1f')
        const built = buildQuestionAndAnswerFromFields(fields)

        const frontHtml = replaceMedia(built.frontHtml || built.pergunta, mediaMap)
        const backHtml = replaceMedia(built.backHtml || built.resposta, mediaMap)
        const pergunta = stripHtml(frontHtml) || '[Frente sem texto]'
        const resposta = stripHtml(backHtml) || built.resposta || '[Sem resposta]'

        return {
          id: String(row[3] || `apkg-${idx}`),
          noteId: String(row[0] || ''),
          pergunta,
          resposta,
          htmlFront: frontHtml || pergunta,
          htmlBack: backHtml || resposta,
          isCloze: built.isCloze,
          clozeAnswers: built.clozeAnswers || [],
          tags: String(row[2] || ''),
          cardType: row[4],
          interval: row[5],
          ease: row[6],
          reps: row[7],
          ankiDue: row[8],
          dueAt: Date.now(),
          palavras: (built.clozeAnswers?.length ? built.clozeAnswers : normalize(resposta).split(' '))
            .flatMap(x => normalize(x).split(' '))
            .filter(w => w.length > 3)
            .slice(0, 12)
        }
      })

      setCards(prev => {
        const result = mergeImportedCards(prev, imported)
        setImportLog(`${result.added} cards novos adicionados; ${result.updated} antigos encontrados; ${result.preservedEdited} edições do site preservadas. Mídias encontradas: ${Object.keys(mediaMap).length}.`)
        return result.merged
      })
      setIndex(0)
      setTab('study')
    } catch (err) {
      console.error(err)
      setImportLog(`Erro ao importar APKG: ${err.message || String(err)}`)
    }
  }

  if (!ready) return <div className="loading">Carregando...</div>

  if (!logged) {
    return (
      <main className="login-page">
        <section className="login-card">
          <div className="lock"><Lock size={34}/></div>
          <h1>MedQuest Anki Game</h1>
          <p>Entre com sua conta para sincronizar os flashcards em todos os dispositivos.</p>
          <input value={login} onChange={e=>setLogin(e.target.value)} placeholder="Email" type="email" onKeyDown={e=> e.key === 'Enter' && cloudEnter()} />
          <input value={senha} onChange={e=>setSenha(e.target.value)} placeholder="Senha" type="password" onKeyDown={e=> e.key === 'Enter' && cloudEnter()} />
          <button onClick={cloudEnter} disabled={authLoading}>{authLoading ? 'Entrando...' : 'Entrar'}</button>
          <button className="secondary" onClick={createAccount} disabled={authLoading}>Criar conta</button>
          {feedback?.type === 'bad' && <div className="alert bad">{feedback.text}</div>}
          {feedback?.type === 'good' && <div className="alert good">{feedback.text}</div>}
        </section>
      </main>
    )
  }

  return (
    <main className="app">
      <header className="top">
        <div>
          <h1>MedQuest Anki Game</h1>
        </div>
        <div className="profile">
          <span>{user?.email}</span>
          <button onClick={cloudLogout}><LogOut size={20}/> Sair</button>
        </div>
      </header>
      {syncStatus && <div className="sync-status">{syncStatus}</div>}

      <nav className="tabs">
        <button className={tab==='study'?'active':''} onClick={()=>setTab('study')}><Brain size={18}/> Estudar</button>
        <button className={tab==='cards'?'active':''} onClick={()=>setTab('cards')}><Eye size={18}/> Ver flashcards</button>
        <button className={tab==='import'?'active':''} onClick={()=>setTab('import')}><Upload size={18}/> Importar</button>
        <button className={tab==='create'?'active':''} onClick={()=>setTab('create')}><Plus size={18}/> Criar card</button>
        <button className={tab==='stats'?'active':''} onClick={()=>setTab('stats')}><BarChart3 size={18}/> Estatísticas</button>
        <button className={tab==='settings'?'active':''} onClick={()=>setTab('settings')}><Settings size={18}/> Configurações</button>
      </nav>

      <section className="stats">
        <div><Trophy/><span>Acertos</span><b>{stats.correct}</b></div>
        <div><XCircle/><span>Erros</span><b>{stats.wrong}</b></div>
        <div><Flame/><span>Sequência atual</span><b>{stats.streak}</b></div>
        <div><CalendarDays/><span>Dias seguidos</span><b>{stats.studyStreak}</b></div>
        <div><ListChecks/><span>Feitos hoje</span><b>{todayDone}</b></div>
        <div><Clock/><span>Faltam hoje</span><b>{remainingToday}</b></div>
        <div><Clock/><span>Tempo</span><b>{formatTime(cardSeconds)}</b></div>
        <div><Target/><span>Vencidos agora</span><b>{dueCards.length}</b></div>
        <div><ImageIcon/><span>Total no deck</span><b>{cards.length}</b></div>
        <div><BarChart3/><span>Precisão geral</span><b>{accuracy}%</b></div>
      </section>

      <div className="bar"><div style={{width: `${progress}%`}} /></div>

      {tab === 'study' && (
        <section className="card">
          {!current ? (
            <div className="empty">
              <h2>Nenhum card vencido agora.</h2>
              <p>Os próximos cards voltarão conforme o espaçamento configurado.</p>
            </div>
          ) : (
            <>
              <div className="card-top">
                <span>Card vencido {Math.min(index + 1, dueCards.length)} de {dueCards.length}</span>
                <span className="timer-chip">Tempo: {formatTime(cardSeconds)}</span>
                <label><input type="checkbox" checked={random} onChange={e=>setRandom(e.target.checked)}/> Aleatório</label>
              </div>
              <div className="question-html" dangerouslySetInnerHTML={{__html: currentView.htmlFront || currentView.pergunta}} />

              {editing && (
                <div className="edit-box">
                  <h3>Editar card</h3>
                  <label>Frente/pergunta</label>
                  <RichTextEditor value={editFront} onChange={setEditFront} />
                  <label>Resposta/gabarito</label>
                  <RichTextEditor value={editBack} onChange={setEditBack} />
                  <div className="actions">
                    <button onClick={saveEdit}>Salvar edição</button>
                    <button className="secondary" onClick={()=>setEditing(false)}>Cancelar</button>
                  </div>
                </div>
              )}

              {!editing && <textarea value={answer} onChange={e=>setAnswer(e.target.value)} placeholder="Digite sua resposta aqui..." />}
              <div className="actions">
                <button onClick={evaluate} disabled={currentAlreadyAnswered || editing}><CheckCircle2 size={18}/> Responder</button>
                <button className="secondary" onClick={nextCard}>Próximo</button>
                <button className="secondary" onClick={goToLastAnswered} disabled={!lastAnsweredId}>Voltar último</button>
                <button className="secondary" onClick={startEdit}>Editar card</button>
              </div>
              {feedback && feedback.cardId === current.id && (
                <div className={`feedback ${feedback.type}`}>
                  <div className="score-line">{feedback.text}</div>
                  <div className="pill">Agendamento: {feedback.scheduleLabel}</div>
                  <div className="answer-box">
                    <b>Resposta esperada:</b>
                    <div dangerouslySetInnerHTML={{__html: currentView.htmlBack || feedback.expected}} />
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {tab === 'cards' && (
        <section className="card">
          <h2>Visualizar flashcards</h2>
          <input
            value={searchTerm}
            onChange={e=>setSearchTerm(e.target.value)}
            placeholder="Buscar flashcard por pergunta, resposta ou tag..."
            className="search-input"
          />
          <p className="hint">{filteredCards.length} de {cards.length} flashcards encontrados.</p>
          <div className="grid-cards">
            {filteredCards.map((c, i) => {
              const v = getCardView(c)
              return (
                <div className="mini" key={c.id}>
                  <b>{i+1}. {v.pergunta}</b>
                  <div dangerouslySetInnerHTML={{__html: v.htmlFront || v.pergunta}} />
                  <p><b>Resposta:</b> {v.resposta}</p>
                  <small>{v.isCloze ? 'Cloze | ' : ''}Reps: {v.reps || 0} | Acertos: {v.correctCount || 0} | Próxima revisão: {new Date(v.dueAt || Date.now()).toLocaleString('pt-BR')}</small>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {tab === 'import' && (
        <section className="card">
          <h2>Importar deck</h2>
          <p className="hint">Use APKG para importar deck real do Anki com imagens/mídias. CSV continua disponível como alternativa.</p>
          <div className="actions">
            <label className="import"><Upload size={18}/> Importar .APKG<input type="file" accept=".apkg" onChange={importAPKG}/></label>
            <label className="import dark"><Upload size={18}/> Importar CSV<input type="file" accept=".csv,.txt" onChange={importCSV}/></label>
            <button className="secondary" onClick={exportToAnki}><Download size={18}/> Exportar para Anki</button>
          </div>
          {importLog && <div className="alert info">{importLog}</div>}
        </section>
      )}


      {tab === 'create' && (
        <section className="card">
          <h2>Criar novo card</h2>
          <p className="hint">{'Você pode criar card comum ou cloze. Exemplo cloze: O componente {{c1::mitral}} vem antes do {{c1::tricúspide}}.'}</p>
          <div className="edit-box">
            <label>Frente/pergunta</label>
            <textarea value={newFront} onChange={e=>setNewFront(e.target.value)} placeholder="Digite a pergunta..." />
            <label>Resposta/gabarito</label>
            <textarea value={newBack} onChange={e=>setNewBack(e.target.value)} placeholder="Digite a resposta..." />
            <div className="actions">
              <button onClick={createCard}><Plus size={18}/> Criar card</button>
              <button className="secondary" onClick={()=>{setNewFront(''); setNewBack('')}}>Limpar</button>
            </div>
          </div>
          {importLog && <div className="alert info">{importLog}</div>}
        </section>
      )}

      {tab === 'stats' && (
        <section className="card">
          <h2>Estatísticas avançadas</h2>
          <div className="advanced-grid">
            <div className="advanced-box"><span>Precisão geral</span><b>{accuracy}%</b><small>{stats.correct} acertos de {totalAnswered}</small></div>
            <div className="advanced-box"><span>Tempo médio</span><b>{formatTime(avgTime)}</b><small>Total: {formatTime(stats.totalAnswerSeconds)}</small></div>
            <div className="advanced-box"><span>Mais rápido</span><b>{stats.fastestSeconds == null ? '--' : formatTime(stats.fastestSeconds)}</b><small>Menor tempo</small></div>
            <div className="advanced-box"><span>Mais lento</span><b>{formatTime(stats.slowestSeconds)}</b><small>Maior tempo</small></div>
          </div>

          <h3>Distribuição por desempenho</h3>
          <div className="grade-grid">
            <div><b>{stats.byGrade.again}</b><span>Errei<br/>0–39%</span></div>
            <div><b>{stats.byGrade.hard}</b><span>Difícil<br/>40–69%</span></div>
            <div><b>{stats.byGrade.good}</b><span>Bom<br/>70–89%</span></div>
            <div><b>{stats.byGrade.easy}</b><span>Fácil<br/>90–100%</span></div>
          </div>

          <h3>Produtividade dos últimos 14 dias</h3>
          <div className="daily-chart">
            {dailyValues.length === 0 && <p className="hint">Ainda não há histórico diário.</p>}
            {dailyValues.map(([day, value]) => (
              <div className="day-row" key={day}>
                <span>{day.slice(5).replace('-', '/')}</span>
                <div className="day-bar"><i style={{width: `${Math.max(4, (Number(value) / maxDaily) * 100)}%`}} /></div>
                <b>{value}</b>
              </div>
            ))}
          </div>

          <h3>Últimas respostas</h3>
          <div className="history-list">
            {(stats.history || []).slice(-20).reverse().map((h, i) => (
              <div className="history-item" key={i}>
                <b>{h.percent}%</b>
                <span>{h.pergunta}</span>
                <small>{formatTime(h.seconds)} | {h.grade} | {new Date(h.date).toLocaleString('pt-BR')}</small>
              </div>
            ))}
            {!(stats.history || []).length && <p className="hint">Nenhuma resposta registrada ainda.</p>}
          </div>
        </section>
      )}

      {tab === 'settings' && (
        <section className="card">
          <h2>Configurações de espaçamento</h2>
          <p className="hint">
            Intervalo personalizado em uso:
            erro: 10 minutos até acertar;
            1º acerto: 10 minutos;
            2º acerto: 1 dia;
            3º acerto: 1 semana;
            4º acerto: 15 dias;
            5º acerto ou mais: 1 mês. O intervalo máximo é 1 mês.
          </p>
          <div className="settings-grid">
            <label>Meta diária<input type="number" value={config.dailyGoal} onChange={e=>setConfig({...config, dailyGoal:Number(e.target.value)})}/></label>
          </div>
        </section>
      )}
    </main>
  )
}

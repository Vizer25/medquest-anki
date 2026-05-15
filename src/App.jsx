import { createClient } from '@supabase/supabase-js'
import { useEffect, useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import {
  Trophy, XCircle, Flame, Target, Star, LogOut, Lock, RotateCcw, Upload,
  CheckCircle2, Eye, CalendarDays, ListChecks, Clock, Settings, ImageIcon,
  Brain, BarChart3, Plus, Download, Pencil, Trash2, PauseCircle, PlayCircle, Scissors
} from 'lucide-react'
const supabase = createClient(
  'https://lgmfmdpzmqunouysuwjp.supabase.co',
  'sb_publishable_q0Kj-XQCbt89nVlQPdsG3A_pJPvVP-7',
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
)
const DAY = 24 * 60 * 60 * 1000
const STREAK_MIN_CARDS = 10

function clearStoredAuthSession() {
  try {
    Object.keys(localStorage)
      .filter(key => key.startsWith('sb-') && key.includes('auth-token'))
      .forEach(key => localStorage.removeItem(key))
  } catch (err) {
    console.warn('Nao foi possivel limpar sessao salva.', err)
  }
}

function scoreTone(percent) {
  const value = Number(percent || 0)
  if (value >= 80) return 'score-good'
  if (value >= 60) return 'score-mid'
  return 'score-bad'
}

function suggestSplitParts(html) {
  const source = String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|tr|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
  const text = stripHtml(source)
  const lineParts = source
    .split(/\n+/)
    .map(part => stripHtml(part).replace(/^[-•]\s*/, '').trim())
    .filter(part => part.length >= 8)

  if (lineParts.length >= 2) return lineParts.slice(0, 12)

  return text
    .split(/(?<=[.!?;:])\s+/)
    .map(part => part.trim())
    .filter(part => part.length >= 12)
    .slice(0, 12)
}

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
  masteryByCard: {},
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
    masteryByCard: s.masteryByCard && typeof s.masteryByCard === 'object' ? s.masteryByCard : {},
    byGrade: { ...DEFAULT_STATS.byGrade, ...(s.byGrade || {}) }
  }
}

const STOP_WORDS = new Set([
  'a','ao','aos','as','com','como','da','das','de','do','dos','e','em','entre','na','nas','no','nos','o','os','ou','para','por','que','se','sem','um','uma','uns','umas',
  'qual','quais','quando','onde','paciente','conduta','tratamento','diagnostico','diagnostico','indica','indicado','indicada',
  'iniciar','inicio','pode','podendo','caso','necessario','necessaria','realizar','fazer','usar','uso','apenas','importante'
])

const MEDICAL_ALIASES = [
  ['dm2', ['diabetes tipo 2', 'diabetes mellitus tipo 2', 'diabetes melito tipo 2', 'diabetes do tipo 2']],
  ['dm1', ['diabetes tipo 1', 'diabetes mellitus tipo 1', 'diabetes melito tipo 1', 'diabetes do tipo 1']],
  ['hap', ['hiperaldosteronismo primario', 'hiperaldosteronismo primaria']],
  ['lada', ['latent autoimmune diabetes in adults', 'diabetes autoimune latente do adulto']],
  ['tv', ['taquicardia ventricular']],
  ['fa', ['fibrilacao atrial']],
  ['iam', ['infarto agudo do miocardio', 'infarto agudo miocardio']],
  ['ic', ['insuficiencia cardiaca']],
  ['pa', ['pressao arterial']],
  ['drc', ['doenca renal cronica']],
  ['tep', ['tromboembolismo pulmonar']],
  ['avc', ['acidente vascular cerebral']],
  ['leucocitos', ['leuco', 'leucocito', 'leucocitos']],
  ['creatinina', ['cr']],
  ['instrumental', ['instrumento', 'instrumentos']],
  ['lesao visceral', ['perfuracao de outros orgaos', 'perfuracao outros orgaos', 'perfuracao de outro orgao', 'perfuracao outros orgao', 'lesao de outros orgaos', 'lesao em outros orgaos']]
]

function canonicalizeMedicalText(text) {
  let out = normalize(
    String(text || '')
      .replace(/\b(\d{1,3})\.(\d{3})\b/g, '$1$2')
      .replace(/\b(\d+),(\d+)\b/g, '$1p$2')
  )
    .replace(/\b(\d+)\s+mil\b/g, (_, n) => String(Number(n) * 1000))
    .replace(/\b(\d+)\s*j\b/g, '$1 joule')
    .replace(/\b(\d+)\s*-\s*(\d+)\s*j\b/g, '$1 $2 joule')

  MEDICAL_ALIASES.forEach(([canonical, aliases]) => {
    aliases.forEach(alias => {
      const normalizedAlias = normalize(alias).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      out = out.replace(new RegExp(`\\b${normalizedAlias}\\b`, 'g'), canonical)
    })
  })

  return out
}

function lightStem(word) {
  return String(word || '')
    .replace(/(oes|aes|ais|eis|is|ns)$/g, '')
    .replace(/(mente|idade|idades|acao|acoes|avel|ivel|ico|ica|icos|icas|ado|ada|ados|adas)$/g, '')
    .replace(/(s)$/g, '')
}

function answerTokens(text) {
  return canonicalizeMedicalText(text)
    .split(' ')
    .map(lightStem)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w))
}

function editDistance(a, b) {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > 2) return 3
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return dp[a.length][b.length]
}

function tokenMatches(expected, userTokens) {
  return userTokens.some(user => {
    if (user === expected) return true
    if (user.includes(expected) || expected.includes(user)) return Math.min(user.length, expected.length) >= 5
    return Math.max(user.length, expected.length) >= 5 && editDistance(user, expected) <= 1
  })
}

function extractNumbers(text) {
  return (canonicalizeMedicalText(text).match(/\b\d+(?:p\d+)?\b/g) || []).map(n => Number(n.replace('p', '.')))
}

function numberMatches(expected, userNumbers) {
  return userNumbers.some(user => {
    if (user === expected) return true
    const diff = Math.abs(user - expected)
    const tolerance = expected >= 50 ? expected * 0.25 : 0
    return tolerance > 0 && diff <= tolerance
  })
}

function semanticScore(expectedText, userText) {
  const expectedTokens = [...new Set(answerTokens(expectedText))]
  const userTokens = [...new Set(answerTokens(userText))]
  const expectedNumbers = [...new Set(extractNumbers(expectedText))]
  const userNumbers = [...new Set(extractNumbers(userText))]
  if (!expectedTokens.length) return 0
  if (canonicalizeMedicalText(userText).includes(canonicalizeMedicalText(expectedText))) return 100
  const hits = expectedTokens.filter(token => tokenMatches(token, userTokens)).length
  const conceptScore = hits / expectedTokens.length
  const userRelevantHits = userTokens.filter(token => tokenMatches(token, expectedTokens)).length
  const userCoverage = userTokens.length ? userRelevantHits / userTokens.length : 0
  const numberScore = expectedNumbers.length
    ? expectedNumbers.filter(number => numberMatches(number, userNumbers)).length / expectedNumbers.length
    : conceptScore
  let score = ((conceptScore * 0.55) + (userCoverage * 0.25) + (numberScore * 0.20)) * 100
  if (conceptScore >= 0.72 && userCoverage >= 0.72 && numberScore >= 0.75) score = Math.max(score, 82)
  if (userTokens.length >= 3 && userCoverage >= 0.8 && numberScore >= 0.75) score = Math.max(score, 85)
  if (userTokens.length >= 2 && userCoverage >= 0.9 && !expectedNumbers.length) score = Math.max(score, 82)
  return Math.round(Math.min(100, score))
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

function imageTags(html) {
  return String(html || '').match(/<img\b[^>]*>/gi) || []
}

function mergeMissingImages(existingHtml, importedHtml) {
  const importedImages = imageTags(importedHtml)
  if (!importedImages.length) return existingHtml

  const existing = String(existingHtml || '')
  const existingImages = imageTags(existing)
  const hasBrokenBlob = /src=["']blob:/i.test(existing)
  if (!existingImages.length || hasBrokenBlob) {
    return `${existing}<br>${importedImages.join('<br>')}`
  }

  const missingImages = importedImages.filter(img => {
    const src = img.match(/src=["']([^"']+)["']/i)?.[1]
    return src && !existing.includes(src)
  })

  return missingImages.length ? `${existing}<br>${missingImages.join('<br>')}` : existing
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
            htmlFront: mergeMissingImages(existing.htmlFront, newCard.htmlFront),
            htmlBack: mergeMissingImages(existing.htmlBack, newCard.htmlBack),
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
  const fontColors = ['#111827', '#2563eb', '#b42318', '#db2777', '#167047']
  const highlightColors = ['#fff200', '#bfdbfe', '#fbcfe8', '#fecaca', '#93c5fd']

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

  function clearHighlight() {
    runCommand('hiliteColor', 'transparent')
  }

  return (
    <div className="rich-editor">
      <div className="rich-toolbar">
        <button type="button" className="tool-button" onMouseDown={e => { e.preventDefault(); runCommand('bold') }}>B</button>
        <button type="button" className="tool-button" onMouseDown={e => { e.preventDefault(); insertSymbol('≥') }}>≥</button>
        <button type="button" className="tool-button" onMouseDown={e => { e.preventDefault(); insertSymbol('≤') }}>≤</button>
        <span className="toolbar-label">Fonte</span>
        {fontColors.map(color => (
          <button type="button" aria-label={`Fonte ${color}`} className="color-button" key={`font-${color}`} style={{ background: color }} onMouseDown={e => { e.preventDefault(); runCommand('foreColor', color) }} />
        ))}
        <span className="toolbar-label">Grifo</span>
        {highlightColors.map(color => (
          <button type="button" aria-label={`Grifo ${color}`} className="color-button" key={`highlight-${color}`} style={{ background: color }} onMouseDown={e => { e.preventDefault(); runCommand('hiliteColor', color) }} />
        ))}
        <button type="button" className="tool-button clear-highlight" onMouseDown={e => { e.preventDefault(); clearHighlight() }}>×</button>
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
  const [importBusy, setImportBusy] = useState(false)
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
  const [studyTag, setStudyTag] = useState('')
  const [focusedCardIds, setFocusedCardIds] = useState([])
  const [newFront, setNewFront] = useState('')
  const [newBack, setNewBack] = useState('')
  const [splitCardId, setSplitCardId] = useState(null)
  const [splitParts, setSplitParts] = useState([])
  const [splitSuspendOriginal, setSplitSuspendOriginal] = useState(true)
  const answerRef = useRef(null)

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
      clearStoredAuthSession()

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

  const activeCards = useMemo(() => cards.filter(card => !card.deleted), [cards])
  const suspendedCount = activeCards.filter(card => card.suspended).length
  const deletedCount = cards.filter(card => card.deleted).length
  const allTags = useMemo(() => {
    const tags = new Set()
    activeCards.forEach(card => {
      String(card.tags || '').split(/\s+/).map(t => t.trim()).filter(Boolean).forEach(t => tags.add(t))
    })
    return Array.from(tags).sort((a, b) => a.localeCompare(b))
  }, [activeCards])
  const focusedCards = useMemo(() => {
    const ids = new Set(focusedCardIds)
    return activeCards.filter(c => ids.has(c.id))
  }, [activeCards, focusedCardIds])
  const dueCards = useMemo(() => {
    const base = focusedCards.length
      ? focusedCards
      : activeCards.filter(c => !c.suspended && (!studyTag || String(c.tags || '').split(/\s+/).includes(studyTag)))
    return focusedCards.length ? base : base.filter(c => !c.dueAt || c.dueAt <= Date.now())
  }, [activeCards, focusedCards, studyTag])
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
  const masteryEntries = activeCards.map(card => Number(stats.masteryByCard?.[card.id]?.bestPercent || 0))
  const masteryAverage = activeCards.length ? Math.round(masteryEntries.reduce((sum, value) => sum + value, 0) / activeCards.length) : 0
  const masteredCount = masteryEntries.filter(value => value >= 80).length
  const partialCount = masteryEntries.filter(value => value >= 60 && value < 80).length
  const weakCount = Math.max(0, activeCards.length - masteredCount - partialCount)
  const masteryGap = Math.max(0, 80 - masteryAverage)
  const recentHistory = (stats.history || []).slice(-50)
  const previousHistory = (stats.history || []).slice(-100, -50)
  const recentAverage = recentHistory.length ? Math.round(recentHistory.reduce((sum, item) => sum + Number(item.percent || 0), 0) / recentHistory.length) : 0
  const previousAverage = previousHistory.length ? Math.round(previousHistory.reduce((sum, item) => sum + Number(item.percent || 0), 0) / previousHistory.length) : null
  const recentTrend = previousAverage == null ? null : recentAverage - previousAverage
  const performanceDays = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(Date.now() - (29 - index) * DAY)
    const key = date.toISOString().slice(0, 10)
    const dayHistory = (stats.history || []).filter(item => String(item.date || '').slice(0, 10) === key)
    const avgPercent = dayHistory.length
      ? Math.round(dayHistory.reduce((sum, item) => sum + Number(item.percent || 0), 0) / dayHistory.length)
      : 0
    return {
      key,
      label: key.slice(5).replace('-', '/'),
      count: Number(stats.daily?.[key] || 0),
      avgPercent
    }
  })
  const maxPerformanceCount = Math.max(1, ...performanceDays.map(day => day.count))
  const currentAlreadyAnswered = !!current && (
    pendingGrade?.cardId === current.id ||
    feedback?.cardId === current.id
  )
  const filteredCards = activeCards.filter(c => {
    const q = normalize(searchTerm)
    if (!q) return true
    return normalize(`${c.pergunta || ''} ${c.resposta || ''} ${c.tags || ''}`).includes(q)
  })
  const statsPanel = (
    <>
      <section className="stats">
        <div><Trophy/><span>Acertos</span><b>{stats.correct}</b></div>
        <div><XCircle/><span>Erros</span><b>{stats.wrong}</b></div>
        <div><Flame/><span>Sequência atual</span><b>{stats.streak}</b></div>
        <div><CalendarDays/><span>Dias seguidos</span><b>{stats.studyStreak}</b></div>
        <div><ListChecks/><span>Feitos hoje</span><b>{todayDone}</b></div>
        <div><Clock/><span>Faltam hoje</span><b>{remainingToday}</b></div>
        <div><Clock/><span>Tempo</span><b>{formatTime(cardSeconds)}</b></div>
        <div><Target/><span>Vencidos agora</span><b>{dueCards.length}</b></div>
        <div><ImageIcon/><span>Total no deck</span><b>{activeCards.length}</b></div>
        <div><Target/><span>Domínio do deck</span><b>{masteryAverage}%</b></div>
        <div><BarChart3/><span>Precisão geral</span><b>{accuracy}%</b></div>
      </section>
      <div className="bar"><div style={{width: `${progress}%`}} /></div>
    </>
  )

  useEffect(() => {
  if (!ready || !logged || !user) return

  try {
    localStorage.setItem('mq_cards', JSON.stringify(cards))
  } catch (err) {
    console.warn('Nao foi possivel salvar cards no navegador.', err)
    setSyncStatus('Deck grande demais para salvar neste navegador. Tentando salvar na nuvem...')
  }

  const saveCards = async () => {
    setSyncStatus('Salvando progresso...')
    const { error } = await supabase
      .from('profiles')
      .upsert({
        id: user.id,
        email: user.email,
        cards: cards
      })

    setSyncStatus(error ? `Erro ao salvar cards: ${error.message}` : 'Progresso salvo.')
  }

  saveCards()
}, [cards, ready, logged, user])

  useEffect(() => {
    if (!ready) return
    try {
      localStorage.setItem('mq_config', JSON.stringify(config))
    } catch (err) {
      console.warn('Nao foi possivel salvar configuracoes no navegador.', err)
    }
  }, [config, ready])

  useEffect(() => {
  if (!ready || !logged || !user) return

  try {
    localStorage.setItem('mq_stats', JSON.stringify(stats))
  } catch (err) {
    console.warn('Nao foi possivel salvar estatisticas no navegador.', err)
    setSyncStatus('Estatisticas grandes demais para salvar neste navegador. Tentando salvar na nuvem...')
  }

  const saveStats = async () => {
    setSyncStatus('Salvando progresso...')
    const { error } = await supabase
      .from('profiles')
      .upsert({
        id: user.id,
        email: user.email,
        stats: stats
      })

    setSyncStatus(error ? `Erro ao salvar estatisticas: ${error.message}` : 'Progresso salvo.')
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
    clearStoredAuthSession()
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
    let lastStudyDate = oldStats.lastStudyDate || ''

    if (daily[t] >= STREAK_MIN_CARDS && lastStudyDate !== t) {
      studyStreak = oldStats.lastStudyDate === yesterday ? studyStreak + 1 : 1
      lastStudyDate = t
    }

    return { daily, studyStreak, lastStudyDate }
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
    const userText = answer
    let percent = 0

    if (cardForAnswer.isCloze && cardForAnswer.clozeAnswers?.length) {
      const scores = cardForAnswer.clozeAnswers.map(item => semanticScore(item, userText))
      percent = Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
    } else {
      percent = semanticScore(cardForAnswer.resposta || stripHtml(cardForAnswer.htmlBack), userText)
    }

    const grade = percent < 60 ? 'again' : percent < 80 ? 'hard' : percent < 90 ? 'good' : 'easy'
    const isCorrect = percent >= 80
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
        masteryByCard: {
          ...(prev.masteryByCard || {}),
          [current.id]: {
            bestPercent: Math.max(Number(prev.masteryByCard?.[current.id]?.bestPercent || 0), percent),
            lastPercent: percent,
            lastGrade: grade,
            updatedAt: new Date().toISOString()
          }
        },
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
      type: percent >= 80 ? 'good' : percent >= 60 ? 'medium' : 'bad',
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

  function insertAnswerSymbol(symbol) {
    const input = answerRef.current
    if (!input) {
      setAnswer(prev => `${prev}${symbol}`)
      return
    }
    const start = input.selectionStart ?? answer.length
    const end = input.selectionEnd ?? answer.length
    const next = `${answer.slice(0, start)}${symbol}${answer.slice(end)}`
    setAnswer(next)
    window.setTimeout(() => {
      input.focus()
      input.setSelectionRange(start + symbol.length, start + symbol.length)
    }, 0)
  }

  function handleAnswerKeyDown(event) {
    if (!event.altKey) return
    if (event.key === '.' || event.key === '>') {
      event.preventDefault()
      insertAnswerSymbol('≥')
    }
    if (event.key === ',' || event.key === '<') {
      event.preventDefault()
      insertAnswerSymbol('≤')
    }
  }

  function markCurrentAsCorrect() {
    if (!current || !feedback || feedback.cardId !== current.id) return
    const previousGrade = feedback.grade || pendingGrade?.grade || 'again'
    const wasCorrect = feedback.percent >= 80
    const correctedGrade = 'good'

    setPendingGrade({ cardId: current.id, grade: correctedGrade })
    setCards(prev => prev.map(card => card.id === current.id ? {
      ...card,
      correctCount: Math.max(Number(card.correctCount || 0), 1)
    } : card))
    const nextCorrectCount = Math.max(Number(current.correctCount || 0), 1) + 1
    setFeedback(prev => prev ? {
      ...prev,
      type: 'good',
      grade: correctedGrade,
      percent: Math.max(Number(prev.percent || 0), 80),
      text: `Marcado manualmente como acerto. Resultado anterior: ${prev.percent}%.`,
      scheduleLabel: nextCorrectCount === 2 ? '1 dia' : nextCorrectCount === 3 ? '1 semana' : nextCorrectCount === 4 ? '15 dias' : '1 mês'
    } : prev)

    setStats(prevRaw => {
      const prev = safeStats(prevRaw)
      const history = [...(prev.history || [])]
      const lastIndex = history.map(item => item.id).lastIndexOf(current.id)
      if (lastIndex >= 0) {
        history[lastIndex] = {
          ...history[lastIndex],
          percent: Math.max(Number(history[lastIndex].percent || 0), 80),
          grade: correctedGrade,
          correct: true,
          manuallyCorrected: true
        }
      }
      const byGrade = { ...prev.byGrade }
      if (byGrade[previousGrade] > 0) byGrade[previousGrade] -= 1
      byGrade[correctedGrade] = (byGrade[correctedGrade] || 0) + (wasCorrect ? 0 : 1)

      return {
        ...prev,
        correct: (prev.correct || 0) + (wasCorrect ? 0 : 1),
        wrong: Math.max(0, (prev.wrong || 0) - (wasCorrect ? 0 : 1)),
        streak: wasCorrect ? prev.streak : Math.max(1, prev.streak || 0),
        record: Math.max(prev.record || 0, wasCorrect ? prev.streak || 0 : Math.max(1, prev.streak || 0)),
        history,
        masteryByCard: {
          ...(prev.masteryByCard || {}),
          [current.id]: {
            bestPercent: Math.max(Number(prev.masteryByCard?.[current.id]?.bestPercent || 0), 80),
            lastPercent: 80,
            lastGrade: correctedGrade,
            manuallyCorrected: true,
            updatedAt: new Date().toISOString()
          }
        },
        byGrade
      }
    })
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

  function studySingleCard(cardId) {
    setFocusedCardIds([cardId])
    setStudyTag('')
    setIndex(0)
    setAnswer('')
    setFeedback(null)
    setPendingGrade(null)
    setEditing(false)
    setTab('study')
  }

  function editCardFromLibrary(cardId) {
    const card = activeCards.find(c => c.id === cardId)
    if (!card) return
    const v = getCardView(card)
    setFocusedCardIds([cardId])
    setStudyTag('')
    setIndex(0)
    setAnswer('')
    setFeedback(null)
    setPendingGrade(null)
    setEditFront(v.htmlFront || v.pergunta || '')
    setEditBack(v.htmlBack || v.resposta || '')
    setEditing(true)
    setTab('study')
  }

  function toggleSuspendCard(cardId) {
    let suspended = false
    setCards(prev => prev.map(card => {
      if (card.id !== cardId) return card
      suspended = !card.suspended
      return {
        ...card,
        suspended,
        suspendedAt: suspended ? new Date().toISOString() : null,
        dueAt: suspended ? card.dueAt : Date.now(),
        manualEditedAt: new Date().toISOString()
      }
    }))
    setImportLog(suspended ? 'Card suspenso. Ele nao aparecera nas revisoes normais.' : 'Card reativado. Ele voltou para as revisoes.')
  }

  function deleteCardFromLibrary(cardId) {
    const card = activeCards.find(c => c.id === cardId)
    if (!card) return
    const ok = window.confirm('Excluir este flashcard da biblioteca? Ele nao aparecera nas revisoes e nao voltara em novas importacoes do Anki.')
    if (!ok) return
    setCards(prev => prev.map(c => c.id === cardId ? {
      ...c,
      deleted: true,
      deletedAt: new Date().toISOString(),
      manualEditedAt: new Date().toISOString()
    } : c))
    if (lastAnsweredId === cardId) setLastAnsweredId(null)
    setFocusedCardIds(prev => prev.filter(id => id !== cardId))
    setFeedback(prev => prev?.cardId === cardId ? null : prev)
    setPendingGrade(prev => prev?.cardId === cardId ? null : prev)
    setImportLog('Card excluido da biblioteca.')
  }

  function startSplitCard(cardId) {
    const card = activeCards.find(c => c.id === cardId)
    if (!card) return
    const v = getCardView(card)
    const parts = suggestSplitParts(v.htmlBack || v.resposta)
    setSplitCardId(cardId)
    setSplitParts(parts.length ? parts : [v.resposta || ''])
    setSplitSuspendOriginal(true)
  }

  function updateSplitPart(index, value) {
    setSplitParts(prev => prev.map((part, i) => i === index ? value : part))
  }

  function removeSplitPart(index) {
    setSplitParts(prev => prev.filter((_, i) => i !== index))
  }

  function createSplitCards() {
    const sourceCard = activeCards.find(c => c.id === splitCardId)
    if (!sourceCard) return
    const v = getCardView(sourceCard)
    const cleanParts = splitParts.map(part => part.trim()).filter(Boolean)
    if (!cleanParts.length) {
      setImportLog('A quebra precisa ter pelo menos uma parte preenchida.')
      return
    }

    const now = Date.now()
    const created = cleanParts.map((part, idx) => {
      const front = `${v.htmlFront || v.pergunta}<br><strong>Parte ${idx + 1} de ${cleanParts.length}</strong>`
      const back = part.replace(/\r?\n/g, '<br>')
      return {
        ...sourceCard,
        id: `split-${sourceCard.id}-${now}-${idx}`,
        pergunta: stripHtml(front),
        resposta: stripHtml(back),
        htmlFront: front,
        htmlBack: back,
        dueAt: Date.now(),
        reps: 0,
        correctCount: 0,
        manualEditedAt: new Date().toISOString(),
        parentCardId: sourceCard.id,
        splitFromCard: true,
        suspended: false,
        deleted: false,
        palavras: normalize(back).split(' ').filter(w => w.length > 3).slice(0, 12)
      }
    })

    setCards(prev => [
      ...prev.map(card => card.id === sourceCard.id && splitSuspendOriginal ? {
        ...card,
        suspended: true,
        suspendedAt: new Date().toISOString(),
        manualEditedAt: new Date().toISOString()
      } : card),
      ...created
    ])
    setSplitCardId(null)
    setSplitParts([])
    setImportLog(`${created.length} cards menores criados${splitSuspendOriginal ? ' e card original suspenso' : ''}.`)
  }

  function clearStudyFilter() {
    setFocusedCardIds([])
    setStudyTag('')
    setIndex(0)
    setAnswer('')
    setFeedback(null)
    setPendingGrade(null)
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

    const rows = activeCards.map(card => {
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
    setImportLog(`${activeCards.length} cards exportados para importar no Anki.`)
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
          setImportLog(`Importacao concluida: ${result.added} cards novos adicionados, ${result.updated} cards ja existentes atualizados, ${result.preservedEdited} edicoes do site preservadas. Total no deck: ${result.merged.filter(card => !card.deleted).length}.`)
          return result.merged
        })
        setIndex(0)
      } else {
        setImportLog('Nao consegui ler o CSV. Use: pergunta;resposta;imagem(opcional)')
      }
    }
    reader.onerror = () => setImportLog('Erro ao ler o arquivo CSV. Tente exportar novamente e importar de novo.')
    reader.readAsText(file, 'utf-8')
    if (e.target) e.target.value = ''
  }

  async function importAPKG(e) {
    const file = e.target.files?.[0]
    if (!file || importBusy) return
    setImportBusy(true)
    setImportLog('Importando APKG...')
    await new Promise(resolve => setTimeout(resolve, 0))
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
        setImportLog(`Importacao concluida: ${result.added} cards novos adicionados, ${result.updated} cards ja existentes atualizados, ${result.preservedEdited} edicoes do site preservadas. Midias encontradas: ${Object.keys(mediaMap).length}. Total no deck: ${result.merged.filter(card => !card.deleted).length}.`)
        return result.merged
      })
      setIndex(0)
    } catch (err) {
      console.error(err)
      setImportLog(`Erro ao importar APKG: ${err.message || String(err)}`)
    } finally {
      setImportBusy(false)
      if (e.target) e.target.value = ''
    }
  }

  if (!ready) return <div className="loading">Carregando...</div>

  if (!logged) {
    return (
      <main className="login-page">
        <section className="login-card">
          <div className="lock"><Lock size={34}/></div>
          <h1>MedQuest Anki</h1>
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
    <main className={`app ${tab === 'study' ? 'study-mode' : ''}`}>
      <header className="top">
        <div>
          <h1>MedQuest Anki</h1>
        </div>
        <div className="profile">
          <span>{user?.email}</span>
          <button onClick={cloudLogout}><LogOut size={20}/> Sair</button>
        </div>
      </header>
      {syncStatus && <div className="sync-status">{syncStatus}</div>}
      {importLog && (
        <div className={`import-status ${importLog.startsWith('Erro') || importLog.startsWith('Nao') ? 'bad' : 'good'}`}>
          {importLog}
        </div>
      )}

      <nav className="tabs">
        <button className={tab==='study'?'active':''} onClick={()=>setTab('study')}><Brain size={18}/> Estudar</button>
        <button className={tab==='cards'?'active':''} onClick={()=>setTab('cards')}><Eye size={18}/> Ver flashcards</button>
        <button className={tab==='import'?'active':''} onClick={()=>setTab('import')}><Upload size={18}/> Importar</button>
        <button className={tab==='create'?'active':''} onClick={()=>setTab('create')}><Plus size={18}/> Criar card</button>
        <button className={tab==='stats'?'active':''} onClick={()=>setTab('stats')}><BarChart3 size={18}/> Estatísticas</button>
        <button className={tab==='settings'?'active':''} onClick={()=>setTab('settings')}><Settings size={18}/> Configurações</button>
      </nav>

      {tab !== 'study' && (
      <>
      <section className="stats">
        <div><Trophy/><span>Acertos</span><b>{stats.correct}</b></div>
        <div><XCircle/><span>Erros</span><b>{stats.wrong}</b></div>
        <div><Flame/><span>Sequência atual</span><b>{stats.streak}</b></div>
        <div><CalendarDays/><span>Dias seguidos</span><b>{stats.studyStreak}</b></div>
        <div><ListChecks/><span>Feitos hoje</span><b>{todayDone}</b></div>
        <div><Clock/><span>Faltam hoje</span><b>{remainingToday}</b></div>
        <div><Clock/><span>Tempo</span><b>{formatTime(cardSeconds)}</b></div>
        <div><Target/><span>Vencidos agora</span><b>{dueCards.length}</b></div>
        <div><ImageIcon/><span>Total no deck</span><b>{activeCards.length}</b></div>
        <div><BarChart3/><span>Precisão geral</span><b>{accuracy}%</b></div>
      </section>

      <div className="bar"><div style={{width: `${progress}%`}} /></div>
      </>
      )}

      {tab === 'study' && (
        <>
        <section className="card study-card">
          <div className="study-filters">
            <label>
              Revisar tag
              <select
                value={studyTag}
                onChange={e => {
                  setStudyTag(e.target.value)
                  setFocusedCardIds([])
                  setIndex(0)
                  setAnswer('')
                  setFeedback(null)
                  setPendingGrade(null)
                  setEditing(false)
                }}
              >
                <option value="">Todos os cards vencidos</option>
                {allTags.map(tag => <option key={tag} value={tag}>{tag}</option>)}
              </select>
            </label>
            {(studyTag || focusedCardIds.length > 0) && (
              <button className="secondary" onClick={clearStudyFilter}>Limpar filtro</button>
            )}
          </div>
          {studyTag && <p className="hint">Revisando apenas cards vencidos com a tag: <b>{studyTag}</b>.</p>}
          {focusedCardIds.length > 0 && <p className="hint">Revisando card selecionado manualmente.</p>}
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

              {!editing && (
                <div className="answer-entry">
                  <div className="answer-tools">
                    <button className="secondary" onClick={() => insertAnswerSymbol('≥')} type="button" title="Alt + .">≥</button>
                    <button className="secondary" onClick={() => insertAnswerSymbol('≤')} type="button" title="Alt + ,">≤</button>
                  </div>
                  <textarea ref={answerRef} value={answer} onChange={e=>setAnswer(e.target.value)} onKeyDown={handleAnswerKeyDown} placeholder="Digite sua resposta aqui..." />
                </div>
              )}
              <div className="actions">
                <button onClick={evaluate} disabled={currentAlreadyAnswered || editing}><CheckCircle2 size={18}/> Responder</button>
                <button className="secondary" onClick={nextCard}>Próximo</button>
                <button className="secondary" onClick={goToLastAnswered} disabled={!lastAnsweredId}>Voltar último</button>
                <button className="secondary" onClick={startEdit}>Editar card</button>
              </div>
              {feedback && feedback.cardId === current.id && (
                <div className={`feedback ${feedback.type}`}>
                  <div className="score-line">{feedback.text}</div>
                  <div className="feedback-actions">
                    <div className="pill">Agendamento: {feedback.scheduleLabel}</div>
                    {feedback.percent < 80 && <button className="secondary" onClick={markCurrentAsCorrect}><CheckCircle2 size={18}/> Marcar como acerto</button>}
                  </div>
                  <div className="answer-box">
                    <b>Resposta esperada:</b>
                    <div dangerouslySetInnerHTML={{__html: currentView.htmlBack || feedback.expected}} />
                  </div>
                </div>
              )}
            </>
          )}
        </section>
        <div className="stats-below">{statsPanel}</div>
        </>
      )}

      {tab === 'cards' && (
        <section className="card">
          <h2>Biblioteca de flashcards</h2>
          <input
            value={searchTerm}
            onChange={e=>setSearchTerm(e.target.value)}
            placeholder="Buscar flashcard por pergunta, resposta ou tag..."
            className="search-input"
          />
          <div className="tag-cloud">
            {allTags.map(tag => (
              <button
                className={studyTag === tag ? 'active' : ''}
                key={tag}
                onClick={() => {
                  setStudyTag(tag)
                  setFocusedCardIds([])
                  setIndex(0)
                  setTab('study')
                }}
              >
                {tag}
              </button>
            ))}
          </div>
          <p className="hint">{filteredCards.length} de {activeCards.length} flashcards encontrados. Suspensos: {suspendedCount}. Excluidos preservados: {deletedCount}.</p>
          <div className="grid-cards">
            {filteredCards.map((c, i) => {
              const v = getCardView(c)
              return (
                <div className={`mini ${c.suspended ? 'suspended' : ''}`} key={c.id}>
                  {c.suspended && <span className="status-chip">Suspenso</span>}
                  <b>{i+1}. {v.pergunta}</b>
                  <div dangerouslySetInnerHTML={{__html: v.htmlFront || v.pergunta}} />
                  <p><b>Resposta:</b> {v.resposta}</p>
                  <div className="library-actions">
                    <button className="secondary" onClick={() => studySingleCard(c.id)}><Eye size={16}/> Revisar</button>
                    <button className="secondary" onClick={() => editCardFromLibrary(c.id)}><Pencil size={16}/> Editar</button>
                    <button className="secondary" onClick={() => startSplitCard(c.id)}><Scissors size={16}/> Quebrar</button>
                    <button className="secondary" onClick={() => toggleSuspendCard(c.id)}>
                      {c.suspended ? <PlayCircle size={16}/> : <PauseCircle size={16}/>} {c.suspended ? 'Reativar' : 'Suspender'}
                    </button>
                    <button className="danger-button" onClick={() => deleteCardFromLibrary(c.id)}><Trash2 size={16}/> Excluir</button>
                  </div>
                  {splitCardId === c.id && (
                    <div className="split-box">
                      <b>Quebrar em cards menores</b>
                      <p className="hint">Revise as partes sugeridas antes de criar. Cada campo vira um novo flashcard com a mesma pergunta.</p>
                      {splitParts.map((part, partIndex) => (
                        <div className="split-part" key={partIndex}>
                          <textarea value={part} onChange={e => updateSplitPart(partIndex, e.target.value)} />
                          <button className="secondary" onClick={() => removeSplitPart(partIndex)}>Remover</button>
                        </div>
                      ))}
                      <div className="actions">
                        <button className="secondary" onClick={() => setSplitParts(prev => [...prev, ''])}><Plus size={16}/> Adicionar parte</button>
                        <label><input type="checkbox" checked={splitSuspendOriginal} onChange={e => setSplitSuspendOriginal(e.target.checked)}/> Suspender card original</label>
                      </div>
                      <div className="actions">
                        <button onClick={createSplitCards}><Scissors size={16}/> Criar cards menores</button>
                        <button className="secondary" onClick={() => setSplitCardId(null)}>Cancelar</button>
                      </div>
                    </div>
                  )}
                  <small>{v.isCloze ? 'Cloze | ' : ''}Reps: {v.reps || 0} | Acertos: {v.correctCount || 0} | Proxima revisao: {new Date(v.dueAt || Date.now()).toLocaleString('pt-BR')}</small>
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
            <label className={`import ${importBusy ? 'disabled' : ''}`}>
              <Upload size={18}/> {importBusy ? 'Importando...' : 'Importar .APKG'}
              <input type="file" accept=".apkg" onChange={importAPKG} disabled={importBusy}/>
            </label>
            <label className={`import dark ${importBusy ? 'disabled' : ''}`}>
              <Upload size={18}/> Importar CSV
              <input type="file" accept=".csv,.txt" onChange={importCSV} disabled={importBusy}/>
            </label>
            <button className="secondary" onClick={exportToAnki} disabled={importBusy}><Download size={18}/> Exportar para Anki</button>
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
          <div className="mastery-panel">
            <div className="mastery-head">
              <div>
                <span>Domínio geral do deck</span>
                <b>{masteryAverage}%</b>
              </div>
              <strong>Meta: 80%</strong>
            </div>
            <div className="mastery-track">
              <i style={{width: `${Math.min(100, masteryAverage)}%`}} />
              <em style={{left: '80%'}} />
            </div>
            <p className="hint">
              {masteryGap === 0
                ? 'Você já está acima da meta de domínio de 80% do conteúdo.'
                : `Faltam ${masteryGap} pontos percentuais para atingir 80% de domínio geral.`}
              {recentTrend != null && ` Nas últimas 50 respostas, sua média ficou em ${recentAverage}% (${recentTrend >= 0 ? '+' : ''}${recentTrend} pontos vs. as 50 anteriores).`}
            </p>
            <p className="hint">O streak só conta nos dias com pelo menos {STREAK_MIN_CARDS} cards respondidos.</p>
            <div className="mastery-breakdown">
              <div className="mastery-ok"><b>{masteredCount}</b><span>Cards dominados<br/>80-100%</span></div>
              <div className="mastery-mid"><b>{partialCount}</b><span>Em progresso<br/>60-79%</span></div>
              <div className="mastery-bad"><b>{weakCount}</b><span>Prioridade<br/>0-59%</span></div>
            </div>
          </div>
          <h3>Gráficos de estudo</h3>
          <div className="chart-grid">
            <div className="chart-box">
              <h4>Cards por dia</h4>
              <div className="bar-chart">
                {performanceDays.map(day => (
                  <div className="chart-day" key={day.key}>
                    <span style={{height: `${Math.max(3, (day.count / maxPerformanceCount) * 100)}%`}} className={day.count >= STREAK_MIN_CARDS ? 'met' : ''} title={`${day.label}: ${day.count} cards`} />
                    <small>{day.label}</small>
                  </div>
                ))}
              </div>
              <p className="chart-note">Linha mental: 10 cards/dia para manter streak.</p>
            </div>
            <div className="chart-box">
              <h4>Acurácia diária</h4>
              <div className="accuracy-chart">
                {performanceDays.map(day => (
                  <div className="accuracy-row" key={day.key}>
                    <span>{day.label}</span>
                    <div><i style={{width: `${day.avgPercent}%`}} className={day.avgPercent >= 80 ? 'good-line' : day.avgPercent >= 60 ? 'mid-line' : 'bad-line'} /></div>
                    <b>{day.avgPercent || '--'}{day.avgPercent ? '%' : ''}</b>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="advanced-grid">
            <div className="advanced-box"><span>Precisão geral</span><b>{accuracy}%</b><small>{stats.correct} acertos de {totalAnswered}</small></div>
            <div className="advanced-box"><span>Tempo médio</span><b>{formatTime(avgTime)}</b><small>Total: {formatTime(stats.totalAnswerSeconds)}</small></div>
            <div className="advanced-box"><span>Mais rápido</span><b>{stats.fastestSeconds == null ? '--' : formatTime(stats.fastestSeconds)}</b><small>Menor tempo</small></div>
            <div className="advanced-box"><span>Mais lento</span><b>{formatTime(stats.slowestSeconds)}</b><small>Maior tempo</small></div>
          </div>

          <h3>Distribuição por desempenho</h3>
          <div className="grade-grid">
            <div className="grade-bad"><b>{stats.byGrade.again}</b><span>Vermelho<br/>0-59%</span><i style={{width: `${Math.min(100, ((stats.byGrade.again || 0) / Math.max(1, totalAnswered)) * 100)}%`}} /></div>
            <div className="grade-mid"><b>{stats.byGrade.hard}</b><span>Amarelo<br/>60-79%</span><i style={{width: `${Math.min(100, ((stats.byGrade.hard || 0) / Math.max(1, totalAnswered)) * 100)}%`}} /></div>
            <div className="grade-ok"><b>{stats.byGrade.good}</b><span>Verde<br/>80-89%</span><i style={{width: `${Math.min(100, ((stats.byGrade.good || 0) / Math.max(1, totalAnswered)) * 100)}%`}} /></div>
            <div className="grade-ok"><b>{stats.byGrade.easy}</b><span>Verde+<br/>90-100%</span><i style={{width: `${Math.min(100, ((stats.byGrade.easy || 0) / Math.max(1, totalAnswered)) * 100)}%`}} /></div>
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
                <b className={scoreTone(h.percent)}>{h.percent}%</b>
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

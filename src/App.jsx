import { createClient } from '@supabase/supabase-js'
import { useEffect, useMemo, useRef, useState } from 'react'
import { initializeApp } from 'firebase/app'
import {
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut
} from 'firebase/auth'
import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  setDoc,
  waitForPendingWrites,
} from 'firebase/firestore'
import { createEmptyCard, fsrs, Rating, State } from 'ts-fsrs'
import JSZip from 'jszip'
import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import {
  Trophy, XCircle, Flame, Target, Star, LogOut, RotateCcw, Upload,
  CheckCircle2, Eye, ListChecks, Settings, ImageIcon,
  Brain, BarChart3, Plus, Download, Pencil, Trash2, PauseCircle, PlayCircle, Scissors
} from 'lucide-react'
const REMEMBER_LOGIN_KEY = 'mq_remember_login'
const CURRENT_CARD_KEY = 'mq_current_card_id'
const LOCAL_DB_NAME = 'medquest-local-vault'
const LOCAL_DB_VERSION = 1
const LOCAL_STATE_KEY = 'state'
const LOCAL_SYNC_OUTBOX_KEY = 'sync-outbox'
const LOCAL_LAST_USER_ID_KEY = 'mq_last_user_id'
const FIREBASE_CLOUD_TOKEN = 'firebase-firestore'
const FIRESTORE_PAYLOAD_CHUNK_SIZE = 650000
const authStorage = {
  getItem(key) {
    try {
      const storage = localStorage.getItem(REMEMBER_LOGIN_KEY) === 'true' ? localStorage : sessionStorage
      return storage.getItem(key)
    } catch {
      return null
    }
  },
  setItem(key, value) {
    try {
      const remembered = localStorage.getItem(REMEMBER_LOGIN_KEY) === 'true'
      const storage = remembered ? localStorage : sessionStorage
      const alternateStorage = remembered ? sessionStorage : localStorage
      storage.setItem(key, value)
      alternateStorage.removeItem(key)
    } catch {
      // Authentication can still fail normally if storage is unavailable.
    }
  },
  removeItem(key) {
    try {
      localStorage.removeItem(key)
      sessionStorage.removeItem(key)
    } catch {
      // No stored session to remove.
    }
  }
}

const authLock = async (_name, _acquireTimeout, fn) => fn()

const supabase = createClient(
  'https://lgmfmdpzmqunouysuwjp.supabase.co',
  'sb_publishable_q0Kj-XQCbt89nVlQPdsG3A_pJPvVP-7',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storage: authStorage,
      lock: authLock
    }
  }
)

const firebaseConfig = {
  apiKey: 'AIzaSyDm_rFReH_w4Div-vngi_ozCfaJFL90sbE',
  authDomain: 'medquest-e9e54.firebaseapp.com',
  projectId: 'medquest-e9e54',
  storageBucket: 'medquest-e9e54.firebasestorage.app',
  messagingSenderId: '1064594596834',
  appId: '1:1064594596834:web:9c14eaccadaa0331a64fbb',
  measurementId: 'G-E4EC4GCBWE'
}

const firebaseApp = initializeApp(firebaseConfig)
const firebaseAuth = getAuth(firebaseApp)
let firestoreDb
try {
  firestoreDb = initializeFirestore(firebaseApp, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  })
} catch {
  firestoreDb = getFirestore(firebaseApp)
}

const DAY = 24 * 60 * 60 * 1000
const STREAK_MIN_CARDS = 10
const DEFAULT_FSRS_RETENTION = 0.91
const LEARNING_STEPS = [
  { level: 0, label: '10 minutos', delayMs: 10 * 60 * 1000, scheduledDays: 0 },
  { level: 1, label: '10 minutos', delayMs: 10 * 60 * 1000, scheduledDays: 0 },
  { level: 2, label: '1 dia', delayMs: DAY, scheduledDays: 1 },
  { level: 3, label: '3 dias', delayMs: 3 * DAY, scheduledDays: 3 },
  { level: 4, label: '7 dias', delayMs: 7 * DAY, scheduledDays: 7 },
  { level: 5, label: '15 dias', delayMs: 15 * DAY, scheduledDays: 15 },
  { level: 6, label: '30 dias', delayMs: 30 * DAY, scheduledDays: 30 },
  { level: 7, label: 'Aprendido', delayMs: null, scheduledDays: 0 }
]
const MASTERED_LEVEL = LEARNING_STEPS.length - 1
const NEW_REVIEW_RATIO = 1

function normalizedRetention(value = DEFAULT_FSRS_RETENTION) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_FSRS_RETENTION
  return Math.max(0.7, Math.min(0.99, parsed > 1 ? parsed / 100 : parsed))
}

function createFsrsScheduler(retention = DEFAULT_FSRS_RETENTION) {
  return fsrs({
    request_retention: normalizedRetention(retention),
    enable_short_term: true,
    learning_steps: ['10m'],
    relearning_steps: ['10m']
  })
}

function getStoredCurrentCardId() {
  try {
    return localStorage.getItem(CURRENT_CARD_KEY) || ''
  } catch {
    return ''
  }
}

function clearStoredAuthSession() {
  try {
    ;[localStorage, sessionStorage].forEach(storage => {
      Object.keys(storage)
        .filter(key => key.startsWith('sb-') && key.includes('auth-token'))
        .forEach(key => storage.removeItem(key))
    })
  } catch (err) {
    console.warn('Nao foi possivel limpar sessao salva.', err)
  }
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
  dailyGoal: 100,
  newDailyGoal: 40,
  targetDate: '2026-09-30',
  fsrsRetention: DEFAULT_FSRS_RETENTION
}

function configuredNewDailyGoal(config = {}) {
  const configured = Number(config.newDailyGoal)
  if (Number.isFinite(configured) && configured > 0) return configured
  return DEFAULT_CONFIG.newDailyGoal
}

const DEFAULT_STATS = {
  xp: 0,
  level: 1,
  correct: 0,
  wrong: 0,
  streak: 0,
  record: 0,
  daily: {},
  dailyAnswers: {},
  dailyNewAnswers: {},
  studyStreak: 0,
  lastStudyDate: '',
  history: [],
  totalAnswerSeconds: 0,
  fastestSeconds: null,
  slowestSeconds: 0,
  masteryByCard: {},
  dailySeen: {},
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
  return dateKey(new Date())
}

function startOfDayTimestamp(now = Date.now()) {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function dateKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function targetDateFromConfig(config = {}) {
  const raw = String(config.targetDate || DEFAULT_CONFIG.targetDate || '').trim()
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return new Date(2026, 8, 30, 23, 59, 59, 999)
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59, 999)
  if (Number.isNaN(parsed.getTime())) return new Date(2026, 8, 30, 23, 59, 59, 999)
  return parsed
}

function shortDateLabel(date) {
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`
}

function openLocalDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB indisponivel.'))
      return
    }
    const request = window.indexedDB.open(LOCAL_DB_NAME, LOCAL_DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function readLocalVault(key = LOCAL_STATE_KEY) {
  const db = await openLocalDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readonly')
    const request = tx.objectStore('kv').get(key)
    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => reject(request.error)
    tx.oncomplete = () => db.close()
  })
}

async function writeLocalVault(key, value) {
  const db = await openLocalDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite')
    tx.objectStore('kv').put(value, key)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error)
    }
  })
}

async function deleteLocalVaultKeysByPrefix(prefix) {
  const db = await openLocalDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite')
    const store = tx.objectStore('kv')
    const request = store.openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      if (String(cursor.key || '').startsWith(prefix)) cursor.delete()
      cursor.continue()
    }
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error)
    }
  })
}

function localStateKeyForUser(authedUserOrId) {
  const userId = typeof authedUserOrId === 'string' ? authedUserOrId : cloudUserId(authedUserOrId)
  return userId ? `${LOCAL_STATE_KEY}:${userId}` : LOCAL_STATE_KEY
}

function localSyncOutboxKeyForUser(authedUserOrId) {
  const userId = typeof authedUserOrId === 'string' ? authedUserOrId : cloudUserId(authedUserOrId)
  return userId ? `${LOCAL_SYNC_OUTBOX_KEY}:${userId}` : LOCAL_SYNC_OUTBOX_KEY
}

async function saveLocalStateSnapshot(snapshot, key = LOCAL_STATE_KEY) {
  const now = new Date().toISOString()
  await writeLocalVault(key, { ...snapshot, savedAt: now })
}

async function readLocalSyncOutbox(key = LOCAL_SYNC_OUTBOX_KEY) {
  const items = await readLocalVault(key)
  return Array.isArray(items) ? items : []
}

async function writeLocalSyncOutbox(items, key = LOCAL_SYNC_OUTBOX_KEY) {
  await writeLocalVault(key, Array.isArray(items) ? items.slice(-1200) : [])
}

function localSyncItemId(card, event = null) {
  return `${card?.id || 'card'}:latest`
}

function compactLocalSyncItems(items = []) {
  const byCard = new Map()
  items.filter(item => item?.card?.id).forEach(item => {
    const id = localSyncItemId(item.card)
    byCard.set(id, {
      ...item,
      id,
      event: item.event || null
    })
  })
  return [...byCard.values()]
}

async function queueLocalSyncItems(itemsToQueue, key = LOCAL_SYNC_OUTBOX_KEY) {
  const incoming = (Array.isArray(itemsToQueue) ? itemsToQueue : [itemsToQueue])
    .filter(item => item?.card?.id)
    .map(item => ({
      id: item.id || localSyncItemId(item.card, item.event),
      card: item.card,
      event: item.event || null,
      queuedAt: item.queuedAt || new Date().toISOString()
    }))

  if (!incoming.length) return 0

  const existing = compactLocalSyncItems(await readLocalSyncOutbox(key))
  const byId = new Map(existing.map(item => [localSyncItemId(item.card), item]))

  incoming.forEach(item => {
    const id = localSyncItemId(item.card)
    byId.set(id, { ...item, id })
  })

  const queued = [...byId.values()]
  await writeLocalSyncOutbox(queued, key)
  return queued.length
}

function cleanCloudValue(value) {
  return JSON.parse(JSON.stringify(value ?? null))
}

function cloudUserId(authedUser = {}) {
  const source = authedUser || {}
  return String(source.uid || source.id || '')
}

function firestoreCardRef(userId, cardId) {
  return doc(firestoreDb, 'users', userId, 'cards', String(cardId))
}

function firestoreCardChunkRef(userId, cardId, index) {
  return doc(firestoreDb, 'users', userId, 'cards', String(cardId), 'payloadChunks', `c${String(index).padStart(4, '0')}`)
}

function firestoreUserRef(userId) {
  return doc(firestoreDb, 'users', userId)
}

function firestoreEventId(card, event = {}) {
  const raw = `${card?.id || 'card'}_${event.answeredAt || event.date || Date.now()}_${event.grade || ''}`
  return raw.replace(/[^\w.-]+/g, '_').slice(0, 180)
}

function firebaseErrorSummary(error) {
  const code = error?.code || ''
  const message = error?.message || String(error || '')
  if (code) return `${code}: ${message}`.slice(0, 220)
  return message.slice(0, 220)
}

function chunkText(text, size = FIRESTORE_PAYLOAD_CHUNK_SIZE) {
  const chunks = []
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size))
  }
  return chunks
}

async function readFirebaseCardPayload(userId, snapshot, options = {}) {
  const data = snapshot.data()
  if (data?.payload && typeof data.payload === 'object') return data.payload
  if (!data?.payloadChunked) return data

  const readChunks = options.server ? getDocsFromServer : getDocs
  const chunkSnaps = await readChunks(collection(firestoreDb, 'users', userId, 'cards', snapshot.id, 'payloadChunks'))
  const text = chunkSnaps.docs
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(item => item.data()?.text || '')
    .join('')

  if (!text) return data
  try {
    return JSON.parse(text)
  } catch {
    return data
  }
}

async function writeFirebaseCardPayload(userId, card) {
  const cleaned = cleanCloudValue(card)
  const payloadText = JSON.stringify(cleaned)
  const meta = {
    updatedAt: new Date().toISOString(),
    manualEditedAt: card.manualEditedAt || null,
    dueAt: card.dueAt ?? null,
    reviewLevel: Number(card.reviewLevel || 0),
    correctCount: Number(card.correctCount || 0),
    reviewAttempts: Number(card.reviewAttempts || card.siteReps || 0),
    deleted: !!card.deleted,
    suspended: !!card.suspended
  }

  if (payloadText.length <= FIRESTORE_PAYLOAD_CHUNK_SIZE) {
    await setDoc(firestoreCardRef(userId, card.id), {
      ...meta,
      payload: cleaned,
      payloadChunked: false,
      payloadChunkCount: 0
    }, { merge: true })
    return
  }

  const chunks = chunkText(payloadText)
  await setDoc(firestoreCardRef(userId, card.id), {
    ...meta,
    payload: null,
    payloadPreview: {
      id: card.id,
      pergunta: String(card.pergunta || '').slice(0, 500),
      resposta: String(card.resposta || '').slice(0, 500),
      tags: card.tags || ''
    },
    payloadChunked: true,
    payloadChunkCount: chunks.length
  }, { merge: true })

  await Promise.all(chunks.map((text, index) => {
    return setDoc(firestoreCardChunkRef(userId, card.id, index), { text, index }, { merge: true })
  }))
}

function waitForFirebaseUser(timeoutMs = 3000) {
  return new Promise(resolve => {
    let settled = false
    let unsubscribe = () => {}
    const finish = user => {
      if (settled) return
      settled = true
      unsubscribe()
      resolve(user || null)
    }
    unsubscribe = onAuthStateChanged(firebaseAuth, finish, () => finish(null))
    window.setTimeout(() => finish(firebaseAuth.currentUser), timeoutMs)
  })
}

async function getFirebaseProfile(authedUser, options = {}) {
  const userId = cloudUserId(authedUser)
  if (!userId) return null

  const readUser = options.server ? getDocFromServer : getDoc
  const readCards = options.server ? getDocsFromServer : getDocs

  const [userSnap, cardSnaps] = await Promise.all([
    readUser(firestoreUserRef(userId)),
    readCards(collection(firestoreDb, 'users', userId, 'cards'))
  ])

  const userData = userSnap.exists() ? userSnap.data() : {}
  const cards = []
  for (const snapshot of cardSnaps.docs) {
    const payload = await readFirebaseCardPayload(userId, snapshot, options)
    if (payload?.id) cards.push(payload)
  }

  return {
    cards,
    stats: userData?.stats && typeof userData.stats === 'object' ? userData.stats : null,
    firebaseReady: true,
    email: userData?.email || authedUser.email || null,
    source: options.server ? 'server' : 'cache'
  }
}

async function saveFirebaseProfile(authedUser, nextCards, nextStats) {
  const userId = cloudUserId(authedUser)
  if (!userId) throw new Error('Usuario Firebase invalido.')

  const payload = {
    email: authedUser.email || '',
    updatedAt: new Date().toISOString()
  }
  if (nextStats && typeof nextStats === 'object') payload.stats = cleanCloudValue(nextStats)

  await setDoc(firestoreUserRef(userId), payload, { merge: true })

  if (Array.isArray(nextCards) && nextCards.length) {
    await saveFirebaseCardsBatch(authedUser, nextCards)
  }

  await withTimeout(waitForPendingWrites(firestoreDb), 15000, 'Firebase nao confirmou as gravacoes a tempo.')
}

async function saveFirebaseCard(authedUser, card, event = null) {
  const userId = cloudUserId(authedUser)
  if (!userId || !card?.id) throw new Error('Card Firebase invalido.')

  await writeFirebaseCardPayload(userId, card)

  if (event) {
    await setDoc(doc(firestoreDb, 'users', userId, 'reviewEvents', firestoreEventId(card, event)), {
      ...cleanCloudValue(event),
      cardId: card.id,
      answeredAt: event.answeredAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, { merge: true })
  }
}

async function saveFirebaseCardsBatch(authedUser, cardBatch) {
  const userId = cloudUserId(authedUser)
  const cards = Array.isArray(cardBatch) ? cardBatch.filter(card => card?.id) : []
  if (!userId || !cards.length) return

  const failed = []
  let synced = 0

  for (let start = 0; start < cards.length; start += 20) {
    const results = await Promise.allSettled(cards.slice(start, start + 20).map(card => writeFirebaseCardPayload(userId, card)))
    results.forEach((result, index) => {
      const card = cards[start + index]
      if (result.status === 'fulfilled') {
        synced += 1
      } else {
        failed.push({ card, error: result.reason })
      }
    })
    await new Promise(resolve => window.setTimeout(resolve, 80))
  }

  if (failed.length) {
    await queueLocalSyncItems(failed.map(item => ({ card: item.card })), localSyncOutboxKeyForUser(authedUser)).catch(err => {
      console.warn('Nao foi possivel guardar cards falhos na fila local.', err)
    })
  }

  if (failed.length && synced === 0) {
    throw new Error(`Firebase nao salvou o lote: ${firebaseErrorSummary(failed[0].error)}`)
  }

  if (synced > 0) {
    await withTimeout(waitForPendingWrites(firestoreDb), 15000, 'Firebase nao confirmou as gravacoes a tempo.')
  }

  return { synced, failed: failed.length }
}

function addCalendarDaysTimestamp(timestamp, days) {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + Number(days || 0))
  return date.getTime()
}

function hashString(value) {
  return String(value || '').split('').reduce((hash, char) => {
    return ((hash << 5) - hash + char.charCodeAt(0)) | 0
  }, 0)
}

function dueTimestamp(card, fallback = Date.now()) {
  const raw = card?.dueAt
  if (raw == null || raw === '') return fallback

  const numericValue = Number(raw)
  if (Number.isFinite(numericValue) && numericValue > 0) return numericValue

  if (typeof raw === 'string') {
    const parsedValue = Date.parse(raw)
    if (Number.isFinite(parsedValue) && parsedValue > 0) return parsedValue

    const brDate = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
    if (brDate) {
      const [, day, month, year, hour = '0', minute = '0', second = '0'] = brDate
      const localDate = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
      const localTime = localDate.getTime()
      if (Number.isFinite(localTime) && localTime > 0) return localTime
    }
  }

  return fallback
}

function optionalTimestamp(raw) {
  if (raw == null || raw === '') return 0

  const numericValue = Number(raw)
  if (Number.isFinite(numericValue) && numericValue > 0) return numericValue

  if (typeof raw === 'string') {
    const parsedValue = Date.parse(raw)
    if (Number.isFinite(parsedValue) && parsedValue > 0) return parsedValue
  }

  return 0
}

function hasScheduledDue(card) {
  const raw = card?.dueAt
  if (raw == null || raw === '') return false
  return dueTimestamp(card, NaN) > 0
}

function hasReviewHistory(card) {
  if (card?.fsrsState != null || card?.fsrsLastReview || Array.isArray(card?.fsrsHistory)) return true
  return Number(card?.siteReps || 0) > 0 ||
    Number(card?.correctCount || 0) > 0 ||
    Number(card?.reviewLevel || 0) > 0 ||
    Number(card?.stageProgress || 0) > 0 ||
    Boolean(card?.lastGrade)
}

function fsrsStateFromCard(card) {
  const raw = card?.fsrsState
  if (raw === State.New || raw === 'New') return State.New
  if (raw === State.Learning || raw === 'Learning') return State.Learning
  if (raw === State.Review || raw === 'Review') return State.Review
  if (raw === State.Relearning || raw === 'Relearning') return State.Relearning
  if (!hasReviewHistory(card)) return State.New
  return State.Review
}

function dateInput(value, fallback = Date.now()) {
  const timestamp = optionalTimestamp(value)
  return new Date(timestamp || fallback)
}

function fsrsCardFromAppCard(card, now = Date.now()) {
  const empty = createEmptyCard(dateInput(card?.createdAt, now))
  const state = fsrsStateFromCard(card)
  return {
    ...empty,
    due: dateInput(card?.fsrsDue || card?.dueAt, now),
    stability: Number(card?.fsrsStability || 0),
    difficulty: Number(card?.fsrsDifficulty || 0),
    elapsed_days: Number(card?.fsrsElapsedDays || 0),
    scheduled_days: Number(card?.fsrsScheduledDays || 0),
    learning_steps: Number(card?.fsrsLearningSteps || 0),
    reps: Math.max(Number(card?.fsrsReps || 0), Number(card?.reviewAttempts || 0), Number(card?.siteReps || 0)),
    lapses: Math.max(Number(card?.fsrsLapses || 0), Number(card?.reviewWrong || 0)),
    state,
    last_review: card?.fsrsLastReview || card?.lastReviewedAt ? dateInput(card?.fsrsLastReview || card?.lastReviewedAt, now) : undefined
  }
}

function fsrsRatingFromGrade(grade) {
  return grade === 'good' || grade === 'easy' ? Rating.Good : Rating.Again
}

function fsrsStateLabel(state) {
  if (state === State.Learning) return 'Aprendizado'
  if (state === State.Relearning) return 'Reaprendizado'
  if (state === State.Review) return 'Revisao'
  return 'Inedito'
}

function fsrsSchedulePreview(card, grade, now = Date.now(), retention = DEFAULT_FSRS_RETENTION) {
  const result = createFsrsScheduler(retention).next(fsrsCardFromAppCard(card, now), new Date(now), fsrsRatingFromGrade(grade))
  const delay = Math.max(0, result.card.due.getTime() - now)
  return { ...result, delay }
}

function isCardDue(card, now = Date.now()) {
  if (card?.learnedAt || learningLevel(card) >= MASTERED_LEVEL) return false
  const step = learningStep(learningLevel(card))
  if (step.scheduledDays > 0 && card?.lastReviewedAt) {
    return now >= addCalendarDaysTimestamp(dateInput(card.lastReviewedAt).getTime(), step.scheduledDays)
  }
  return !card?.dueAt || dueTimestamp(card, now) <= now
}

function learningLevel(card) {
  if (!card) return 0
  if (card.learnedAt) return MASTERED_LEVEL
  const raw = card.learningLevel ?? card.reviewLevel
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.min(MASTERED_LEVEL, parsed))
}

function learningStep(level) {
  return LEARNING_STEPS[Math.max(0, Math.min(MASTERED_LEVEL, Number(level) || 0))] || LEARNING_STEPS[0]
}

function scheduleByLearningLadder(card, grade, now = Date.now()) {
  const isCorrectGrade = grade === 'good' || grade === 'easy'
  const currentLevel = learningLevel(card)
  const nextLevel = isCorrectGrade
    ? Math.min(MASTERED_LEVEL, currentLevel + 1)
    : Math.max(0, currentLevel - 1)
  const step = learningStep(nextLevel)
  const dueAt = step.delayMs == null
    ? now + (3650 * DAY)
    : step.scheduledDays > 0
      ? addCalendarDaysTimestamp(now, step.scheduledDays)
      : now + step.delayMs

  return {
    level: nextLevel,
    label: step.label,
    dueAt,
    intervalMs: step.delayMs == null ? 3650 * DAY : step.delayMs,
    intervalDays: step.scheduledDays,
    learned: nextLevel >= MASTERED_LEVEL
  }
}

function resetCardLearning(card, now = Date.now()) {
  const {
    fsrsDue,
    fsrsState,
    fsrsLastReview,
    fsrsIntervalDays,
    fsrsScheduledDays,
    fsrsElapsedDays,
    fsrsLearningSteps,
    fsrsDifficulty,
    fsrsStability,
    fsrsReps,
    fsrsLapses,
    fsrsHistory,
    learnedAt,
    firstReviewedAt,
    lastReviewedAt,
    lastIntervalMs,
    lastGrade,
    learningStartedAt,
    learningHistory,
    learningLevel,
    learningResetAt,
    ...rest
  } = card || {}

  return {
    ...rest,
    dueAt: now,
    reps: 0,
    siteReps: 0,
    reviewAttempts: 0,
    reviewCorrect: 0,
    reviewWrong: 0,
    correctCount: 0,
    reviewLevel: 0,
    stageProgress: 0,
    learningLevel: 0,
    interval: 0,
    learningResetAt: new Date(now).toISOString()
  }
}

function sortDueQueue(cards, now = Date.now()) {
  const tieSeed = todayKey()
  return [...cards].sort((a, b) => {
    const aScheduled = hasScheduledDue(a)
    const bScheduled = hasScheduledDue(b)
    if (aScheduled !== bScheduled) return aScheduled ? -1 : 1

    const aReviewed = hasReviewHistory(a)
    const bReviewed = hasReviewHistory(b)
    if (aReviewed !== bReviewed) return aReviewed ? -1 : 1

    const aTime = dueTimestamp(a, now)
    const bTime = dueTimestamp(b, now)
    const aBucket = Math.floor(aTime / (5 * 60 * 1000))
    const bBucket = Math.floor(bTime / (5 * 60 * 1000))
    if (aBucket !== bBucket) return aBucket - bBucket
    return hashString(`${a.id}-${tieSeed}`) - hashString(`${b.id}-${tieSeed}`)
  })
}

function requiredCorrectsForStage(level) {
  return level === 2 ? 1 : 2
}

function correctCountFromReviewState(level, progress) {
  if (level <= 0) return progress
  if (level === 1) return 2 + progress
  if (level === 2) return 4 + progress
  return 5
}

function reviewStateFromCorrectCount(correctCount) {
  const corrects = Math.max(0, Number(correctCount || 0))
  if (corrects >= 5) return { level: 3, progress: 0 }
  if (corrects >= 4) return { level: 2, progress: 0 }
  if (corrects >= 2) return { level: 1, progress: Math.min(1, corrects - 2) }
  return { level: 0, progress: Math.min(1, corrects) }
}

function inferReviewState(card) {
  if (Number.isFinite(Number(card?.reviewLevel)) || Number.isFinite(Number(card?.stageProgress))) {
    const level = Math.max(0, Math.min(3, Number(card.reviewLevel || 0)))
    const maxProgress = Math.max(0, requiredCorrectsForStage(level) - 1)
    return {
      level,
      progress: Math.max(0, Math.min(maxProgress, Number(card.stageProgress || 0)))
    }
  }

  return reviewStateFromCorrectCount(card?.correctCount)
}

function previewSchedule(card, grade, retention = DEFAULT_FSRS_RETENTION) {
  const ladder = scheduleByLearningLadder(card, grade, Date.now())
  return {
    level: ladder.level,
    progress: ladder.level,
    delay: ladder.intervalMs,
    label: ladder.label,
    correctCount: Number(card?.correctCount || 0) + ((grade === 'good' || grade === 'easy') ? 1 : 0),
    ladder
  }
}

function buildCardReviewMetrics(history = []) {
  return (history || []).reduce((map, item) => {
    if (!item?.id) return map
    const current = map.get(item.id) || { attempts: 0, corrects: 0, wrongs: 0 }
    current.attempts += 1
    if (item.correct) current.corrects += 1
    else current.wrongs += 1
    current.lastDate = item.date || current.lastDate
    map.set(item.id, current)
    return map
  }, new Map())
}

function reviewCountSummary(card, metrics = null) {
  const attempts = Math.max(
    0,
    Number(card?.reviewAttempts || 0),
    Number(card?.siteReps || 0),
    Number(metrics?.attempts || 0)
  )
  const corrects = Math.max(0, Number(card?.reviewCorrect || 0), Number(metrics?.corrects || 0))
  const wrongs = Math.max(0, Number(card?.reviewWrong || 0), Number(metrics?.wrongs || 0))

  return { attempts, corrects, wrongs }
}

function totalSiteReps(card, metrics = null) {
  return reviewCountSummary(card, metrics).attempts
}

function reviewStageDetails(card) {
  if (!hasReviewHistory(card)) {
    return {
      level: -1,
      label: 'Inédito',
      className: 'stage-new',
      progress: 'Ainda não revisado no site'
    }
  }

  const level = learningLevel(card)
  const step = learningStep(level)
  const nextReview = isCardDue(card)
    ? 'vence agora'
    : hasScheduledDue(card)
      ? `volta em ${new Date(dueTimestamp(card)).toLocaleString('pt-BR')}`
      : 'sem data'
  let progress = ''
  if (level >= MASTERED_LEVEL) {
    progress = '6 acertos consolidados. Nao volta automaticamente.'
  } else if (level <= 1) {
    progress = `${level}/2 acertos para chegar em 1 dia | ${nextReview}`
  } else {
    progress = `${Math.min(level - 1, 5)}/5 etapas de consolidacao | ${nextReview}`
  }

  return {
    level,
    label: level >= MASTERED_LEVEL ? 'Aprendido' : level <= 1 ? `10m ${level}/2` : step.label,
    className: level >= MASTERED_LEVEL ? 'stage-learned' : level <= 1 ? 'stage-level-10m' : `stage-level-${level}`,
    progress
  }
}

function reviewCategoryKey(card) {
  if (!hasReviewHistory(card)) return 'new'
  const level = learningLevel(card)
  if (level >= MASTERED_LEVEL) return 'learned'
  if (level <= 1) return 'level-10m'
  return `level-${level}`
}

function sortCardsByDifficulty(a, b, metricsByCard = new Map()) {
  const aSummary = reviewCountSummary(a, metricsByCard.get(a.id))
  const bSummary = reviewCountSummary(b, metricsByCard.get(b.id))
  const repsDiff = bSummary.attempts - aSummary.attempts
  if (repsDiff) return repsDiff

  const wrongsDiff = bSummary.wrongs - aSummary.wrongs
  if (wrongsDiff) return wrongsDiff

  const aStage = reviewStageDetails(a)
  const bStage = reviewStageDetails(b)
  if (aStage.level !== bStage.level) return bStage.level - aStage.level

  const aDue = dueTimestamp(a, Number.MAX_SAFE_INTEGER)
  const bDue = dueTimestamp(b, Number.MAX_SAFE_INTEGER)
  if (aDue !== bDue) return aDue - bDue

  return String(a.pergunta || '').localeCompare(String(b.pergunta || ''), 'pt-BR')
}

function historyItemDayKey(item) {
  if (item?.day) return item.day
  if (!item?.date) return ''
  const parsed = new Date(item.date)
  if (!Number.isNaN(parsed.getTime())) return dateKey(parsed)
  return String(item.date || '').slice(0, 10)
}

function isAnsweredHistoryItem(item) {
  if (!item?.id) return false
  if (typeof item.correct === 'boolean') return true
  if (Number.isFinite(Number(item.percent))) return true
  return ['again', 'hard', 'good', 'easy'].includes(String(item.grade || ''))
}

function uniqueHistoryIdsForDay(stats, dayKey) {
  return Array.from(new Set(
    (stats.history || [])
      .filter(item => isAnsweredHistoryItem(item) && historyItemDayKey(item) === dayKey)
      .map(item => item.id)
  ))
}

function dailyUniqueCount(stats, dayKey) {
  const historyIds = uniqueHistoryIdsForDay(stats, dayKey)
  if (historyIds.length) return historyIds.length

  return 0
}

function dailyAnswerCount(stats, dayKey) {
  const explicit = Number(stats.dailyAnswers?.[dayKey])
  if (Object.prototype.hasOwnProperty.call(stats.dailyAnswers || {}, dayKey) && Number.isFinite(explicit)) return explicit
  return (stats.history || []).filter(item => isAnsweredHistoryItem(item) && historyItemDayKey(item) === dayKey).length
}

function dailyNewCardCount(stats, dayKey) {
  const explicit = Number(stats.dailyNewAnswers?.[dayKey])
  if (Object.prototype.hasOwnProperty.call(stats.dailyNewAnswers || {}, dayKey) && Number.isFinite(explicit)) return explicit
  const answered = (stats.history || []).filter(isAnsweredHistoryItem)
  const firstIndexByCard = new Map()
  answered.forEach((item, index) => {
    if (!firstIndexByCard.has(item.id)) firstIndexByCard.set(item.id, index)
  })

  return answered.filter((item, index) => {
    if (historyItemDayKey(item) !== dayKey) return false
    return item.isNewCard === true || (item.isNewCard == null && firstIndexByCard.get(item.id) === index)
  }).length
}

function historyCardIds(stats) {
  return new Set((stats.history || []).filter(isAnsweredHistoryItem).map(item => item.id))
}

function reviewRatioStreak(stats) {
  const today = todayKey()
  const todayHistory = (stats.history || []).filter(item => isAnsweredHistoryItem(item) && historyItemDayKey(item) === today)
  let reviews = 0

  for (let index = todayHistory.length - 1; index >= 0; index -= 1) {
    if (todayHistory[index]?.isNewCard) break
    reviews += 1
    if (reviews >= 2) break
  }

  return reviews
}

function isUnseenStudyCard(card, seenIds) {
  return !hasReviewHistory(card) && !seenIds.has(card.id)
}

function isReviewStudyCard(card, seenIds, now = Date.now()) {
  return !isUnseenStudyCard(card, seenIds) && isCardDue(card, now)
}

function fsrsReviewPriority(card) {
  const state = fsrsStateFromCard(card)
  if (state === State.Review) return 0
  if (state === State.Learning || state === State.Relearning) return 1
  return 2
}

function cardReviewedDay(card) {
  const raw = card?.lastReviewedAt || card?.fsrsLastReview || ''
  if (!raw) return ''
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return String(raw).slice(0, 10)
  return dateKey(parsed)
}

function sortReviewGroup(cards, now = Date.now()) {
  const daySeed = todayKey()
  return [...cards].sort((a, b) => {
    const aTime = dueTimestamp(a, now)
    const bTime = dueTimestamp(b, now)
    if (aTime !== bTime) return aTime - bTime

    const repsDiff = totalSiteReps(b) - totalSiteReps(a)
    if (repsDiff) return repsDiff

    return hashString(`${a.id}-${daySeed}`) - hashString(`${b.id}-${daySeed}`)
  })
}

function sortReviewQueue(cards, now = Date.now()) {
  const today = todayKey()
  const groups = [
    cards.filter(card => learningLevel(card) === 1 && cardReviewedDay(card) === today),
    cards.filter(card => learningLevel(card) === 1 && cardReviewedDay(card) !== today),
    cards.filter(card => learningLevel(card) === 0 && cardReviewedDay(card) === today),
    cards.filter(card => learningLevel(card) === 6),
    cards.filter(card => learningLevel(card) === 5),
    cards.filter(card => learningLevel(card) === 4),
    cards.filter(card => learningLevel(card) === 3),
    cards.filter(card => learningLevel(card) === 2),
    cards.filter(card => learningLevel(card) === 0 && cardReviewedDay(card) !== today)
  ].map(group => sortReviewGroup(group, now))

  const queue = []
  let added = true
  while (added) {
    added = false
    groups.forEach(group => {
      const next = group.shift()
      if (next) {
        queue.push(next)
        added = true
      }
    })
  }
  return queue
}

function sortUnseenQueue(cards) {
  const seed = todayKey()
  return [...cards].sort((a, b) => {
    return hashString(`unseen-${seed}-${a.id}`) - hashString(`unseen-${seed}-${b.id}`)
  })
}

function buildStudyQueue(cards, seenIds, shouldPullUnseen, now = Date.now(), recentReviewStreak = 0) {
  const unseenCandidates = cards.filter(card => isUnseenStudyCard(card, seenIds))
  const unseen = sortUnseenQueue(
    shouldPullUnseen ? unseenCandidates : unseenCandidates.filter(card => isCardDue(card, now))
  )
  const reviews = sortReviewQueue(
    cards.filter(card => isReviewStudyCard(card, seenIds, now)),
    now
  )

  if (!shouldPullUnseen || !unseen.length) return reviews
  if (!reviews.length) return unseen

  const queue = []
  let reviewIndex = 0
  let unseenIndex = 0
  let reviewQuota = Math.max(0, NEW_REVIEW_RATIO - Math.min(NEW_REVIEW_RATIO, recentReviewStreak))

  while (reviewIndex < reviews.length || unseenIndex < unseen.length) {
    for (let count = 0; count < reviewQuota && reviewIndex < reviews.length; count += 1) {
      queue.push(reviews[reviewIndex])
      reviewIndex += 1
    }
    if (unseenIndex < unseen.length) {
      queue.push(unseen[unseenIndex])
      unseenIndex += 1
    }
    reviewQuota = NEW_REVIEW_RATIO
    if (reviewIndex >= reviews.length) {
      while (unseenIndex < unseen.length) {
        queue.push(unseen[unseenIndex])
        unseenIndex += 1
      }
    }
  }

  return queue
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

function hasHtmlMarkup(value) {
  return /<\/?[a-z][\s\S]*>/i.test(String(value || ''))
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
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
    dailyAnswers: s.dailyAnswers && typeof s.dailyAnswers === 'object' ? s.dailyAnswers : {},
    dailyNewAnswers: s.dailyNewAnswers && typeof s.dailyNewAnswers === 'object' ? s.dailyNewAnswers : {},
    history: Array.isArray(s.history) ? s.history : [],
    masteryByCard: s.masteryByCard && typeof s.masteryByCard === 'object' ? s.masteryByCard : {},
    dailySeen: s.dailySeen && typeof s.dailySeen === 'object' ? s.dailySeen : {},
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
      .replace(/\bé\b/gi, ' eh ')
      .replace(/≥|>=/g, ' maior igual ')
      .replace(/≤|<=/g, ' menor igual ')
      .replace(/>/g, ' maior ')
      .replace(/</g, ' menor ')
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

function comparableAnswerText(text) {
  return canonicalizeMedicalText(text)
    .replace(/\bml\s+h\b/g, 'mlh')
    .replace(/\bml\s+hora\b/g, 'mlh')
    .replace(/\bml\s+por\s+hora\b/g, 'mlh')
    .replace(/\s+/g, ' ')
    .trim()
}

function compactComparableAnswerText(text) {
  return comparableAnswerText(text).replace(/\s+/g, '')
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), ms)
    })
  ])
}

function authErrorMessage(error) {
  const message = String(error?.message || '').trim()
  if (!message) return 'Nao consegui conectar agora. Tente novamente em instantes.'
  if (/invalid login credentials/i.test(message)) return 'Email ou senha recusados pelo Supabase. Confira se nao ha espaco, acento ou caractere diferente na senha.'
  if (/email not confirmed/i.test(message)) return 'Esse email ainda nao foi confirmado no Supabase.'
  if (/too many requests|rate limit/i.test(message)) return 'Muitas tentativas de login. Aguarde um pouco e tente novamente.'
  return `Erro no login: ${message}`
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

const RELATION_GROUPS = [
  {
    group: 'position',
    a: ['superior', 'acima', 'alto', 'cranial'],
    b: ['inferior', 'abaixo', 'baixo', 'caudal']
  },
  {
    group: 'size',
    a: ['maior', 'alto', 'alta', 'elevado', 'elevada'],
    b: ['menor', 'baixo', 'baixa', 'reduzido', 'reduzida']
  },
  {
    group: 'change',
    a: ['aumenta', 'aumento', 'sobe', 'subir', 'eleva', 'elevacao', 'cresce'],
    b: ['diminui', 'diminuicao', 'reduz', 'reducao', 'cai', 'queda', 'baixa']
  },
  {
    group: 'timing',
    a: ['antes', 'previo', 'precoce', 'inicial'],
    b: ['depois', 'apos', 'tardio', 'posterior']
  },
  {
    group: 'polarity',
    a: ['positivo', 'presente', 'sim'],
    b: ['negativo', 'ausente', 'nao']
  }
]

const RELATION_LOOKUP = RELATION_GROUPS.reduce((map, item) => {
  item.a.forEach(word => map.set(lightStem(word), { group: item.group, side: 'a' }))
  item.b.forEach(word => map.set(lightStem(word), { group: item.group, side: 'b' }))
  return map
}, new Map())

const CLAIM_BOUNDARIES = new Set(['e', 'ou', 'mas', 'porem', 'entao', 'quando', 'se'])
const CLAIM_IGNORED_TERMS = new Set([
  ...STOP_WORDS,
  'eh','ser','sao','estrutura','estruturas','mais','menos','mesmo','mesma','fica','ficam','ficar','valor','valores'
])

function relationForToken(token) {
  return RELATION_LOOKUP.get(lightStem(token))
}

function cleanClaimTerm(token) {
  const stem = lightStem(token)
  if (stem.length <= 2) return ''
  if (CLAIM_IGNORED_TERMS.has(token) || CLAIM_IGNORED_TERMS.has(stem)) return ''
  if (relationForToken(token)) return ''
  return stem
}

function collectClaimTerms(tokens, start, step) {
  const terms = []
  for (let index = start; index >= 0 && index < tokens.length; index += step) {
    const token = tokens[index]
    if (CLAIM_BOUNDARIES.has(token) || relationForToken(token)) break
    const term = cleanClaimTerm(token)
    if (term) terms.push(term)
  }
  return step < 0 ? terms.reverse() : terms
}

function extractRelationClaims(text) {
  const tokens = canonicalizeMedicalText(text).split(' ').filter(Boolean)
  const claims = []

  tokens.forEach((token, index) => {
    const relation = relationForToken(token)
    if (!relation) return

    const before = collectClaimTerms(tokens, index - 1, -1)
    const after = collectClaimTerms(tokens, index + 1, 1)
    const subject = before.length ? before : after
    if (!subject.length) return

    claims.push({
      group: relation.group,
      side: relation.side,
      subject: new Set(subject)
    })
  })

  return claims
}

function claimOverlap(a, b) {
  let count = 0
  a.subject.forEach(term => {
    if (b.subject.has(term)) count += 1
  })
  return count
}

function countRelationContradictions(expectedText, userText) {
  const expectedClaims = extractRelationClaims(expectedText)
  const userClaims = extractRelationClaims(userText)
  let contradictions = 0

  expectedClaims.forEach(expected => {
    userClaims.forEach(user => {
      if (expected.group !== user.group || expected.side === user.side) return
      if (claimOverlap(expected, user) > 0) contradictions += 1
    })
  })

  return contradictions
}

function extractQuestionLabels(questionText) {
  const raw = stripHtml(decodeHtmlEntities(questionText))
  const labels = []
  const explicitMatches = raw.matchAll(/([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-Za-zÀ-ÿ0-9-]{2,})\s*(?:\[[^\]]*\]|\.\.\.)/g)

  for (const match of explicitMatches) {
    const label = canonicalizeMedicalText(match[1])
    if (label && !STOP_WORDS.has(label)) labels.push(label)
  }

  return [...new Set(labels)]
}

function splitExpectedOrderedParts(expectedText) {
  const raw = stripHtml(decodeHtmlEntities(expectedText))
  const marked = raw.replace(/(?:^|\s)(?:\d+|[a-z])\s*[\.\):;-]\s*/gi, '|||')
  const parts = marked
    .split('|||')
    .map(part => part.trim())
    .filter(Boolean)

  if (parts.length >= 2) return parts

  return raw
    .split(/[\n\r;]+/)
    .map(part => part.trim())
    .filter(Boolean)
}

function tokenPositions(tokens, target) {
  const targetStem = lightStem(target)
  const positions = []
  tokens.forEach((token, index) => {
    if (lightStem(token) === targetStem) positions.push(index)
  })
  return positions
}

function orderedLabelScore(questionText, expectedText, userText) {
  const labels = extractQuestionLabels(questionText)
  const expectedParts = splitExpectedOrderedParts(expectedText)
  if (labels.length < 2 || expectedParts.length < 2) return null

  const userTokens = canonicalizeMedicalText(userText).split(' ').filter(Boolean)
  const userHasLabels = labels.filter(label => tokenPositions(userTokens, label).length > 0).length
  if (userHasLabels < Math.min(2, labels.length)) return null

  let checked = 0
  let correct = 0
  let inverted = 0
  const expectedTokensByPart = expectedParts.map(part => [...new Set(answerTokens(part))])
  const allLabelPositions = labels.flatMap(label => tokenPositions(userTokens, label)).sort((a, b) => a - b)

  labels.slice(0, expectedTokensByPart.length).forEach((label, labelIndex) => {
    const positions = tokenPositions(userTokens, label)
    if (!positions.length) return

    const windowTokens = new Set()
    positions.forEach(position => {
      const nextLabel = allLabelPositions.find(labelPosition => labelPosition > position) ?? userTokens.length
      userTokens.slice(position + 1, Math.min(nextLabel, position + 7)).forEach(token => windowTokens.add(lightStem(token)))
    })

    const expectedTokens = expectedTokensByPart[labelIndex]
    const matchedExpected = expectedTokens.some(token => windowTokens.has(lightStem(token)))
    const matchedOther = expectedTokensByPart.some((tokens, partIndex) => {
      if (partIndex === labelIndex) return false
      return tokens.some(token => windowTokens.has(lightStem(token)))
    })

    if (matchedExpected || matchedOther) checked += 1
    if (matchedExpected) correct += 1
    if (!matchedExpected && matchedOther) inverted += 1
  })

  if (!checked) return null
  if (inverted > 0) return Math.max(0, Math.round((correct / checked) * 45))
  if (correct === checked && checked >= 2) return 92
  return Math.round((correct / checked) * 70)
}

function expectedAnswerBlocks(expectedText) {
  const source = decodeHtmlEntities(String(expectedText || ''))
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|tr|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')

  return source
    .split(/\n+/)
    .map(block => block.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function hasStructuredAnswerList(expectedText) {
  const source = decodeHtmlEntities(String(expectedText || ''))
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|tr|h[1-6])>/gi, '\n')

  return /(?:^|\n)\s*(?:\d+[\).:-]|[-•▪▫])\s+/m.test(source)
}

function primaryExpectedAnswer(expectedText) {
  const blocks = expectedAnswerBlocks(expectedText)
  const firstBlock = blocks[0] || stripHtml(expectedText)
  const firstSentence = firstBlock.split(/(?<=[.!?])\s+/)[0] || firstBlock
  return firstSentence.replace(/^\s*(?:\d+[\).:-]|[-•▪▫])\s+/, '').trim()
}

function isDirectShortAnswerQuestion(questionText) {
  const question = canonicalizeMedicalText(questionText)
  return /\bqual\b|\bquais\b|\bquem\b|\bonde\b|\bquando\b|\bse origina\b|\borigina\b|\bcausa\b/.test(question)
}

function semanticTargetText(expectedText, questionText) {
  const primary = primaryExpectedAnswer(expectedText)
  const primaryTokens = [...new Set(answerTokens(primary))]
  const fullTokens = [...new Set(answerTokens(expectedText))]

  if (
    primary &&
    isDirectShortAnswerQuestion(questionText) &&
    !hasStructuredAnswerList(expectedText) &&
    primaryTokens.length >= 2 &&
    primaryTokens.length <= 6 &&
    fullTokens.length >= primaryTokens.length + 4
  ) {
    return primary
  }

  return expectedText
}

function semanticScore(expectedText, userText, questionText = '') {
  const targetText = semanticTargetText(expectedText, questionText)
  const expectedComparable = comparableAnswerText(targetText)
  const userComparable = comparableAnswerText(userText)
  if (expectedComparable && userComparable) {
    if (expectedComparable === userComparable) return 100
    if (compactComparableAnswerText(targetText) === compactComparableAnswerText(userText)) return 100
  }

  const expectedTokens = [...new Set(answerTokens(targetText))]
  const userTokens = [...new Set(answerTokens(userText))]
  const expectedNumbers = [...new Set(extractNumbers(targetText))]
  const userNumbers = [...new Set(extractNumbers(userText))]
  if (!expectedTokens.length) return 0
  if (canonicalizeMedicalText(userText).includes(canonicalizeMedicalText(targetText))) return 100
  const orderedScore = orderedLabelScore(questionText, targetText, userText)
  const hits = expectedTokens.filter(token => tokenMatches(token, userTokens)).length
  const conceptScore = hits / expectedTokens.length
  const userRelevantHits = userTokens.filter(token => tokenMatches(token, expectedTokens)).length
  const userCoverage = userTokens.length ? userRelevantHits / userTokens.length : 0
  const numberScore = expectedNumbers.length
    ? expectedNumbers.filter(number => numberMatches(number, userNumbers)).length / expectedNumbers.length
    : conceptScore
  if (expectedTokens.length <= 4 && expectedNumbers.length > 0 && conceptScore === 1 && userCoverage === 1 && numberScore === 1) return 100

  let score = ((conceptScore * 0.55) + (userCoverage * 0.25) + (numberScore * 0.20)) * 100
  if (conceptScore >= 0.72 && userCoverage >= 0.72 && numberScore >= 0.75) score = Math.max(score, 82)
  if (userTokens.length >= 3 && userCoverage >= 0.8 && numberScore >= 0.75) score = Math.max(score, 85)
  if (userTokens.length >= 2 && userCoverage >= 0.9 && !expectedNumbers.length) score = Math.max(score, 82)
  const contradictions = countRelationContradictions(targetText, userText)
  if (contradictions) score = Math.min(score, contradictions >= 2 ? 35 : 55)
  if (orderedScore != null) {
    score = orderedScore >= 80 ? Math.max(score, orderedScore) : Math.min(score, orderedScore)
  }
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

function importCardKey(card) {
  return card.importKey || card.originalImportKey || stableCardKey(card)
}

function activeCardCount(cardList) {
  return Array.isArray(cardList) ? cardList.filter(card => card && !card.deleted).length : 0
}

function isDefaultOnlyDeck(cardList) {
  const active = Array.isArray(cardList) ? cardList.filter(card => card && !card.deleted) : []
  return active.length === 1 && String(active[0]?.id || '') === 'default-1'
}

function hasRealLocalDeck(cardList) {
  return activeCardCount(cardList) > 0 && !isDefaultOnlyDeck(cardList)
}

function cardProgressScore(card) {
  if (!card || typeof card !== 'object') return 0
  const attempts = Number(card.reviewAttempts || card.siteReps || card.reps || 0)
  const correct = Number(card.correctCount || 0)
  const level = Number(card.reviewLevel || 0)
  const stage = Number(card.stageProgress || 0)
  const editedAt = card.manualEditedAt ? new Date(card.manualEditedAt).getTime() : 0
  const updatedAt = card.sourceUpdatedAt ? new Date(card.sourceUpdatedAt).getTime() : 0
  const recency = Math.max(
    Number.isFinite(editedAt) ? editedAt : 0,
    Number.isFinite(updatedAt) ? updatedAt : 0
  )
  return attempts * 10000 + level * 1000 + stage * 100 + correct * 10 + Math.min(recency / 1000000000000, 9)
}

function timestampScore(value) {
  const parsed = new Date(value || '').getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function contentTimestamp(card) {
  return Math.max(
    timestampScore(card?.manualEditedAt),
    timestampScore(card?.sourceUpdatedAt),
    timestampScore(card?.importedAt),
    timestampScore(card?.createdAt)
  )
}

function cardIdentityKeys(card) {
  if (!card) return []
  const keys = new Set()
  if (card.id) keys.add(`id:${String(card.id)}`)
  const importKey = importCardKey(card)
  if (importKey) keys.add(`import:${importKey}`)
  const stableKey = stableCardKey(card)
  if (stableKey) keys.add(`stable:${stableKey}`)
  return Array.from(keys)
}

function chooseRicherCard(first, second) {
  if (!first) return second
  if (!second) return first
  const contentPreferred = contentTimestamp(second) > contentTimestamp(first) ? second : first
  const progressPreferred = cardProgressScore(second) > cardProgressScore(first) ? second : first
  const fallback = contentPreferred === first ? second : first
  return {
    ...fallback,
    ...progressPreferred,
    pergunta: contentPreferred.pergunta || fallback.pergunta,
    resposta: contentPreferred.resposta || fallback.resposta,
    htmlFront: contentPreferred.htmlFront || contentPreferred.html_front || fallback.htmlFront || fallback.html_front,
    htmlBack: contentPreferred.htmlBack || contentPreferred.html_back || fallback.htmlBack || fallback.html_back,
    html_front: contentPreferred.html_front || contentPreferred.htmlFront || fallback.html_front || fallback.htmlFront,
    html_back: contentPreferred.html_back || contentPreferred.htmlBack || fallback.html_back || fallback.htmlBack,
    frontHtml: contentPreferred.frontHtml || fallback.frontHtml,
    backHtml: contentPreferred.backHtml || fallback.backHtml,
    tags: contentPreferred.tags || fallback.tags,
    manualEditedAt: contentPreferred.manualEditedAt || fallback.manualEditedAt,
    sourceUpdatedAt: contentPreferred.sourceUpdatedAt || fallback.sourceUpdatedAt,
    importedAt: contentPreferred.importedAt || fallback.importedAt,
    importKey: contentPreferred.importKey || fallback.importKey || importCardKey(contentPreferred),
    originalImportKey: contentPreferred.originalImportKey || fallback.originalImportKey || importCardKey(contentPreferred)
  }
}

function mergeStatsSources(cloudStats, localStats) {
  const cloud = safeStats(cloudStats)
  const local = safeStats(localStats)
  const cloudAnswered = Number(cloud.correct || 0) + Number(cloud.wrong || 0)
  const localAnswered = Number(local.correct || 0) + Number(local.wrong || 0)
  if (localAnswered > cloudAnswered) return local
  if (cloudAnswered > localAnswered) return cloud
  return (local.history || []).length >= (cloud.history || []).length ? local : cloud
}

function mergeCardSources(...sources) {
  const merged = []
  const indexByKey = new Map()

  sources.flat().filter(Boolean).forEach(card => {
    const keys = cardIdentityKeys(card)
    const existingIndex = keys.map(key => indexByKey.get(key)).find(index => index !== undefined)

    if (existingIndex === undefined) {
      const nextIndex = merged.length
      merged.push(card)
      keys.forEach(key => indexByKey.set(key, nextIndex))
      return
    }

    const richer = chooseRicherCard(merged[existingIndex], card)
    merged[existingIndex] = richer
    cardIdentityKeys(richer).forEach(key => indexByKey.set(key, existingIndex))
  })

  return merged
}

function cloudDiffCards(cloudCards = [], localCards = []) {
  const cloudById = new Map(cloudCards.filter(Boolean).map(card => [String(card.id || card.card_id || ''), card]))
  return localCards.filter(card => {
    const id = String(card?.id || '')
    if (!id) return false
    const cloud = cloudById.get(id)
    if (!cloud) return true
    return contentTimestamp(card) > contentTimestamp(cloud) || cardProgressScore(card) > cardProgressScore(cloud)
  })
}

function cardAddedScore(card) {
  const dateScore = ['createdAt', 'sourceUpdatedAt', 'manualEditedAt', 'importedAt']
    .map(key => new Date(card?.[key] || '').getTime())
    .filter(score => Number.isFinite(score) && score > 0)
    .reduce((max, score) => Math.max(max, score), 0)
  const idMatch = String(card.id || card.importKey || '').match(/\d+/g)
  const idScore = idMatch?.length ? Number(idMatch.join('').slice(0, 15)) || 0 : 0
  return Math.max(dateScore, idScore)
}

function imageTags(html) {
  return String(html || '').match(/<img\b[^>]*>/gi) || []
}

function imageSrc(img) {
  return img.match(/src=["']([^"']+)["']/i)?.[1] || ''
}

function isRestorableImage(img) {
  const src = imageSrc(img)
  return src && (/^data:image\//i.test(src) || /^media\//i.test(src) || /^\/media\//i.test(src) || /^blob:/i.test(src))
}

function mergeMissingImages(existingHtml, importedHtml) {
  const importedImages = imageTags(importedHtml).filter(isRestorableImage)
  if (!importedImages.length) return existingHtml

  const existing = String(existingHtml || '')
  const baseHtml = existing.replace(/<img\b[^>]*>/gi, img => (isRestorableImage(img) ? img : ''))

  const missingImages = importedImages.filter(img => {
    const src = imageSrc(img)
    return src && !baseHtml.includes(src)
  })

  return missingImages.length ? `${baseHtml}<br>${missingImages.join('<br>')}` : baseHtml
}

function mergeImportedCards(oldCards, importedCards) {
  const oldById = new Map(oldCards.map(c => [String(c.id), c]))
  const oldByKey = new Map()
  oldCards.forEach(card => {
    oldByKey.set(stableCardKey(card), card)
    if (card.importKey || card.originalImportKey) oldByKey.set(importCardKey(card), card)
  })
  let added = 0
  let updated = 0
  let preservedEdited = 0
  let ignoredExisting = 0
  const createdCards = []
  const importedAt = new Date().toISOString()

  const merged = [...oldCards]

  importedCards.forEach(newCard => {
    const nextCard = { ...newCard, importKey: importCardKey(newCard), originalImportKey: importCardKey(newCard), importedAt }
    const idKey = String(newCard.id)
    const contentKey = importCardKey(nextCard)
    const existing = oldById.get(idKey) || oldByKey.get(contentKey)

    if (existing) {
      ignoredExisting += 1
      if (existing.manualEditedAt) preservedEdited += 1
      const existingFront = existing.htmlFront || existing.html_front || ''
      const existingBack = existing.htmlBack || existing.html_back || ''
      const importedFront = nextCard.htmlFront || nextCard.html_front || ''
      const importedBack = nextCard.htmlBack || nextCard.html_back || ''
      const htmlFront = mergeMissingImages(existingFront, importedFront)
      const htmlBack = mergeMissingImages(existingBack, importedBack)
      const mediaCount = Math.max(Number(existing.mediaCount || 0), Number(nextCard.mediaCount || 0))
      const changed = htmlFront !== existingFront || htmlBack !== existingBack || mediaCount !== Number(existing.mediaCount || 0)

      if (changed) {
        const index = merged.findIndex(c => String(c.id) === String(existing.id))
        if (index >= 0) {
          const updatedCard = {
            ...existing,
            htmlFront,
            htmlBack,
            html_front: htmlFront,
            html_back: htmlBack,
            mediaCount,
            importKey: existing.importKey || contentKey,
            originalImportKey: existing.originalImportKey || contentKey,
            sourceUpdatedAt: existing.sourceUpdatedAt || importedAt
          }
          merged[index] = updatedCard
          createdCards.push(updatedCard)
          updated += 1
        }
      }
      return
    }

    if (false) {
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
            importKey: existing.importKey || contentKey,
            originalImportKey: existing.originalImportKey || contentKey,
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
          palavras: newCard.palavras,
          importKey: existing.importKey || contentKey,
          originalImportKey: existing.originalImportKey || contentKey
        }
        updated += 1
      }
    } else {
      merged.push(nextCard)
      createdCards.push(nextCard)
      added += 1
    }
  })

  return { merged, added, updated, preservedEdited, ignoredExisting, createdCards }
}


function getCardView(card) {
  if (!card) return null

  const rawFront = String(cardFrontHtml(card) || '')
  const rawBack = String(cardBackHtml(card) || '')
  const source = rawFront.includes('{{c') ? rawFront : `${rawFront}<br>${rawBack}`
  const cloze = extractClozeText(source)

  if (!cloze.isCloze) {
    return {
      ...card,
      htmlFront: rawFront,
      htmlBack: rawBack,
      pergunta: stripHtml(rawFront) || card.pergunta || '',
      resposta: stripHtml(rawBack) || card.resposta || ''
    }
  }

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

function shouldShowLibraryFrontPreview(card) {
  const html = String(card?.htmlFront || '').trim()
  if (!html) return false
  if (/<(img|picture|video|audio|svg|table)\b/i.test(html)) return true
  return normalize(stripHtml(html)) !== normalize(card?.pergunta || '')
}

function removeImageFallbackText(html) {
  return String(html || '').replace(/<img\b[^>]*>/gi, tag => {
    let next = tag
      .replace(/\s+alt=(["'])[\s\S]*?\1/gi, '')
      .replace(/\s+title=(["'])[\s\S]*?\1/gi, '')
    return next.replace(/<img\b/i, '<img alt=""')
  })
}

function hideBrokenImages(container) {
  container?.querySelectorAll('img').forEach(img => {
    img.alt = ''
    img.removeAttribute('title')

    const hideIfBroken = () => {
      if (img.complete && img.naturalWidth === 0) img.hidden = true
    }

    img.addEventListener('error', () => {
      img.hidden = true
    }, { once: true })
    img.addEventListener('load', () => {
      img.hidden = false
    }, { once: true })
    hideIfBroken()
  })
}

function compactRepeatedBreaks(container) {
  if (!container) return
  let previousBreak = false
  Array.from(container.childNodes).forEach(node => {
    const isWhitespace = node.nodeType === Node.TEXT_NODE && !node.textContent.trim()
    const isBreak = node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR'
    if (isWhitespace) return
    if (isBreak) {
      if (previousBreak) node.remove()
      previousBreak = true
      return
    }
    previousBreak = false
  })
}

function hasVisibleNodeContent(node) {
  if (!node) return false
  if (node.nodeType === Node.TEXT_NODE) return Boolean(String(node.textContent || '').replace(/\u00a0/g, '').trim())
  if (node.nodeType !== Node.ELEMENT_NODE) return false
  if (['IMG', 'VIDEO', 'AUDIO', 'TABLE', 'UL', 'OL', 'IFRAME', 'SVG'].includes(node.tagName)) return true
  if (node.tagName === 'BR') return false
  return Boolean(String(node.textContent || '').replace(/\u00a0/g, '').trim())
}

function wrapLooseLineBreaks(container) {
  if (!container) return
  const childNodes = Array.from(container.childNodes)
  if (!childNodes.some(node => node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR')) return

  const nextChildren = []
  let lineNodes = []
  const blockTags = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'TABLE', 'IMG', 'VIDEO', 'AUDIO', 'IFRAME', 'SVG'])

  const flushLine = () => {
    if (!lineNodes.some(hasVisibleNodeContent)) {
      lineNodes = []
      return
    }
    const line = document.createElement('div')
    lineNodes.forEach(node => line.appendChild(node))
    nextChildren.push(line)
    lineNodes = []
  }

  childNodes.forEach(node => {
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR') {
      flushLine()
      return
    }
    if (node.nodeType === Node.ELEMENT_NODE && blockTags.has(node.tagName)) {
      flushLine()
      nextChildren.push(node)
      return
    }
    lineNodes.push(node)
  })
  flushLine()

  container.replaceChildren(...nextChildren)
}

function normalizeEditorSpacing(container, lineHeight = '1.35', paragraphGap = '4px') {
  if (!container) return
  wrapLooseLineBreaks(container)
  const nodesToCompact = [container, ...container.querySelectorAll('p,div,li')]
  nodesToCompact.forEach(compactRepeatedBreaks)
  const blocks = Array.from(container.querySelectorAll('p,div,li'))
  if (['P', 'DIV', 'LI'].includes(container.tagName)) blocks.unshift(container)
  blocks.forEach(block => {
    const hasMedia = Boolean(block.querySelector('img,video,audio,table,ul,ol,iframe,svg'))
    const text = String(block.textContent || '').replace(/\u00a0/g, '').trim()
    if (!text && !hasMedia) {
      block.remove()
      return
    }
    block.style.marginTop = '0'
    block.style.margin = `0 0 ${paragraphGap}`
    block.style.lineHeight = lineHeight
    block.style.whiteSpace = 'normal'
    block.style.textAlign = 'left'
  })
  const remainingBlocks = Array.from(container.children).filter(node => ['P', 'DIV', 'LI'].includes(node.tagName))
  const lastBlock = remainingBlocks[remainingBlocks.length - 1]
  if (lastBlock) lastBlock.style.marginBottom = '0'
}

function normalizeRichHtmlSpacing(html, lineHeight = '1.35', paragraphGap = '4px') {
  const safeHtml = removeImageFallbackText(html)
  if (typeof document === 'undefined') return safeHtml
  const container = document.createElement('div')
  container.innerHTML = safeHtml
  normalizeEditorSpacing(container, lineHeight, paragraphGap)
  return container.innerHTML
}

function hasVisibleHtmlContent(html) {
  const source = String(html || '').trim()
  if (!source) return false
  if (/<(img|video|audio|table|ul|ol|iframe|svg)\b/i.test(source)) return true
  return stripHtml(source).length > 0
}

function firstVisibleHtml(...values) {
  return values.find(value => hasVisibleHtmlContent(value)) || ''
}

function visibleHtmlScore(value) {
  if (!hasVisibleHtmlContent(value)) return -1
  const source = String(value || '')
  const textLength = stripHtml(source).length
  const mediaWeight = (source.match(/<(img|video|audio|table|ul|ol|iframe|svg)\b/gi) || []).length * 10000
  const structureWeight = Math.min((source.match(/<(p|div|br|li|strong|b|span|font|mark)\b/gi) || []).length, 200) * 4
  const lineWeight = Math.min((source.match(/\r?\n/g) || []).length, 200) * 2
  return textLength + mediaWeight + structureWeight + lineWeight
}

function richestVisibleHtml(...values) {
  let best = ''
  let bestScore = -1
  values.forEach(value => {
    const score = visibleHtmlScore(value)
    if (score > bestScore) {
      best = value
      bestScore = score
    }
  })
  return best || ''
}

function richEditorInitialHtml(value) {
  const source = removeImageFallbackText(value)
  if (!source) return ''
  if (hasHtmlMarkup(source)) return source
  return escapeHtml(source).replace(/\r?\n/g, '<br>')
}

function cardFrontHtml(card) {
  return firstVisibleHtml(card?.htmlFront, card?.html_front, card?.frontHtml, card?.pergunta, card?.question, card?.front)
}

function cardBackHtml(card) {
  return richestVisibleHtml(card?.htmlBack, card?.html_back, card?.backHtml, card?.resposta, card?.answer, card?.back, card?.verso)
}

function HtmlContent({ html, className, compactParagraphs = false }) {
  const contentRef = useRef(null)
  const safeHtml = useMemo(() => (
    compactParagraphs
      ? normalizeRichHtmlSpacing(html, '1.35', '4px')
      : removeImageFallbackText(html)
  ), [html, compactParagraphs])

  useEffect(() => {
    if (compactParagraphs) normalizeEditorSpacing(contentRef.current, '1.35', '4px')
    hideBrokenImages(contentRef.current)
  }, [safeHtml, compactParagraphs])

  return <div ref={contentRef} className={className} dangerouslySetInnerHTML={{ __html: safeHtml }} />
}

function RichTextEditor({ value, onChange, lineHeight = '1.35', paragraphGap = '4px' }) {
  const editorRef = useRef(null)
  const lastHtmlRef = useRef(null)
  const savedSelectionRef = useRef(null)
  const fontColors = ['#111827', '#2563eb', '#b42318', '#db2777', '#167047']
  const highlightColors = ['#fff200', '#bfdbfe', '#fbcfe8', '#fecaca', '#93c5fd']
  const fontSizes = ['12px', '14px', '16px', '18px', '20px', '24px', '28px']
  const lineHeights = [
    { label: '1,0', value: '1' },
    { label: '1,15', value: '1.15' },
    { label: 'ABNT 1,5', value: '1.5' },
    { label: '2,0', value: '2' }
  ]
  const paragraphSpaces = [
    { label: '0 px', value: '0px' },
    { label: '4 px', value: '4px' },
    { label: '6 px', value: '6px' },
    { label: '8 px', value: '8px' },
    { label: '10 px', value: '10px' },
    { label: '12 px', value: '12px' }
  ]

  useEffect(() => {
    if (!editorRef.current || value === lastHtmlRef.current) return
    const nextHtml = normalizeRichHtmlSpacing(value, lineHeight, paragraphGap)
    editorRef.current.innerHTML = nextHtml
    normalizeEditorSpacing(editorRef.current, lineHeight, paragraphGap)
    hideBrokenImages(editorRef.current)
    lastHtmlRef.current = nextHtml
  }, [value, lineHeight, paragraphGap])

  function emitChange() {
    normalizeEditorSpacing(editorRef.current, lineHeight, paragraphGap)
    const html = editorRef.current?.innerHTML || ''
    lastHtmlRef.current = html
    onChange(html)
  }

  function saveSelection() {
    const selection = window.getSelection()
    if (!selection?.rangeCount || !editorRef.current?.contains(selection.anchorNode)) return
    savedSelectionRef.current = selection.getRangeAt(0).cloneRange()
  }

  function restoreSelection() {
    editorRef.current?.focus()
    if (!savedSelectionRef.current) return
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(savedSelectionRef.current)
  }

  function runCommand(command, option = null) {
    restoreSelection()
    document.execCommand(command, false, option)
    emitChange()
    saveSelection()
    editorRef.current?.focus()
  }

  function insertSymbol(symbol) {
    runCommand('insertText', symbol)
  }

  function applyFontSize(size) {
    restoreSelection()
    document.execCommand('fontSize', false, '7')
    editorRef.current?.querySelectorAll('font[size="7"]').forEach(node => {
      const span = document.createElement('span')
      span.style.fontSize = size
      span.innerHTML = node.innerHTML
      node.replaceWith(span)
    })
    emitChange()
    saveSelection()
    editorRef.current?.focus()
  }

  function currentBlock() {
    const selection = window.getSelection()
    let node = selection?.anchorNode
    if (!node || !editorRef.current?.contains(node)) return null
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement
    while (node && node !== editorRef.current && !['P', 'DIV', 'LI'].includes(node.tagName)) {
      node = node.parentElement
    }
    if (!node || node === editorRef.current) {
      document.execCommand('formatBlock', false, 'div')
      node = window.getSelection()?.anchorNode
      if (node?.nodeType === Node.TEXT_NODE) node = node.parentElement
      while (node && node !== editorRef.current && !['P', 'DIV', 'LI'].includes(node.tagName)) {
        node = node.parentElement
      }
    }
    return node && node !== editorRef.current ? node : null
  }

  function applyBlockStyle(styles) {
    restoreSelection()
    const block = currentBlock()
    if (block) Object.assign(block.style, styles)
    else if (editorRef.current) Object.assign(editorRef.current.style, styles)
    emitChange()
    saveSelection()
    editorRef.current?.focus()
  }

  function handleEditorKeyDown(event) {
    if (event.key === 'Enter') {
      event.preventDefault()
      document.execCommand('insertParagraph')
      emitChange()
      saveSelection()
      return
    }
    if (!(event.ctrlKey || event.metaKey)) return
    if (event.key === '.' || event.key === '>') {
      event.preventDefault()
      insertSymbol('\u2265')
    }
    if (event.key === ',' || event.key === '<') {
      event.preventDefault()
      insertSymbol('\u2264')
    }
  }

  function clearHighlight() {
    runCommand('hiliteColor', 'transparent')
  }

  return (
    <div className="rich-editor" style={{ '--editor-line-height': lineHeight, '--editor-paragraph-gap': paragraphGap }}>
      <div className="rich-toolbar">
        <div className="toolbar-group">
          <button type="button" className="tool-button" title="Negrito" onMouseDown={e => { e.preventDefault(); runCommand('bold') }}>B</button>
          <select
            className="toolbar-select"
            defaultValue=""
            title="Tamanho da fonte"
            onChange={e => {
              if (e.target.value) applyFontSize(e.target.value)
              e.target.value = ''
            }}
          >
            <option value="">Tamanho</option>
            {fontSizes.map(size => <option key={size} value={size}>{size.replace('px', '')}</option>)}
          </select>
        </div>
        <div className="toolbar-group">
          <button type="button" className="tool-button tool-text" title="Alinhar à esquerda" onMouseDown={e => { e.preventDefault(); runCommand('justifyLeft') }}>E</button>
          <button type="button" className="tool-button tool-text" title="Centralizar" onMouseDown={e => { e.preventDefault(); runCommand('justifyCenter') }}>C</button>
          <button type="button" className="tool-button tool-text" title="Justificar" onMouseDown={e => { e.preventDefault(); runCommand('justifyFull') }}>J</button>
        </div>
        <div className="toolbar-group">
          <select
            className="toolbar-select"
            defaultValue=""
            title="Espaçamento entre linhas"
            onChange={e => {
              if (e.target.value) applyBlockStyle({ lineHeight: e.target.value })
              e.target.value = ''
            }}
          >
            <option value="">Linha</option>
            {lineHeights.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <select
            className="toolbar-select"
            defaultValue=""
            title="Espaço após parágrafo"
            onChange={e => {
              if (e.target.value) applyBlockStyle({ marginBottom: e.target.value })
              e.target.value = ''
            }}
          >
            <option value="">Parágrafo</option>
            {paragraphSpaces.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>
        <details className="toolbar-menu">
          <summary>Sinais</summary>
          <div className="toolbar-popover">
            <button type="button" className="tool-button" onMouseDown={e => { e.preventDefault(); insertSymbol('\u2265') }}>{'\u2265'}</button>
            <button type="button" className="tool-button" onMouseDown={e => { e.preventDefault(); insertSymbol('\u2264') }}>{'\u2264'}</button>
          </div>
        </details>
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
        onKeyDown={handleEditorKeyDown}
        onKeyUp={saveSelection}
        onMouseUp={saveSelection}
        onFocus={saveSelection}
        onBlur={() => {
          emitChange()
          saveSelection()
        }}
      />
    </div>
  )
}


export default function App() {
  const [ready, setReady] = useState(false)
  const [logged, setLogged] = useState(false)
  const [user, setUser] = useState(null)
  const [sessionToken, setSessionToken] = useState('')
  const [login, setLogin] = useState('')
  const [senha, setSenha] = useState('')
  const [studyScorePulse, setStudyScorePulse] = useState(false)
  const [rememberLogin, setRememberLogin] = useState(() => {
    try {
      return localStorage.getItem(REMEMBER_LOGIN_KEY) === 'true'
    } catch {
      return false
    }
  })
  const [authLoading, setAuthLoading] = useState(false)
  const [syncStatus, setSyncStatus] = useState('')
  const [importBusy, setImportBusy] = useState(false)
  const [cards, setCards] = useState(DEFAULT_CARDS)
  const [config, setConfig] = useState(DEFAULT_CONFIG)
  const [stats, setStats] = useState(DEFAULT_STATS)
  const [index, setIndex] = useState(0)
  const [currentCardId, setCurrentCardId] = useState(() => getStoredCurrentCardId())
  const [answer, setAnswer] = useState('')
  const [feedback, setFeedback] = useState(null)
  const [pendingGrade, setPendingGrade] = useState(null)
  const [lastAnsweredId, setLastAnsweredId] = useState(null)
  const [editing, setEditing] = useState(false)
  const [libraryEditingId, setLibraryEditingId] = useState(null)
  const [editFront, setEditFront] = useState('')
  const [editBack, setEditBack] = useState('')
  const editFrontRef = useRef('')
  const editBackRef = useRef('')
  const [tab, setTab] = useState('study')
  const [siteSeconds, setSiteSeconds] = useState(0)
  const [cardSeconds, setCardSeconds] = useState(0)
  const [importLog, setImportLog] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [cardStageFilter, setCardStageFilter] = useState('all')
  const [librarySortMode, setLibrarySortMode] = useState('difficulty')
  const [libraryTagFilter, setLibraryTagFilter] = useState('')
  const [libraryVisibleCount, setLibraryVisibleCount] = useState(80)
  const [studyTag, setStudyTag] = useState('')
  const [focusedCardIds, setFocusedCardIds] = useState([])
  const [newFront, setNewFront] = useState('')
  const [newBack, setNewBack] = useState('')
  const [newTags, setNewTags] = useState('')
  const [splitCardId, setSplitCardId] = useState(null)
  const [splitParts, setSplitParts] = useState([])
  const [splitSuspendOriginal, setSplitSuspendOriginal] = useState(true)
  const [timeChallenge, setTimeChallenge] = useState(false)
  const [challengeLeft, setChallengeLeft] = useState(30)
  const answerRef = useRef(null)
  const lastStudyScoreRef = useRef(null)
  const drainingSyncOutbox = useRef(false)
  const localMutationAtRef = useRef(0)
  const latestCardsRef = useRef(cards)
  const latestStatsRef = useRef(stats)
  const fullDeckSyncInFlightRef = useRef(false)
  const answerSubmissionLockRef = useRef(null)
  const localStateKeyRef = useRef(LOCAL_STATE_KEY)
  const localSyncOutboxKeyRef = useRef(LOCAL_SYNC_OUTBOX_KEY)

  function setLocalStorageScope(authedUser) {
    const userId = cloudUserId(authedUser)
    localStateKeyRef.current = localStateKeyForUser(userId)
    localSyncOutboxKeyRef.current = localSyncOutboxKeyForUser(userId)
    try {
      if (userId) localStorage.setItem(LOCAL_LAST_USER_ID_KEY, userId)
      else localStorage.removeItem(LOCAL_LAST_USER_ID_KEY)
    } catch {
      // Scope is only a local cache hint; the cloud remains the source of truth.
    }
  }

  async function loginThroughProxy(email, password) {
    const response = await fetch('/api/auth-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password })
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.message || data.error_description || data.error || 'Falha no login.')
    return data
  }

  async function getProfileThroughProxy(authedUser, token, options = {}) {
    if (!token) return null
    if (token === FIREBASE_CLOUD_TOKEN) return getFirebaseProfile(authedUser, options)

    const response = await fetch(`/api/profile?id=${encodeURIComponent(authedUser.id)}`, {
      headers: { authorization: `Bearer ${token}` }
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) throw new Error(data?.message || 'Falha ao carregar progresso.')
    return data
  }

  async function saveProfileThroughProxy(authedUser, token, nextCards, nextStats) {
    if (!token) throw new Error('Sessao sem token.')
    if (token === FIREBASE_CLOUD_TOKEN) {
      await saveFirebaseProfile(authedUser, nextCards, nextStats)
      return { ok: true, provider: 'firebase' }
    }

    const payload = {
      id: authedUser.id,
      email: authedUser.email
    }
    if (nextStats && typeof nextStats === 'object') payload.stats = nextStats
    if (Array.isArray(nextCards)) payload.cards = nextCards.filter(Boolean)

    const response = await fetch('/api/profile', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.message || 'Falha ao salvar progresso.')
    return data
  }

  async function syncReviewThroughProxy(card, event, authUser = user, token = sessionToken) {
    if (!authUser || !token || !card?.id) return
    if (token === FIREBASE_CLOUD_TOKEN) {
      await saveFirebaseCard(authUser, card, event)
      return { ok: true, provider: 'firebase' }
    }

    const response = await fetch('/api/sync-review', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        userId: authUser.id,
        card,
        event
      })
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.message || 'Falha ao sincronizar revisao.')
    if (data?.ok === false && data?.fallback === 'local') throw new Error(data.message || 'Falha ao sincronizar revisao.')
    return data
  }

  async function syncCardsBatchThroughProxy(cardBatch, authUser = user, token = sessionToken) {
    if (!authUser || !token || !cardBatch?.length) return null
    if (token === FIREBASE_CLOUD_TOKEN) {
      const result = await saveFirebaseCardsBatch(authUser, cardBatch)
      return { ok: true, synced: result?.synced ?? cardBatch.length, failed: result?.failed || 0, provider: 'firebase' }
    }

    const response = await fetch('/api/sync-cards', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        userId: authUser.id,
        cards: cardBatch
      })
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.message || 'Falha ao sincronizar cards.')
    if (data?.ok === false) throw new Error(data.message || 'Falha ao sincronizar cards.')
    return data
  }

  function syncOneCard(card, event = null) {
    if (!card) return
    syncReviewThroughProxy(card, event)
      .then(data => {
        if (data?.fallback === 'profile-json') {
          queueLocalSyncItems({ card, event }, localSyncOutboxKeyRef.current).catch(err => console.warn('Nao foi possivel enfileirar sincronizacao.', err))
          setSyncStatus('Salvo no backup da nuvem. Finalizando sincronizacao granular depois.')
        } else if (data?.fallback) {
          queueLocalSyncItems({ card, event }, localSyncOutboxKeyRef.current).catch(err => console.warn('Nao foi possivel enfileirar sincronizacao.', err))
          setSyncStatus('Banco granular ainda nao esta pronto. Progresso mantido neste navegador.')
        } else {
          drainLocalSyncOutbox().catch(err => console.warn('Fila local ainda pendente.', err))
        }
      })
      .catch(err => {
        console.warn('Sincronizacao granular adiada.', err)
        queueLocalSyncItems({ card, event }, localSyncOutboxKeyRef.current).catch(queueErr => console.warn('Nao foi possivel enfileirar sincronizacao.', queueErr))
        setSyncStatus(`Card salvo localmente. Erro da nuvem: ${firebaseErrorSummary(err)}`)
      })
  }

  function persistLocalStateNow(nextCards, nextStats = stats, overrides = {}) {
    localMutationAtRef.current = Date.now()
    latestCardsRef.current = nextCards
    latestStatsRef.current = nextStats
    const snapshot = {
      cards: nextCards,
      stats: nextStats,
      config: overrides.config || config,
      lastAnsweredId: overrides.lastAnsweredId ?? lastAnsweredId,
      currentCardId: overrides.currentCardId ?? currentCardId
    }
    try {
      localStorage.setItem('mq_cards', JSON.stringify(nextCards))
      localStorage.setItem('mq_stats', JSON.stringify(nextStats))
    } catch (err) {
      console.warn('Nao foi possivel gravar estado imediato no localStorage.', err)
    }
    saveLocalStateSnapshot(snapshot, localStateKeyRef.current).catch(err => {
      console.warn('Snapshot local imediato adiado.', err)
    })
  }

  async function drainLocalSyncOutbox(authUser = user, token = sessionToken) {
    if (!authUser || !token || drainingSyncOutbox.current) return

    drainingSyncOutbox.current = true
    try {
      const outboxKey = localSyncOutboxKeyForUser(authUser)
      let queued = compactLocalSyncItems(await readLocalSyncOutbox(outboxKey))
      await writeLocalSyncOutbox(queued, outboxKey)
      if (!queued.length) return

      for (const item of queued) {
        const data = await syncReviewThroughProxy(item.card, item.event, authUser, token)
        if (data?.fallback) throw new Error(data.fallback)
        queued = queued.filter(candidate => candidate.id !== item.id)
        await writeLocalSyncOutbox(queued, outboxKey)
        await new Promise(resolve => window.setTimeout(resolve, 120))
      }

      setSyncStatus('Pendencias locais sincronizadas.')
    } catch (err) {
      console.warn('Nao foi possivel drenar fila local.', err)
      const outboxKey = localSyncOutboxKeyForUser(authUser)
      const queued = compactLocalSyncItems(await readLocalSyncOutbox(outboxKey).catch(() => []))
      await writeLocalSyncOutbox(queued, outboxKey).catch(() => {})
      if (queued.length) setSyncStatus(`${queued.length} cards aguardando a nuvem. Erro: ${firebaseErrorSummary(err)}`)
    } finally {
      drainingSyncOutbox.current = false
    }
  }

  async function syncCardsInChunks(cardList, label = 'cards', authUser = user, token = sessionToken) {
    if (!authUser || !token || !Array.isArray(cardList) || !cardList.length) return
    const cardsToSync = cardList.filter(Boolean)
    const chunkSize = 100
    try {
      let failedTotal = 0
      let syncedTotal = 0
      for (let i = 0; i < cardsToSync.length; i += chunkSize) {
        setSyncStatus(`${label}: enviando ${Math.min(i + chunkSize, cardsToSync.length)} de ${cardsToSync.length} para a nuvem...`)
        const result = await syncCardsBatchThroughProxy(cardsToSync.slice(i, i + chunkSize), authUser, token)
        syncedTotal += Number(result?.synced || 0)
        failedTotal += Number(result?.failed || 0)
        if (result?.failed) {
          setSyncStatus(`${label}: ${result.synced || 0} salvos na nuvem, ${result.failed} aguardando nova tentativa.`)
        }
        await new Promise(resolve => window.setTimeout(resolve, 150))
      }
      if (failedTotal) {
        setSyncStatus(`${label}: ${syncedTotal} salvos na nuvem, ${failedTotal} aguardando nova tentativa.`)
      } else {
        setSyncStatus(`${label} sincronizados na nuvem.`)
      }
      return { synced: syncedTotal, failed: failedTotal }
    } catch (err) {
      console.warn('Sincronizacao em lote adiada.', err)
      await queueLocalSyncItems(cardsToSync.map(card => ({ card })), localSyncOutboxKeyForUser(authUser)).catch(queueErr => {
        console.warn('Nao foi possivel enfileirar lote local.', queueErr)
      })
      setSyncStatus(`Falha de sincronizacao: ${firebaseErrorSummary(err)}. Importacao ficou salva neste navegador; tentarei sincronizar depois.`)
      return { synced: 0, failed: cardsToSync.length, error: err }
    }
  }

  async function ensureFirebaseDeckComplete(reason = 'Verificacao automatica da nuvem') {
    if (!user || sessionToken !== FIREBASE_CLOUD_TOKEN) {
      return
    }
    if (fullDeckSyncInFlightRef.current) return

    const localDeck = latestCardsRef.current || cards
    const localActive = activeCardCount(localDeck)
    if (!hasRealLocalDeck(localDeck)) {
      return
    }

    fullDeckSyncInFlightRef.current = true
    try {
      let serverActive = 0
      try {
        const serverData = await getProfileThroughProxy(user, sessionToken, { server: true })
        serverActive = activeCardCount(serverData?.cards || [])
      } catch (err) {
        console.warn('Nao foi possivel conferir servidor antes do envio completo.', err)
      }

      if (serverActive === 0) {
        setSyncStatus(`${reason}: esta conta ainda nao tem deck na nuvem; aguardando importacao manual.`)
        return
      }

      if (serverActive >= localActive) return

      setSyncStatus(`${reason}: servidor tem ${serverActive} de ${localActive}. Sincronizando deck completo automaticamente...`)
      const result = await syncCardsInChunks(localDeck, `Deck completo (${localActive} cards)`, user, sessionToken)
      if (result?.failed) return

      await saveProfileThroughProxy(user, sessionToken, undefined, latestStatsRef.current || stats).catch(err => {
        console.warn('Stats apos envio completo adiados.', err)
      })

      try {
        const confirmed = await getProfileThroughProxy(user, sessionToken, { server: true })
        const confirmedActive = activeCardCount(confirmed?.cards || [])
        setSyncStatus(
          confirmedActive >= localActive
            ? `Deck completo confirmado na nuvem: ${confirmedActive} cards.`
            : `Envio feito, mas o servidor ainda mostra ${confirmedActive} de ${localActive}; mantendo deck local e tentando novamente depois.`
        )
      } catch (err) {
        console.warn('Nao foi possivel confirmar servidor apos envio completo.', err)
        setSyncStatus('Deck completo enviado. Nao consegui confirmar o servidor agora; tentarei novamente automaticamente.')
      }
    } finally {
      fullDeckSyncInFlightRef.current = false
    }
  }

  async function loadCloudProgress(authedUser, seedCards = cards, seedStats = stats, token = sessionToken) {
    if (!authedUser) return

    setSyncStatus('Carregando progresso salvo...')
    const loadStartedAt = Date.now()

    let data = null
    if (token) {
      data = await getProfileThroughProxy(authedUser, token, { server: token === FIREBASE_CLOUD_TOKEN })
    } else {
      const result = await supabase
        .from('profiles')
        .select('stats')
        .eq('id', authedUser.id)
        .maybeSingle()

      if (result.error) throw result.error
      data = result.data
    }

    const hasCloudCards = Array.isArray(data?.cards) && data.cards.length > 0
    const hasCloudStats = data?.stats && typeof data.stats === 'object'

    if (data?.granularReady === false) {
      setSyncStatus('Banco granular ainda nao esta pronto. Usando progresso local.')
    }

    if (token === FIREBASE_CLOUD_TOKEN && !hasCloudCards) {
      const emptyStats = safeStats(DEFAULT_STATS)
      setCards([])
      setStats(emptyStats)
      setCurrentCardId('')
      setLastAnsweredId(null)
      latestCardsRef.current = []
      latestStatsRef.current = emptyStats
      localMutationAtRef.current = Date.now()
      if (!hasCloudStats) {
        await saveProfileThroughProxy(authedUser, token, undefined, emptyStats)
      }
      setSyncStatus('Firebase conectado. Esta conta ainda esta vazia; importe um deck para testar.')
      return
    }

    let cardsToUse = hasCloudCards ? data.cards : seedCards
    const localActive = activeCardCount(seedCards)
    const cloudActive = activeCardCount(cardsToUse)
    const hasLocalCards = hasRealLocalDeck(seedCards)
    const shouldMergeLocal = hasCloudCards && hasLocalCards
    const localDeckIsLarger = hasCloudCards && localActive > cloudActive
    const shouldUploadLocalDeck = token === FIREBASE_CLOUD_TOKEN && hasCloudCards && hasLocalCards && localActive > cloudActive

    if (shouldMergeLocal) {
      cardsToUse = mergeCardSources(data.cards, seedCards)
      setSyncStatus(`${token === FIREBASE_CLOUD_TOKEN ? 'Firebase' : 'Nuvem'} sincronizado. Deck local preservado.`)
    }

    const localChangedDuringLoad = localMutationAtRef.current > loadStartedAt
    if (!localChangedDuringLoad) {
      if (hasCloudCards || hasLocalCards) setCards(cardsToUse)
      if (hasCloudStats) setStats(mergeStatsSources(data.stats, seedStats))
    } else {
      setSyncStatus('Nuvem carregou atrasada; mantive suas alteracoes locais recentes.')
      const latestCards = latestCardsRef.current || seedCards
      const latestStats = latestStatsRef.current || seedStats
      const latestHasRealDeck = hasRealLocalDeck(latestCards)
      const latestActive = activeCardCount(latestCards)
      if (token === FIREBASE_CLOUD_TOKEN && latestHasRealDeck && hasCloudCards && latestActive > activeCardCount(data?.cards || [])) {
        setSyncStatus(`Firebase incompleto (${activeCardCount(data?.cards || [])} de ${latestActive}). Enviando deck completo para a nuvem...`)
        syncCardsInChunks(latestCards, `Deck completo (${latestActive} cards)`, authedUser, token)
          .then(() => saveProfileThroughProxy(authedUser, token, undefined, mergeStatsSources(data?.stats, latestStats)))
          .catch(err => {
            console.warn('Upload completo do deck adiado.', err)
            setSyncStatus(`Deck local preservado. Falha ao enviar tudo para a nuvem: ${firebaseErrorSummary(err)}`)
          })
        return
      }
      const diffCards = hasCloudCards ? cloudDiffCards(data.cards, latestCards) : (latestHasRealDeck ? latestCards : [])
      if (diffCards.length) syncCardsInChunks(diffCards, `${diffCards.length} alteracoes locais recentes`, authedUser, token)
      if (hasCloudStats) saveProfileThroughProxy(authedUser, token, undefined, mergeStatsSources(data.stats, latestStats)).catch(err => console.warn('Stats recentes adiados.', err))
      return
    }

    if (shouldUploadLocalDeck) {
      const deckForCloud = shouldMergeLocal ? cardsToUse : seedCards
      const count = activeCardCount(deckForCloud)
      setSyncStatus(`Firebase incompleto (${cloudActive} de ${localActive}). Enviando deck completo para a nuvem...`)
      syncCardsInChunks(deckForCloud, `Deck completo (${count} cards)`, authedUser, token)
        .then(() => saveProfileThroughProxy(authedUser, token, undefined, mergeStatsSources(data?.stats, seedStats)))
        .catch(err => {
          console.warn('Upload completo do deck adiado.', err)
          setSyncStatus(`Deck local preservado. Falha ao enviar tudo para a nuvem: ${firebaseErrorSummary(err)}`)
        })
      return
    }

    if (data?.migrationNeeded && hasCloudCards) {
      if (!localDeckIsLarger) {
        setSyncStatus(`Recuperando backup antigo: ${data.legacyCardCount || data.cards.length} cards encontrados. Sincronizando em lotes...`)
      }
      syncCardsInChunks(cardsToUse, shouldMergeLocal ? 'Deck local preservado' : 'Backup antigo recuperado', authedUser, token)
      return
    }

    if (shouldMergeLocal) {
      const diffCards = cloudDiffCards(data.cards, seedCards)
      if (diffCards.length) {
        syncCardsInChunks(diffCards, `${diffCards.length} diferencas locais`, authedUser, token)
      }
      if (hasCloudStats) saveProfileThroughProxy(authedUser, token, undefined, mergeStatsSources(data.stats, seedStats)).catch(err => console.warn('Stats merge adiado.', err))
      return
    }

    if (!hasCloudCards && !hasCloudStats) {
      if (token) {
        await saveProfileThroughProxy(authedUser, token, undefined, seedStats)
      } else {
        await supabase
          .from('profiles')
          .upsert({
            id: authedUser.id,
            email: authedUser.email,
            stats: seedStats
          })
      }
      setSyncStatus(token === FIREBASE_CLOUD_TOKEN ? 'Firebase conectado. Cards serao salvos na nova nuvem.' : 'Conta pronta. Cards serao salvos de forma granular ao estudar.')
      return
    }

    if (data?.granularReady === false) return

    setSyncStatus(token === FIREBASE_CLOUD_TOKEN ? 'Firebase sincronizado.' : 'Progresso sincronizado.')
  }

  useEffect(() => {
    let active = true

    async function boot() {
      let nextCards = DEFAULT_CARDS
      let nextConfig = DEFAULT_CONFIG
      let nextStats = DEFAULT_STATS
      let nextLastAnswered = null
      let nextCurrentCardId = getStoredCurrentCardId()

      try {
        const rememberedUserId = localStorage.getItem(LOCAL_LAST_USER_ID_KEY) || ''
        const vaultKeys = rememberedUserId ? [localStateKeyForUser(rememberedUserId), LOCAL_STATE_KEY] : [LOCAL_STATE_KEY]
        let vault = null
        for (const key of vaultKeys) {
          const candidate = await readLocalVault(key).catch(() => null)
          if (candidate && (Array.isArray(candidate.cards) || candidate.config || candidate.stats)) {
            vault = candidate
            break
          }
        }
        if (Array.isArray(vault?.cards)) nextCards = vault.cards
        if (vault?.config) nextConfig = { ...DEFAULT_CONFIG, ...vault.config }
        if (vault?.stats) nextStats = safeStats(vault.stats)
        if (vault?.lastAnsweredId) nextLastAnswered = vault.lastAnsweredId
        if (vault?.currentCardId) nextCurrentCardId = vault.currentCardId

        const savedCards = localStorage.getItem('mq_cards')
        const savedConfig = localStorage.getItem('mq_config')
        const savedStats = localStorage.getItem('mq_stats')
        const savedLastAnswered = localStorage.getItem('mq_last_answered')
        const savedCurrentCardId = localStorage.getItem(CURRENT_CARD_KEY)

        if (!Array.isArray(vault?.cards) && savedCards) nextCards = JSON.parse(savedCards)
        if (!vault?.config && savedConfig) nextConfig = { ...DEFAULT_CONFIG, ...JSON.parse(savedConfig) }
        if (!vault?.stats && savedStats) nextStats = safeStats(JSON.parse(savedStats))
        if (!vault?.lastAnsweredId && savedLastAnswered) nextLastAnswered = savedLastAnswered
        if (!vault?.currentCardId && savedCurrentCardId) nextCurrentCardId = savedCurrentCardId
        deleteLocalVaultKeysByPrefix('backup:').catch(err => console.warn('Limpeza de backups locais antigos adiada.', err))
      } catch {
        localStorage.removeItem('mq_stats')
      }

      if (active) {
        setCards(nextCards)
        setConfig(nextConfig)
        setStats(nextStats)
        if (nextLastAnswered) setLastAnsweredId(nextLastAnswered)
        if (nextCurrentCardId) setCurrentCardId(nextCurrentCardId)
        setReady(true)
      }

      try {
        const firebaseUser = await waitForFirebaseUser()
        if (firebaseUser) {
          setLocalStorageScope(firebaseUser)
          withTimeout(
            loadCloudProgress(firebaseUser, nextCards, nextStats, FIREBASE_CLOUD_TOKEN),
            25000,
            'Tempo limite ao sincronizar Firebase'
          ).catch(err => {
            console.error(err)
            if (active) setSyncStatus('Nao consegui sincronizar Firebase agora. Usando progresso local.')
          })
          if (active) {
            setUser(firebaseUser)
            setSessionToken(FIREBASE_CLOUD_TOKEN)
            setLogged(true)
          }
          return
        }

        clearStoredAuthSession()
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

  useEffect(() => {
    if (!importLog) return
    const timeout = window.setTimeout(() => setImportLog(''), 9000)
    return () => window.clearTimeout(timeout)
  }, [importLog])

  const activeCards = useMemo(() => cards.filter(card => !card.deleted), [cards])
  const activeDeckCount = activeCards.length
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
  const todayNewCards = dailyNewCardCount(stats, todayKey())
  const newDailyGoal = configuredNewDailyGoal(config)
  const remainingNewToday = Math.max(0, newDailyGoal - todayNewCards)
  const seenCardIds = useMemo(() => historyCardIds(stats), [stats.history])
  const reviewStreakForNewRatio = useMemo(() => reviewRatioStreak(stats), [stats.history])
  const dueRefreshKey = Math.floor(Date.now() / 30000)
  const dueCards = useMemo(() => {
    const now = Date.now()
    const base = focusedCards.length
      ? focusedCards.filter(c => !c.suspended)
      : activeCards.filter(c => !c.suspended && (!studyTag || String(c.tags || '').split(/\s+/).includes(studyTag)))
    const dueBase = base.filter(c => isCardDue(c, now))
    const due = focusedCards.length
      ? sortDueQueue(dueBase, now)
      : buildStudyQueue(base, seenCardIds, true, now, reviewStreakForNewRatio)

    if (focusedCards.length && !due.length) {
      const fallbackBase = activeCards.filter(c =>
        !c.deleted &&
        !c.suspended &&
        (!studyTag || String(c.tags || '').split(/\s+/).includes(studyTag))
      )
      return buildStudyQueue(fallbackBase, seenCardIds, true, now, reviewStreakForNewRatio)
    }

    return due
  }, [activeCards, focusedCards, studyTag, dueRefreshKey, seenCardIds, reviewStreakForNewRatio])
  const answeredCardId = pendingGrade?.cardId || feedback?.cardId || ''
  const queuedCurrent = dueCards.length ? dueCards[index % dueCards.length] : null
  const answeredCurrent = pendingGrade?.scheduledCard || (answeredCardId ? activeCards.find(card => card.id === answeredCardId) : null)
  const lockedCurrent = currentCardId ? activeCards.find(card => card.id === currentCardId && !card.deleted && !card.suspended) : null
  const current = answeredCurrent || lockedCurrent || queuedCurrent
  const currentQueueIndex = current ? dueCards.findIndex(card => card.id === current.id) : -1
  const currentQueueNumber = currentQueueIndex >= 0 ? currentQueueIndex + 1 : Math.min(index + 1, dueCards.length)
  const currentView = current ? getCardView(current) : null
  const currentAnswerPanelHtml = firstVisibleHtml(
    editing ? editBackRef.current : '',
    editing ? editBack : '',
    feedback?.cardId === current?.id ? feedback.expectedHtml : '',
    feedback?.cardId === current?.id ? feedback.expected : '',
    cardBackHtml(currentView),
    cardBackHtml(current)
  )
  const shouldShowAnswerPanel = Boolean(
    (feedback?.cardId === current?.id || editing) && hasVisibleHtmlContent(currentAnswerPanelHtml)
  )
  const currentStageBadge = current ? reviewStageDetails(current) : null
  const currentTagText = normalize(String(current?.tags || ''))
  const currentExamBadges = [
    currentTagText.includes('usp') ? { key: 'usp', label: 'USP' } : null,
    currentTagText.includes('unicamp') ? { key: 'unicamp', label: 'Unicamp' } : null
  ].filter(Boolean)
  const todayDone = dailyAnswerCount(stats, todayKey())
  const todayReviewCards = Math.max(0, todayDone - todayNewCards)
  const remainingToday = Math.max(0, Number(config.dailyGoal || 0) - todayDone)
  const totalAnswered = Number(stats.correct || 0) + Number(stats.wrong || 0)
  const accuracy = totalAnswered ? Math.round((Number(stats.correct || 0) / totalAnswered) * 100) : 0
  const seenDeckCount = activeCards.filter(card => seenCardIds.has(card.id)).length
  const seenDeckPercent = activeCards.length ? Math.round((seenDeckCount / activeCards.length) * 100) : 0
  const masteredCount = activeCards.filter(card => learningLevel(card) >= MASTERED_LEVEL).length
  const remainingLearningSteps = activeCards.reduce((sum, card) => sum + Math.max(0, MASTERED_LEVEL - learningLevel(card)), 0)
  const targetDate = targetDateFromConfig(config)
  const targetDateLabel = shortDateLabel(targetDate)
  const daysUntilTarget = Math.max(1, Math.ceil((targetDate.getTime() - Date.now()) / DAY))
  const dailyTargetToFinish = Math.ceil(remainingLearningSteps / daysUntilTarget)
  const masteredResponses = masteredCount
  const progress = seenDeckPercent
  const exposurePercent = seenDeckPercent
  const avgTime = totalAnswered ? Math.round(Number(stats.totalAnswerSeconds || 0) / totalAnswered) : 0
  const recentHistory = (stats.history || []).slice(-50)
  const previousHistory = (stats.history || []).slice(-100, -50)
  const recentCorrectRate = recentHistory.length ? Math.round((recentHistory.filter(item => item.correct).length / recentHistory.length) * 100) : 0
  const previousCorrectRate = previousHistory.length ? Math.round((previousHistory.filter(item => item.correct).length / previousHistory.length) * 100) : null
  const recentTrend = previousCorrectRate == null ? null : recentCorrectRate - previousCorrectRate
  const performanceDays = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(Date.now() - (29 - index) * DAY)
    const key = dateKey(date)
    const dayHistory = (stats.history || []).filter(item => historyItemDayKey(item) === key)
    const avgPercent = dayHistory.length
      ? Math.round(dayHistory.reduce((sum, item) => sum + Number(item.percent || 0), 0) / dayHistory.length)
      : 0
    return {
      key,
      label: key.slice(5).replace('-', '/'),
      count: dailyAnswerCount(stats, key),
      avgPercent
    }
  })
  const maxPerformanceCount = Math.max(1, ...performanceDays.map(day => day.count))
  const last7Days = performanceDays.slice(-7)
  const previous7Days = performanceDays.slice(-14, -7)
  const last7UniqueCount = last7Days.reduce((sum, day) => sum + day.count, 0)
  const previous7UniqueCount = previous7Days.reduce((sum, day) => sum + day.count, 0)
  const weeklyCountTrend = last7UniqueCount - previous7UniqueCount
  const activeStudyDays = last7Days.filter(day => day.count > 0).length
  const currentAlreadyAnswered = !!current && (
    pendingGrade?.cardId === current.id ||
    feedback?.cardId === current.id
  )
  useEffect(() => {
    const lockedCardId = answerSubmissionLockRef.current
    if (!lockedCardId) return
    if (!current?.id || lockedCardId !== current.id || (!pendingGrade && !feedback)) {
      answerSubmissionLockRef.current = null
    }
  }, [current?.id, pendingGrade, feedback])
  const reviewMetricsByCard = useMemo(() => buildCardReviewMetrics(stats.history), [stats.history])
  const libraryBaseCards = useMemo(() => {
    const q = normalize(searchTerm)
    return activeCards.filter(card => {
      const tagList = String(card.tags || '').split(/\s+/).filter(Boolean)
      const matchesTag = !libraryTagFilter || tagList.includes(libraryTagFilter)
      const matchesSearch = !q || normalize(`${card.pergunta || ''} ${card.resposta || ''} ${card.tags || ''}`).includes(q)
      return matchesTag && matchesSearch
    })
  }, [activeCards, searchTerm, libraryTagFilter])
  const reviewCategoryCounts = useMemo(() => {
    const counts = {
      all: libraryBaseCards.length,
      new: 0,
      'level-10m': 0,
      'level-2': 0,
      'level-3': 0,
      'level-4': 0,
      'level-5': 0,
      'level-6': 0,
      learned: 0
    }
    libraryBaseCards.forEach(card => {
      const key = reviewCategoryKey(card)
      counts[key] = (counts[key] || 0) + 1
    })
    return counts
  }, [libraryBaseCards])
  const reviewCategoryOptions = [
    { key: 'all', label: 'Todos', className: 'stage-all' },
    { key: 'new', label: 'Ineditos', className: 'stage-new' },
    { key: 'level-10m', label: '10 minutos', className: 'stage-level-10m' },
    { key: 'level-2', label: '1 dia', className: 'stage-level-2' },
    { key: 'level-3', label: '3 dias', className: 'stage-level-3' },
    { key: 'level-4', label: '7 dias', className: 'stage-level-4' },
    { key: 'level-5', label: '15 dias', className: 'stage-level-5' },
    { key: 'level-6', label: '30 dias', className: 'stage-level-6' },
    { key: 'learned', label: 'Aprendidos', className: 'stage-learned' }
  ]
  const filteredCards = useMemo(() => {
    return libraryBaseCards
      .filter(c => cardStageFilter === 'all' || reviewCategoryKey(c) === cardStageFilter)
      .sort((a, b) => {
        if (librarySortMode === 'recent') return cardAddedScore(b) - cardAddedScore(a)
        return sortCardsByDifficulty(a, b, reviewMetricsByCard)
      })
  }, [libraryBaseCards, cardStageFilter, librarySortMode, reviewMetricsByCard])
  const visibleFilteredCards = filteredCards.slice(0, libraryVisibleCount)

  useEffect(() => {
    setLibraryVisibleCount(80)
  }, [searchTerm, cardStageFilter, libraryTagFilter, librarySortMode])

  const statsPanel = (
    <>
      <section className="stats stats-summary">
        <div className="stat-card stat-deck-total"><Target/><span>Total no deck</span><b>{activeCards.length}</b><small>{seenDeckCount} vistos ({seenDeckPercent}%)</small></div>
        <div className="stat-card stat-today"><ListChecks/><span>Estudados hoje</span><b>{todayDone}</b><small>{todayNewCards} ineditos + {todayReviewCards} revisoes</small></div>
        <div className="stat-card stat-new-today"><Plus/><span>Ineditos hoje</span><b>{todayNewCards}</b></div>
        <div className="stat-card stat-review-today"><RotateCcw/><span>Revisoes hoje</span><b>{todayReviewCards}</b></div>
        <div className="stat-card stat-target-daily"><Trophy/><span>Meta diaria ate {targetDateLabel}</span><b>{dailyTargetToFinish}</b><small>{daysUntilTarget} dias restantes</small></div>
        <div className="stat-card stat-seen-deck"><Eye/><span>Ja vistos</span><b>{seenDeckCount}</b><small>{seenDeckPercent}% do deck</small></div>
        <div className="stat-card"><BarChart3/><span>Precisão geral</span><b>{accuracy}%</b></div>
        <div className="stat-card stat-streak"><Flame/><span>Streak</span><b>{stats.studyStreak}</b><small>dias com meta batida</small></div>
        <div className="stat-card stat-seen-deck"><Eye/><span>Deck visto</span><b>{seenDeckPercent}%</b><small>{seenDeckCount} de {activeCards.length}</small></div>
        <div className="stat-card"><Target/><span>Vencidos agora</span><b>{dueCards.length}</b></div>
      </section>
      {false && tab === 'stats' && (
        <section className="grade-strip">
          <div className="grade-bad"><b>{stats.byGrade.again}</b><span>0-59%</span><i style={{width: `${Math.min(100, ((stats.byGrade.again || 0) / Math.max(1, totalAnswered)) * 100)}%`}} /></div>
          <div className="grade-mid"><b>{stats.byGrade.hard}</b><span>60-79%</span><i style={{width: `${Math.min(100, ((stats.byGrade.hard || 0) / Math.max(1, totalAnswered)) * 100)}%`}} /></div>
          <div className="grade-ok"><b>{masteredResponses}</b><span>80-100%</span><i style={{width: `${Math.min(100, (masteredResponses / Math.max(1, totalAnswered)) * 100)}%`}} /></div>
        </section>
      )}
      {false && <div className="bar"><div style={{width: `${progress}%`}} /></div>}
    </>
  )

  useEffect(() => {
    latestCardsRef.current = cards
  }, [cards])

  useEffect(() => {
    latestStatsRef.current = stats
  }, [stats])

  useEffect(() => {
    if (lastStudyScoreRef.current == null) {
      lastStudyScoreRef.current = todayDone
      return
    }
    if (todayDone > lastStudyScoreRef.current) {
      setStudyScorePulse(true)
      const timer = window.setTimeout(() => setStudyScorePulse(false), 650)
      lastStudyScoreRef.current = todayDone
      return () => window.clearTimeout(timer)
    }
    lastStudyScoreRef.current = todayDone
  }, [todayDone])

  useEffect(() => {
    if (!ready) return

    const timer = window.setTimeout(() => {
      saveLocalStateSnapshot({
        cards,
        stats,
        config,
        lastAnsweredId,
        currentCardId
      }, localStateKeyRef.current).catch(err => {
        console.warn('Nao foi possivel salvar cofre local.', err)
      })
    }, 800)

    return () => window.clearTimeout(timer)
  }, [cards, stats, config, lastAnsweredId, currentCardId, ready])

  useEffect(() => {
    if (!ready) return

    try {
      localStorage.setItem('mq_cards', JSON.stringify(cards))
    } catch (err) {
      console.warn('Nao foi possivel salvar cards no navegador.', err)
      if (!logged || !sessionToken) {
        setSyncStatus('Deck grande demais para salvar neste navegador. Entre na conta para sincronizar na nuvem.')
      }
    }
  }, [cards, ready, logged, sessionToken])

  useEffect(() => {
    if (!ready) return
    try {
      localStorage.setItem('mq_config', JSON.stringify(config))
    } catch (err) {
      console.warn('Nao foi possivel salvar configuracoes no navegador.', err)
    }
  }, [config, ready])

  useEffect(() => {
    if (!ready) return

    try {
      localStorage.setItem('mq_stats', JSON.stringify(stats))
    } catch (err) {
      console.warn('Nao foi possivel salvar estatisticas no navegador.', err)
      if (!logged || !sessionToken) {
        setSyncStatus('Estatisticas grandes demais para salvar neste navegador. Entre na conta para sincronizar na nuvem.')
      }
    }
  }, [stats, ready, logged, sessionToken])

  useEffect(() => {
    if (!ready || !logged || !user || !sessionToken) return

    const saveTimer = window.setTimeout(async () => {
      try {
        await saveProfileThroughProxy(user, sessionToken, undefined, stats)
      } catch (err) {
        console.warn('Nao foi possivel salvar estatisticas agora.', err)
        setSyncStatus(`Estatisticas salvas localmente. Erro da nuvem: ${firebaseErrorSummary(err)}`)
      }
    }, 12000)

    return () => window.clearTimeout(saveTimer)
  }, [stats, ready, logged, user, sessionToken])

  useEffect(() => {
    if (!ready || !logged || !user || !sessionToken) return

    drainLocalSyncOutbox(user, sessionToken).catch(err => console.warn('Fila local ainda pendente.', err))
    const timer = window.setInterval(() => {
      drainLocalSyncOutbox(user, sessionToken).catch(err => console.warn('Fila local ainda pendente.', err))
    }, 30000)

    return () => window.clearInterval(timer)
  }, [ready, logged, user, sessionToken])

  useEffect(() => {
    if (!ready || !logged || !user || sessionToken !== FIREBASE_CLOUD_TOKEN) return
    if (!hasRealLocalDeck(latestCardsRef.current || cards)) return

    const timer = window.setTimeout(() => {
      ensureFirebaseDeckComplete('Verificacao automatica da nuvem').catch(err => {
        console.warn('Verificacao automatica do Firebase falhou.', err)
        setSyncStatus(`Nao consegui confirmar a nuvem agora: ${firebaseErrorSummary(err)}`)
      })
    }, 5000)

    return () => window.clearTimeout(timer)
  }, [ready, logged, user, sessionToken, activeDeckCount])

  useEffect(() => {
    if (!ready || !logged || !user || sessionToken !== FIREBASE_CLOUD_TOKEN) return

    const timer = window.setInterval(() => {
      ensureFirebaseDeckComplete('Verificacao periodica da nuvem').catch(err => {
        console.warn('Verificacao periodica do Firebase falhou.', err)
      })
    }, 60000)

    return () => window.clearInterval(timer)
  }, [ready, logged, user, sessionToken])

  useEffect(() => {
    if (!ready) return
    try {
      if (currentCardId) localStorage.setItem(CURRENT_CARD_KEY, currentCardId)
      else localStorage.removeItem(CURRENT_CARD_KEY)
    } catch {
      // The selected card can be recovered from the queue if storage is unavailable.
    }
  }, [currentCardId, ready])

  useEffect(() => {
    if (answer.trim() || editing || feedback || pendingGrade) return

    if (currentCardId) {
      const locked = activeCards.find(card => card.id === currentCardId && !card.deleted && !card.suspended)
      if (!locked) {
        setCurrentCardId(queuedCurrent?.id || '')
        return
      }

      const lockedIsQueued = dueCards.some(card => card.id === currentCardId)
      if (!lockedIsQueued && queuedCurrent?.id && queuedCurrent.id !== currentCardId) {
        setCurrentCardId(queuedCurrent.id)
        return
      }

      if (!isCardDue(locked) && queuedCurrent?.id && queuedCurrent.id !== currentCardId) {
        setCurrentCardId(queuedCurrent.id)
      }
      return
    }
    if (queuedCurrent) setCurrentCardId(queuedCurrent.id)
  }, [currentCardId, queuedCurrent?.id, activeCards, dueCards, answer, editing, feedback, pendingGrade])

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
    setChallengeLeft(30)
  }, [index, current?.id])

  useEffect(() => {
    if (!timeChallenge || !current || currentAlreadyAnswered || editing) return
    const t = setInterval(() => {
      setChallengeLeft(prev => Math.max(0, prev - 1))
    }, 1000)
    return () => clearInterval(t)
  }, [timeChallenge, current?.id, currentAlreadyAnswered, editing])

  useEffect(() => {
    if (!timeChallenge || !current || currentAlreadyAnswered || editing) return
    if (challengeLeft <= 0) evaluate({ timedOut: true })
  }, [timeChallenge, challengeLeft, current?.id, currentAlreadyAnswered, editing])

  useEffect(() => {
    if (!authLoading) return
    const timer = window.setTimeout(() => {
      setAuthLoading(false)
      setFeedback({ type: 'bad', text: 'Login demorou demais. Tente novamente; se repetir, confirme Email/senha no Firebase Authentication.' })
    }, 20000)
    return () => window.clearTimeout(timer)
  }, [authLoading])

  async function cloudEnter() {
    const email = login.trim()
    if (!email || !senha) {
      setFeedback({ type: 'bad', text: 'Digite email e senha.' })
      return
    }

    setAuthLoading(true)
    setFeedback(null)
    if (rememberLogin) {
      localStorage.setItem(REMEMBER_LOGIN_KEY, 'true')
    } else {
      localStorage.removeItem(REMEMBER_LOGIN_KEY)
    }
    clearStoredAuthSession()

    try {
      await withTimeout(
        setPersistence(firebaseAuth, rememberLogin ? browserLocalPersistence : browserSessionPersistence),
        5000,
        'Tempo limite ao preparar login Firebase'
      )
      let firebaseCredential
      try {
        firebaseCredential = await withTimeout(
          signInWithEmailAndPassword(firebaseAuth, email, senha),
          8000,
          'Tempo limite ao fazer login no Firebase'
        )
      } catch (firebaseErr) {
        const code = firebaseErr?.code || ''
        if (/user-not-found/i.test(code)) {
          firebaseCredential = await withTimeout(
            createUserWithEmailAndPassword(firebaseAuth, email, senha),
            8000,
            'Tempo limite ao criar conta no Firebase'
          )
        } else {
          throw firebaseErr
        }
      }

      const firebaseUser = firebaseCredential?.user
      if (!firebaseUser) {
        setFeedback({ type: 'bad', text: 'Nao consegui autenticar no Firebase.' })
        return
      }

      setLocalStorageScope(firebaseUser)
      setUser(firebaseUser)
      setSessionToken(FIREBASE_CLOUD_TOKEN)
      setLogged(true)
      setSenha('')
      setFeedback(null)
      setSyncStatus('Firebase conectado. Carregando nova nuvem...')

      withTimeout(
        loadCloudProgress(firebaseUser, cards, stats, FIREBASE_CLOUD_TOKEN),
        30000,
        'Tempo limite ao carregar progresso'
      ).catch(err => {
        console.error(err)
        setSyncStatus('Nao consegui sincronizar agora. Usando progresso local.')
      })
    } catch (err) {
      console.error(err)
      setFeedback({ type: 'bad', text: authErrorMessage(err) })
    } finally {
      setAuthLoading(false)
    }
  }

  async function cloudLogout() {
    if (user) {
      await firebaseSignOut(firebaseAuth).catch(err => console.warn('Nao foi possivel encerrar Firebase.', err))
      await supabase.auth.signOut().catch(err => console.warn('Nao foi possivel encerrar sessao remota.', err))
    }
    clearStoredAuthSession()
    localStorage.removeItem(REMEMBER_LOGIN_KEY)
    setRememberLogin(false)
    setUser(null)
    setSessionToken('')
    setLogged(false)
    setLocalStorageScope(null)
    setFeedback(null)
    setSyncStatus('')
    setSiteSeconds(0)
    setCardSeconds(0)
  }

  function markDailyDone(oldStats, cardId, isNewCard = false) {
    const t = todayKey()
    const existingSeen = Array.isArray(oldStats.dailySeen?.[t]) ? oldStats.dailySeen[t] : []
    const historySeen = uniqueHistoryIdsForDay(oldStats, t)
    const nextSeen = Array.from(new Set([...existingSeen, ...historySeen, cardId].filter(Boolean)))
    const yesterday = dateKey(new Date(Date.now() - DAY))
    const dailySeen = { ...(oldStats.dailySeen || {}), [t]: nextSeen }
    const daily = { ...(oldStats.daily || {}), [t]: nextSeen.length }
    const answeredTodayFromHistory = (oldStats.history || []).filter(item => isAnsweredHistoryItem(item) && historyItemDayKey(item) === t).length
    const newTodayFromHistory = (oldStats.history || []).filter(item => isAnsweredHistoryItem(item) && historyItemDayKey(item) === t && item.isNewCard === true).length
    const dailyAnswers = { ...(oldStats.dailyAnswers || {}), [t]: Math.max(Number(oldStats.dailyAnswers?.[t] || 0), answeredTodayFromHistory) + 1 }
    const dailyNewAnswers = { ...(oldStats.dailyNewAnswers || {}), [t]: Math.max(Number(oldStats.dailyNewAnswers?.[t] || 0), newTodayFromHistory) + (isNewCard ? 1 : 0) }
    let studyStreak = oldStats.studyStreak || 0
    let lastStudyDate = oldStats.lastStudyDate || ''

    if (dailyAnswers[t] >= STREAK_MIN_CARDS && lastStudyDate !== t) {
      studyStreak = oldStats.lastStudyDate === yesterday ? studyStreak + 1 : 1
      lastStudyDate = t
    }

    return { daily, dailySeen, dailyAnswers, dailyNewAnswers, studyStreak, lastStudyDate }
  }

  function scheduleCard(card, grade, now = Date.now()) {
    const reviewedAt = new Date(now).toISOString()
    const nextSchedule = scheduleByLearningLadder(card, grade, now)
    const isCorrectGrade = grade === 'good' || grade === 'easy'
    const previousAttempts = Math.max(Number(card.reviewAttempts || 0), Number(card.siteReps || 0))
    const learningHistory = Array.isArray(card.learningHistory) ? card.learningHistory : []
    const learningHistoryItem = {
      date: reviewedAt,
      rating: isCorrectGrade ? 'good' : 'again',
      level: nextSchedule.level,
      dueAt: new Date(nextSchedule.dueAt).toISOString(),
      intervalDays: nextSchedule.intervalDays
    }

    return {
      ...card,
      dueAt: nextSchedule.dueAt,
      learnedAt: nextSchedule.learned ? reviewedAt : '',
      learningLevel: nextSchedule.level,
      learningHistory: [...learningHistory, learningHistoryItem].slice(-500),
      reps: Number(card.reps || 0),
      siteReps: Number(card.siteReps || 0) + 1,
      reviewAttempts: previousAttempts + 1,
      reviewCorrect: Number(card.reviewCorrect || 0) + (isCorrectGrade ? 1 : 0),
      reviewWrong: Number(card.reviewWrong || 0) + (isCorrectGrade ? 0 : 1),
      correctCount: Number(card.correctCount || 0) + (isCorrectGrade ? 1 : 0),
      reviewLevel: nextSchedule.level,
      stageProgress: nextSchedule.level,
      lastGrade: grade,
      lastIntervalMs: nextSchedule.intervalMs,
      lastReviewedAt: reviewedAt,
      firstReviewedAt: card.firstReviewedAt || reviewedAt,
      interval: nextSchedule.intervalDays
    }
  }

  function evaluate(options = {}) {
    if (!current) return
    if (currentAlreadyAnswered) return
    if (answerSubmissionLockRef.current === current.id) return
    answerSubmissionLockRef.current = current.id
    const timedOut = !!options?.timedOut

    const cardForAnswer = getCardView(current)
    const userText = answer
    const existingHistory = safeStats(stats).history || []
    const isNewCard = !hasReviewHistory(current) && !existingHistory.some(item => item.id === current.id)
    let percent = 0

    if (cardForAnswer.isCloze && cardForAnswer.clozeAnswers?.length) {
      const scores = cardForAnswer.clozeAnswers.map(item => semanticScore(item, userText, cardForAnswer.pergunta || stripHtml(cardForAnswer.htmlFront)))
      percent = Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
    } else {
      percent = semanticScore(cardForAnswer.resposta || stripHtml(cardForAnswer.htmlBack), userText, cardForAnswer.pergunta || stripHtml(cardForAnswer.htmlFront))
    }

    const grade = percent < 60 ? 'again' : percent < 80 ? 'hard' : percent < 90 ? 'good' : 'easy'
    const isCorrect = percent >= 80
    const xpDelta = isCorrect ? Math.max(5, Math.round(25 * percent / 100)) : -5
    const answeredAtMs = Date.now()
    const answeredAt = new Date(answeredAtMs).toISOString()
    const originalCard = { ...current }
    const scheduledCard = scheduleCard(originalCard, grade, answeredAtMs)
    const nextCardsAfterAnswer = cards.map(card => card.id === current.id ? scheduledCard : card)
    const prevStats = safeStats(stats)
    const dailyPatch = markDailyDone(prevStats, current.id, isNewCard)
    const newXp = Math.max(0, (prevStats.xp || 0) + xpDelta)
    const newStreak = isCorrect ? (prevStats.streak || 0) + 1 : 0
    const historyItem = {
      id: current.id,
      pergunta: cardForAnswer.pergunta,
      percent,
      grade,
      correct: isCorrect,
      isNewCard,
      seconds: cardSeconds,
      day: todayKey(),
      date: answeredAt
    }
    const nextStatsAfterAnswer = {
      ...prevStats,
      ...dailyPatch,
      xp: newXp,
      level: Math.floor(newXp / 100) + 1,
      correct: (prevStats.correct || 0) + (isCorrect ? 1 : 0),
      wrong: (prevStats.wrong || 0) + (isCorrect ? 0 : 1),
      streak: newStreak,
      record: Math.max(prevStats.record || 0, newStreak),
      history: [...(prevStats.history || []), historyItem].slice(-500),
      masteryByCard: {
        ...(prevStats.masteryByCard || {}),
        [current.id]: {
          bestPercent: Math.max(Number(prevStats.masteryByCard?.[current.id]?.bestPercent || 0), percent),
          lastPercent: percent,
          lastGrade: grade,
          updatedAt: answeredAt
        }
      },
      totalAnswerSeconds: (prevStats.totalAnswerSeconds || 0) + cardSeconds,
      fastestSeconds: prevStats.fastestSeconds == null ? cardSeconds : Math.min(prevStats.fastestSeconds, cardSeconds),
      slowestSeconds: Math.max(prevStats.slowestSeconds || 0, cardSeconds),
      byGrade: { ...prevStats.byGrade, [grade]: ((prevStats.byGrade || {})[grade] || 0) + 1 }
    }

    setCards(nextCardsAfterAnswer)
    setStats(nextStatsAfterAnswer)

    setLastAnsweredId(current.id)
    localStorage.setItem('mq_last_answered', current.id)
    setPendingGrade({
      cardId: current.id,
      grade,
      percent,
      correct: isCorrect,
      seconds: cardSeconds,
      answeredAt,
      answeredAtMs,
      isNewCard,
      originalCard,
      scheduledCard
    })
    persistLocalStateNow(nextCardsAfterAnswer, nextStatsAfterAnswer, { lastAnsweredId: current.id })
    syncOneCard(scheduledCard, {
      cardId: current.id,
      grade,
      percent,
      correct: isCorrect,
      seconds: cardSeconds,
      answeredAt,
      isNewCard
    })
    const nextSchedule = previewSchedule(current, grade, config.fsrsRetention)
    const scheduleLabel = nextSchedule.label
    const expectedHtml = cardForAnswer.isCloze && cardForAnswer.clozeAnswers?.length
      ? cardForAnswer.clozeAnswers.join(' / ')
      : cardBackHtml(cardForAnswer)

    setFeedback({
      cardId: current.id,
      type: percent >= 80 ? 'good' : percent >= 60 ? 'medium' : 'bad',
      grade,
      percent,
      text: timedOut ? `Tempo esgotado. Você acertou ${percent}% da resposta.` : `Você acertou ${percent}% da resposta em ${formatTime(cardSeconds)}.`,
      userAnswer: userText,
      expected: stripHtml(expectedHtml),
      expectedHtml,
      scheduleLabel
    })
  }

  function nextCard() {
    const updatedCards = pendingGrade
      ? cards.map(c => c.id === pendingGrade.cardId ? (pendingGrade.scheduledCard || scheduleCard(c, pendingGrade.grade)) : c)
      : cards
    const syncedCard = pendingGrade ? updatedCards.find(c => c.id === pendingGrade.cardId) : null
    const statsForQueue = pendingGrade
      ? {
          ...safeStats(stats),
          history: [
            ...(safeStats(stats).history || []),
            {
              id: pendingGrade.cardId,
              percent: pendingGrade.percent,
              grade: pendingGrade.grade,
              correct: pendingGrade.correct,
              isNewCard: pendingGrade.isNewCard || false,
              day: todayKey(),
              date: pendingGrade.answeredAt || new Date().toISOString()
            }
          ].slice(-500)
        }
      : safeStats(stats)
    const seenIdsForQueue = historyCardIds(statsForQueue)
    const reviewStreakForQueue = reviewRatioStreak(statsForQueue)

    const focusedIds = new Set(focusedCardIds)
    let shouldClearFocus = false
    let freshPool = updatedCards.filter(c => {
      if (c.deleted || c.suspended) return false
      if (focusedIds.size && !focusedIds.has(c.id)) return false
      if (!focusedIds.size && studyTag && !String(c.tags || '').split(/\s+/).includes(studyTag)) return false
      return true
    })
    let freshDue = freshPool.filter(c => isCardDue(c))

    if (!freshDue.length && focusedIds.size) {
      shouldClearFocus = true
      freshPool = updatedCards.filter(c => {
        if (c.deleted || c.suspended) return false
        if (studyTag && !String(c.tags || '').split(/\s+/).includes(studyTag)) return false
        return true
      })
      freshDue = freshPool.filter(c => isCardDue(c))
    }

    setCards(updatedCards)
    if (syncedCard) {
      syncOneCard(syncedCard, {
        cardId: syncedCard.id,
        grade: pendingGrade.grade,
        percent: pendingGrade.percent ?? feedback?.percent ?? 0,
        correct: pendingGrade.correct ?? (pendingGrade.grade === 'good' || pendingGrade.grade === 'easy'),
        seconds: pendingGrade.seconds ?? cardSeconds,
        answeredAt: pendingGrade.answeredAt || new Date().toISOString(),
        manuallyCorrected: feedback?.manuallyCorrected || false,
        isNewCard: pendingGrade.isNewCard || false
      })
    }
    setAnswer('')
    setFeedback(null)
    setPendingGrade(null)
    answerSubmissionLockRef.current = null
    if (shouldClearFocus) setFocusedCardIds([])

    const sortedDue = focusedIds.size
      ? sortDueQueue(freshDue)
      : buildStudyQueue(freshPool, seenIdsForQueue, true, Date.now(), reviewStreakForQueue)

    const alternatives = current ? sortedDue.filter(card => card.id !== current.id) : sortedDue

    if (!alternatives.length) {
      setIndex(0)
      setCurrentCardId('')
      return
    }

    const next = alternatives[0]
    setCurrentCardId(next?.id || '')
    setIndex(Math.max(0, sortedDue.findIndex(card => card.id === next.id)))
  }

  function resetAll() {
    const now = Date.now()
    const nextStats = { ...DEFAULT_STATS, learningResetAt: new Date(now).toISOString() }
    const nextCards = (latestCardsRef.current || cards).map(c => resetCardLearning(c, now))
    setStats(nextStats)
    setCards(nextCards)
    persistLocalStateNow(nextCards, nextStats, { currentCardId: '' })
    setSiteSeconds(0)
    setCardSeconds(0)
    setIndex(0)
    setCurrentCardId('')
    setAnswer('')
    setFeedback(null)
    setPendingGrade(null)
    if (user && sessionToken) {
      syncCardsInChunks(nextCards, 'Deck reiniciado na escada', user, sessionToken)
      saveProfileThroughProxy(user, sessionToken, undefined, nextStats)
        .catch(err => console.warn('Nao foi possivel salvar estatisticas reiniciadas agora.', err))
    }
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
      tags: newTags.trim() || 'manual',
      manualEditedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      palavras: normalize(built.resposta || newBack).split(' ').filter(w => w.length > 3).slice(0, 12)
    }

    const nextCards = [...(latestCardsRef.current || cards), card]
    setCards(nextCards)
    persistLocalStateNow(nextCards, stats, { currentCardId: card.id })
    syncOneCard(card)
    setNewFront('')
    setNewBack('')
    setNewTags('')
    setImportLog('Novo card criado.')
    setTab('study')
    setIndex(0)
    setCurrentCardId(card.id)
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
    const ctrl = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()

    if (ctrl && (key === '~' || key === '`' || key === 'dead' || key === 'm')) {
      event.preventDefault()
      markCurrentAsCorrect()
      return
    }

    if (ctrl && key === 'ç') {
      event.preventDefault()
      markCurrentAsWrong()
      return
    }

    if (ctrl && event.key === 'Enter') {
      event.preventDefault()
      if (currentAlreadyAnswered) {
        nextCard()
      } else if (!editing) {
        evaluate()
      }
      return
    }

    if (ctrl && event.shiftKey && key === 'a') {
      event.preventDefault()
      markCurrentAsCorrect()
      return
    }

    if (!ctrl) return
    if (event.key === '.' || event.key === '>') {
      event.preventDefault()
      insertAnswerSymbol('≥')
    }
    if (event.key === ',' || event.key === '<') {
      event.preventDefault()
      insertAnswerSymbol('≤')
    }
  }

  function buildManualCorrectionStats(prevRaw, cardId, previousGrade, correctedGrade, correctedPercent, correctedCorrect, wasCorrect) {
    const prev = safeStats(prevRaw)
    const history = [...(prev.history || [])]
    const lastIndex = history.map(item => item.id).lastIndexOf(cardId)
    if (lastIndex >= 0) {
      history[lastIndex] = {
        ...history[lastIndex],
        percent: correctedPercent,
        grade: correctedGrade,
        correct: correctedCorrect,
        manuallyCorrected: true
      }
    }

    const byGrade = { ...prev.byGrade }
    if (byGrade[previousGrade] > 0) byGrade[previousGrade] -= 1
    byGrade[correctedGrade] = (byGrade[correctedGrade] || 0) + 1

    const nextCorrect = correctedCorrect
      ? (prev.correct || 0) + (wasCorrect ? 0 : 1)
      : Math.max(0, (prev.correct || 0) - (wasCorrect ? 1 : 0))
    const nextWrong = correctedCorrect
      ? Math.max(0, (prev.wrong || 0) - (wasCorrect ? 0 : 1))
      : (prev.wrong || 0) + (wasCorrect ? 1 : 0)
    const nextStreak = correctedCorrect
      ? (wasCorrect ? prev.streak : Math.max(1, prev.streak || 0))
      : (wasCorrect ? 0 : prev.streak)
    const previousMastery = prev.masteryByCard?.[cardId] || {}

    return {
      ...prev,
      correct: nextCorrect,
      wrong: nextWrong,
      streak: nextStreak,
      record: Math.max(prev.record || 0, nextStreak || 0),
      history,
      masteryByCard: {
        ...(prev.masteryByCard || {}),
        [cardId]: {
          ...previousMastery,
          bestPercent: Math.max(Number(previousMastery.bestPercent || 0), correctedPercent),
          lastPercent: correctedPercent,
          lastGrade: correctedGrade,
          manuallyCorrected: true,
          updatedAt: new Date().toISOString()
        }
      },
      byGrade
    }
  }

  function markCurrentAsCorrect() {
    if (!current || !feedback || feedback.cardId !== current.id) return
    if (feedback.manuallyCorrected && feedback.grade === 'good') return
    const previousGrade = feedback.grade || pendingGrade?.grade || 'again'
    const wasCorrect = feedback.percent >= 80
    const correctedGrade = 'good'
    const cardToCorrect = pendingGrade?.originalCard || current
    const correctionTime = Number(pendingGrade?.answeredAtMs || new Date(pendingGrade?.answeredAt || '').getTime() || Date.now())

    const nextSchedule = scheduleByLearningLadder(cardToCorrect, correctedGrade, correctionTime)
    const correctedCard = scheduleCard(cardToCorrect, correctedGrade, correctionTime)
    const nextCardsAfterCorrection = cards.map(card => card.id === current.id ? correctedCard : card)
    const nextStatsAfterCorrection = buildManualCorrectionStats(stats, current.id, previousGrade, correctedGrade, 80, true, wasCorrect)
    setCards(nextCardsAfterCorrection)
    setStats(nextStatsAfterCorrection)
    persistLocalStateNow(nextCardsAfterCorrection, nextStatsAfterCorrection)
    syncOneCard(correctedCard, {
      cardId: current.id,
      grade: correctedGrade,
      percent: 80,
      correct: true,
      seconds: pendingGrade?.seconds ?? cardSeconds,
      answeredAt: pendingGrade?.answeredAt || new Date().toISOString(),
      manuallyCorrected: true,
      isNewCard: pendingGrade?.isNewCard || false
    })
    setPendingGrade(prev => ({
      ...(prev || {}),
      cardId: current.id,
      grade: correctedGrade,
      percent: 80,
      correct: true,
      answeredAt: prev?.answeredAt || new Date().toISOString(),
      answeredAtMs: prev?.answeredAtMs || correctionTime,
      originalCard: prev?.originalCard || cardToCorrect,
      scheduledCard: correctedCard
    }))
    setFeedback(prev => prev ? {
      ...prev,
        type: 'good',
        grade: correctedGrade,
        percent: 80,
        manuallyCorrected: true,
        text: `Marcado manualmente como acerto. Resultado anterior: ${prev.percent}%.`,
      scheduleLabel: nextSchedule.label
    } : prev)

  }

  function markCurrentAsWrong() {
    if (!current || !feedback || feedback.cardId !== current.id) return
    if (feedback.manuallyCorrected && feedback.grade === 'again') return
    const previousGrade = feedback.grade || pendingGrade?.grade || 'good'
    const wasCorrect = feedback.percent >= 80
    const correctedGrade = 'again'
    const cardToCorrect = pendingGrade?.originalCard || current
    const correctionTime = Number(pendingGrade?.answeredAtMs || new Date(pendingGrade?.answeredAt || '').getTime() || Date.now())
    const nextSchedule = scheduleByLearningLadder(cardToCorrect, correctedGrade, correctionTime)
    const correctedCard = scheduleCard(cardToCorrect, correctedGrade, correctionTime)
    const nextCardsAfterCorrection = cards.map(card => card.id === current.id ? correctedCard : card)
    const nextStatsAfterCorrection = buildManualCorrectionStats(stats, current.id, previousGrade, correctedGrade, 0, false, wasCorrect)
    setCards(nextCardsAfterCorrection)
    setStats(nextStatsAfterCorrection)
    persistLocalStateNow(nextCardsAfterCorrection, nextStatsAfterCorrection)
    syncOneCard(correctedCard, {
      cardId: current.id,
      grade: correctedGrade,
      percent: 0,
      correct: false,
      seconds: pendingGrade?.seconds ?? cardSeconds,
      answeredAt: pendingGrade?.answeredAt || new Date().toISOString(),
      manuallyCorrected: true,
      isNewCard: pendingGrade?.isNewCard || false
    })

    setPendingGrade(prev => ({
      ...(prev || {}),
      cardId: current.id,
      grade: correctedGrade,
      percent: 0,
      correct: false,
      answeredAt: prev?.answeredAt || new Date().toISOString(),
      answeredAtMs: prev?.answeredAtMs || correctionTime,
      originalCard: prev?.originalCard || cardToCorrect,
      scheduledCard: correctedCard
    }))
    setFeedback(prev => prev ? {
      ...prev,
      type: 'bad',
      grade: correctedGrade,
      percent: 0,
      manuallyCorrected: true,
      text: `Marcado manualmente como erro. Resultado anterior: ${prev.percent}%.`,
      scheduleLabel: nextSchedule.label
    } : prev)

  }

  function goToLastAnswered() {
    if (!lastAnsweredId) return
    let updatedCard = null
    const updated = (latestCardsRef.current || cards).map(c => {
      if (c.id !== lastAnsweredId) return c
      updatedCard = { ...c, dueAt: Date.now() }
      return updatedCard
    })
    const freshDue = updated.filter(c => !c.dueAt || c.dueAt <= Date.now())
    const pos = freshDue.findIndex(c => c.id === lastAnsweredId)
    setCards(updated)
    persistLocalStateNow(updated, stats, { currentCardId: lastAnsweredId })
    if (updatedCard) syncOneCard(updatedCard)
    setIndex(pos >= 0 ? pos : 0)
    setCurrentCardId(lastAnsweredId)
    setAnswer('')
    setFeedback(null)
    setPendingGrade(null)
    answerSubmissionLockRef.current = null
    setEditing(false)
    setLibraryEditingId(null)
  }

  function startEdit() {
    if (!current) return
    const v = getCardView(current)
    const backSource = richestVisibleHtml(
      feedback?.cardId === current.id ? feedback.expectedHtml : '',
      feedback?.cardId === current.id ? feedback.expected : '',
      v.htmlBack,
      current.htmlBack,
      current.html_back,
      current.backHtml,
      current.resposta,
      current.answer,
      current.back,
      current.verso
    )
    setLibraryEditingId(null)
    updateEditFront(richEditorInitialHtml(v.htmlFront || v.pergunta || ''))
    updateEditBack(richEditorInitialHtml(backSource))
    setEditing(true)
  }

  function saveEdit() {
    const editingCardId = libraryEditingId || current?.id
    if (!editingCardId) return
    const frontHtmlToSave = normalizeRichHtmlSpacing(editFrontRef.current || editFront, '1.35', '4px')
    const backHtmlToSave = normalizeRichHtmlSpacing(editBackRef.current || editBack, '1.35', '4px')
    const pergunta = stripHtml(frontHtmlToSave)
    const resposta = stripHtml(backHtmlToSave)
    const editedAt = new Date().toISOString()
    let updatedCard = null
    const nextCardsForVault = (latestCardsRef.current || cards).map(c => {
      if (c.id !== editingCardId) return c
      const latestScheduledCard = pendingGrade?.cardId === editingCardId ? pendingGrade.scheduledCard : null
      const baseCard = latestScheduledCard?.id === editingCardId ? latestScheduledCard : c
      updatedCard = {
        ...baseCard,
        pergunta,
        resposta,
        htmlFront: frontHtmlToSave,
        htmlBack: backHtmlToSave,
        html_front: frontHtmlToSave,
        html_back: backHtmlToSave,
        frontHtml: frontHtmlToSave,
        backHtml: backHtmlToSave,
        manualEditedAt: editedAt,
        sourceUpdatedAt: editedAt,
        palavras: normalize(resposta).split(' ').filter(w => w.length > 4).slice(0, 10)
      }
      return updatedCard
    })
    if (!updatedCard) return

    setCards(nextCardsForVault)
    persistLocalStateNow(nextCardsForVault, stats)
    syncOneCard(updatedCard)
    setSyncStatus('Edicao do card salva localmente e enviada para a nuvem.')
    if (pendingGrade?.cardId === editingCardId) {
      setPendingGrade(prev => prev ? {
        ...prev,
        scheduledCard: {
          ...(prev.scheduledCard || {}),
          ...updatedCard
        }
      } : prev)
    }
    if (feedback?.cardId === editingCardId) {
      setFeedback(prev => prev ? {
        ...prev,
        expected: resposta || stripHtml(backHtmlToSave),
        expectedHtml: backHtmlToSave
      } : prev)
    }
    setEditing(false)
    setLibraryEditingId(null)
  }

  function studySingleCard(cardId) {
    let updatedCard = null
    const nextCards = (latestCardsRef.current || cards).map(card => {
      if (card.id !== cardId) return card
      updatedCard = { ...card, dueAt: Date.now() }
      return updatedCard
    })
    setCards(nextCards)
    persistLocalStateNow(nextCards, stats, { currentCardId: cardId })
    if (updatedCard) syncOneCard(updatedCard)
    setFocusedCardIds([cardId])
    setStudyTag('')
    setIndex(0)
    setCurrentCardId(cardId)
    setAnswer('')
    setFeedback(null)
    setPendingGrade(null)
    setEditing(false)
    setLibraryEditingId(null)
    setTab('study')
  }

  function editCardFromLibrary(cardId) {
    const card = activeCards.find(c => c.id === cardId)
    if (!card) return
    const v = getCardView(card)
    const backSource = richestVisibleHtml(
      v.htmlBack,
      card.htmlBack,
      card.html_back,
      card.backHtml,
      card.resposta,
      card.answer,
      card.back,
      card.verso
    )
    setLibraryEditingId(cardId)
    updateEditFront(richEditorInitialHtml(v.htmlFront || v.pergunta || ''))
    updateEditBack(richEditorInitialHtml(backSource))
    setEditing(true)
  }

  function toggleSuspendCard(cardId) {
    let suspended = false
    let updatedCard = null
    const nextCards = (latestCardsRef.current || cards).map(card => {
      if (card.id !== cardId) return card
      suspended = !card.suspended
      updatedCard = {
        ...card,
        suspended,
        suspendedAt: suspended ? new Date().toISOString() : null,
        dueAt: suspended ? card.dueAt : Date.now(),
        manualEditedAt: new Date().toISOString()
      }
      return updatedCard
    })
    setCards(nextCards)
    persistLocalStateNow(nextCards, stats)
    if (updatedCard) syncOneCard(updatedCard)
    setImportLog(suspended ? 'Card suspenso. Ele nao aparecera nas revisoes normais.' : 'Card reativado. Ele voltou para as revisoes.')
  }

  function deleteCardFromLibrary(cardId) {
    const card = activeCards.find(c => c.id === cardId)
    if (!card) return
    const ok = window.confirm('Excluir este flashcard da biblioteca? Ele nao aparecera nas revisoes e nao voltara em novas importacoes.')
    if (!ok) return
    let updatedCard = null
    const nextLastAnsweredId = lastAnsweredId === cardId ? null : lastAnsweredId
    const nextCards = (latestCardsRef.current || cards).map(c => {
      if (c.id !== cardId) return c
      updatedCard = {
        ...c,
        deleted: true,
        deletedAt: new Date().toISOString(),
        manualEditedAt: new Date().toISOString()
      }
      return updatedCard
    })
    setCards(nextCards)
    persistLocalStateNow(nextCards, stats, { lastAnsweredId: nextLastAnsweredId, currentCardId: currentCardId === cardId ? '' : currentCardId })
    if (updatedCard) syncOneCard(updatedCard)
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
    const baseFront = stripHtml(v.htmlFront || v.pergunta || 'Pergunta')
    setSplitCardId(cardId)
    setSplitParts((parts.length ? parts : [v.resposta || '']).map((part, index) => ({
      front: `${baseFront} - parte ${index + 1}`,
      back: part
    })))
    setSplitSuspendOriginal(true)
  }

  function updateSplitPart(index, field, value) {
    setSplitParts(prev => prev.map((part, i) => {
      const normalized = typeof part === 'string' ? { front: '', back: part } : part
      return i === index ? { ...normalized, [field]: value } : normalized
    }))
  }

  function removeSplitPart(index) {
    setSplitParts(prev => prev.filter((_, i) => i !== index))
  }

  function createSplitCards() {
    const sourceCard = activeCards.find(c => c.id === splitCardId)
    if (!sourceCard) return
    const cleanParts = splitParts
      .map((part, idx) => {
        const normalized = typeof part === 'string' ? { front: '', back: part } : part
        return {
          front: String(normalized.front || '').trim() || `${stripHtml(getCardView(sourceCard).htmlFront || sourceCard.pergunta)} - parte ${idx + 1}`,
          back: String(normalized.back || '').trim()
        }
      })
      .filter(part => part.front && part.back)
    if (!cleanParts.length) {
      setImportLog('A quebra precisa ter pelo menos um card com pergunta e resposta preenchidas.')
      return
    }

    const now = Date.now()
    const created = cleanParts.map((part, idx) => {
      const front = part.front.replace(/\r?\n/g, '<br>')
      const back = part.back.replace(/\r?\n/g, '<br>')
      return {
        ...sourceCard,
        id: `split-${sourceCard.id}-${now}-${idx}`,
        importKey: `split-${sourceCard.id}-${now}-${idx}`,
        originalImportKey: `split-${sourceCard.id}-${now}-${idx}`,
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

    let updatedOriginal = null
    const nextCards = [
      ...(latestCardsRef.current || cards).map(card => {
        if (card.id !== sourceCard.id || !splitSuspendOriginal) return card
        updatedOriginal = {
          ...card,
          suspended: true,
          suspendedAt: new Date().toISOString(),
          manualEditedAt: new Date().toISOString()
        }
        return updatedOriginal
      }),
      ...created
    ]
    setCards(nextCards)
    persistLocalStateNow(nextCards, stats)
    syncCardsInChunks(updatedOriginal ? [updatedOriginal, ...created] : created, 'Cards quebrados')
    setSplitCardId(null)
    setSplitParts([])
    setImportLog(`${created.length} cards menores criados${splitSuspendOriginal ? ' e card original suspenso' : ''}.`)
  }

  function clearStudyFilter() {
    setFocusedCardIds([])
    setStudyTag('')
    setIndex(0)
    setCurrentCardId('')
    setAnswer('')
    setFeedback(null)
    setPendingGrade(null)
    setEditing(false)
    setLibraryEditingId(null)
  }

  function updateEditFront(value) {
    editFrontRef.current = value
    setEditFront(value)
  }

  function updateEditBack(value) {
    editBackRef.current = value
    setEditBack(value)
  }

  function ankiHash(value) {
    let hash = 2166136261
    String(value || '').split('').forEach(char => {
      hash ^= char.charCodeAt(0)
      hash = Math.imul(hash, 16777619)
    })
    return hash >>> 0
  }

  function ankiGuid(value, index) {
    return `mq${ankiHash(value).toString(36)}${Number(index || 0).toString(36)}`.slice(0, 20)
  }

  function sanitizeAnkiTags(value) {
    return String(value || '')
      .split(/\s+/)
      .map(tag => tag.trim().replace(/\s+/g, '_'))
      .filter(Boolean)
      .join(' ')
  }

  function ankiFieldHtml(value) {
    return richEditorInitialHtml(value)
      .replace(/\x00/g, '')
      .replace(/\x1f/g, ' ')
      .trim()
  }

  function dataUrlToBytes(dataUrl) {
    const match = String(dataUrl || '').match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/i)
    if (!match) return null
    const mime = match[1] || 'application/octet-stream'
    const isBase64 = Boolean(match[2])
    const payload = match[3] || ''
    if (isBase64) {
      const binary = atob(payload.replace(/\s/g, ''))
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
      return { mime, bytes }
    }
    return { mime, bytes: new TextEncoder().encode(decodeURIComponent(payload)) }
  }

  function extensionForMime(mime) {
    const clean = String(mime || '').toLowerCase()
    if (clean.includes('png')) return 'png'
    if (clean.includes('jpeg') || clean.includes('jpg')) return 'jpg'
    if (clean.includes('gif')) return 'gif'
    if (clean.includes('webp')) return 'webp'
    if (clean.includes('svg')) return 'svg'
    return 'bin'
  }

  function collectApkgMedia(html, mediaFiles) {
    return String(html || '').replace(/src=(["'])([^"']+)\1/gi, (match, quote, src) => {
      if (!/^data:/i.test(src)) return match
      const media = dataUrlToBytes(src)
      if (!media?.bytes?.length) return match
      const mediaIndex = mediaFiles.length
      const filename = `medquest-media-${mediaIndex}.${extensionForMime(media.mime)}`
      mediaFiles.push({ zipName: String(mediaIndex), filename, bytes: media.bytes })
      return `src="${filename}"`
    })
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  async function exportToAnki() {
    if (importBusy) return
    if (!activeCards.length) {
      setImportLog('Nao ha cards para exportar.')
      return
    }

    setImportBusy(true)
    setImportLog('Gerando APKG...')
    await new Promise(resolve => setTimeout(resolve, 0))

    try {
      const SQL = await initSqlJs({ locateFile: () => wasmUrl })
      const db = new SQL.Database()
      const nowSeconds = Math.floor(Date.now() / 1000)
      const nowMs = Date.now()
      const deckId = nowMs
      const modelId = nowMs + 1
      const mediaFiles = []
      const deckName = 'MedQuest'

      db.run(`
        CREATE TABLE col (
          id integer primary key,
          crt integer not null,
          mod integer not null,
          scm integer not null,
          ver integer not null,
          dty integer not null,
          usn integer not null,
          ls integer not null,
          conf text not null,
          models text not null,
          decks text not null,
          dconf text not null,
          tags text not null
        );
        CREATE TABLE notes (
          id integer primary key,
          guid text not null,
          mid integer not null,
          mod integer not null,
          usn integer not null,
          tags text not null,
          flds text not null,
          sfld integer not null,
          csum integer not null,
          flags integer not null,
          data text not null
        );
        CREATE TABLE cards (
          id integer primary key,
          nid integer not null,
          did integer not null,
          ord integer not null,
          mod integer not null,
          usn integer not null,
          type integer not null,
          queue integer not null,
          due integer not null,
          ivl integer not null,
          factor integer not null,
          reps integer not null,
          lapses integer not null,
          left integer not null,
          odue integer not null,
          odid integer not null,
          flags integer not null,
          data text not null
        );
        CREATE TABLE revlog (
          id integer primary key,
          cid integer not null,
          usn integer not null,
          ease integer not null,
          ivl integer not null,
          lastIvl integer not null,
          factor integer not null,
          time integer not null,
          type integer not null
        );
        CREATE TABLE graves (
          usn integer not null,
          oid integer not null,
          type integer not null
        );
        CREATE INDEX ix_notes_usn on notes (usn);
        CREATE INDEX ix_cards_usn on cards (usn);
        CREATE INDEX ix_revlog_usn on revlog (usn);
        CREATE INDEX ix_cards_nid on cards (nid);
        CREATE INDEX ix_cards_sched on cards (did, queue, due);
        CREATE INDEX ix_revlog_cid on revlog (cid);
        CREATE INDEX ix_notes_csum on notes (csum);
      `)

      const model = {
        id: modelId,
        name: 'MedQuest Basic',
        type: 0,
        mod: nowSeconds,
        usn: -1,
        sortf: 0,
        did: deckId,
        flds: [
          { name: 'Frente', ord: 0, sticky: false, rtl: false, font: 'Arial', size: 20, description: '', plainText: false, collapsed: false },
          { name: 'Verso', ord: 1, sticky: false, rtl: false, font: 'Arial', size: 20, description: '', plainText: false, collapsed: false }
        ],
        tmpls: [
          {
            name: 'Card 1',
            ord: 0,
            qfmt: '{{Frente}}',
            afmt: '{{FrontSide}}<hr id="answer">{{Verso}}',
            did: null,
            bqfmt: '',
            bafmt: ''
          }
        ],
        css: '.card { font-family: Arial; font-size: 20px; text-align: left; color: black; background: white; } img { max-width: 100%; height: auto; }',
        latexPre: '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n',
        latexPost: '\\end{document}',
        req: [[0, 'any', [0]]]
      }
      const deck = {
        id: deckId,
        name: deckName,
        mod: nowSeconds,
        usn: -1,
        lrnToday: [0, 0],
        revToday: [0, 0],
        newToday: [0, 0],
        timeToday: [0, 0],
        collapsed: false,
        browserCollapsed: false,
        desc: 'Exportado do MedQuest.',
        dyn: 0,
        extendNew: 0,
        extendRev: 0,
        conf: 1
      }
      const dconf = {
        1: {
          id: 1,
          mod: nowSeconds,
          name: 'Default',
          usn: -1,
          maxTaken: 60,
          autoplay: true,
          timer: 0,
          replayq: true,
          new: { bury: false, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 7], order: 1, perDay: 9999, separate: true },
          rev: { bury: false, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, perDay: 9999 },
          lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 },
          dyn: false,
          newMix: 0,
          newPerDayMinimum: 0,
          interdayLearningMix: 0,
          reviewOrder: 0
        }
      }
      const conf = {
        nextPos: activeCards.length + 1,
        estTimes: true,
        activeDecks: [deckId],
        sortType: 'noteFld',
        timeLim: 0,
        sortBackwards: false,
        addToCur: true,
        curDeck: deckId,
        curModel: modelId,
        newBury: true,
        newSpread: 0,
        dueCounts: true,
        collapseTime: 1200
      }

      db.run(
        'INSERT INTO col VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          1,
          nowSeconds,
          nowSeconds,
          nowMs,
          11,
          0,
          -1,
          0,
          JSON.stringify(conf),
          JSON.stringify({ [modelId]: model }),
          JSON.stringify({ [deckId]: deck }),
          JSON.stringify(dconf),
          '{}'
        ]
      )

      const noteInsert = db.prepare('INSERT INTO notes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      const cardInsert = db.prepare('INSERT INTO cards VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')

      activeCards.forEach((card, index) => {
        const view = getCardView(card)
        const noteId = nowMs + 1000 + index
        const cardId = nowMs + 100000 + index
        const rawFront = ankiFieldHtml(view.htmlFront || view.pergunta || card.pergunta || '')
        const rawBack = ankiFieldHtml(view.htmlBack || view.resposta || card.resposta || '')
        const frontHtml = collectApkgMedia(rawFront, mediaFiles)
        const backHtml = collectApkgMedia(rawBack, mediaFiles)
        const plainFront = stripHtml(frontHtml) || `Card ${index + 1}`
        const tags = sanitizeAnkiTags(view.tags || card.tags || '')
        const fields = `${frontHtml}\x1f${backHtml}`

        noteInsert.run([
          noteId,
          ankiGuid(`${plainFront}-${card.id || index}`, index),
          modelId,
          nowSeconds,
          -1,
          tags ? ` ${tags} ` : '',
          fields,
          plainFront,
          ankiHash(plainFront),
          0,
          ''
        ])

        cardInsert.run([
          cardId,
          noteId,
          deckId,
          0,
          nowSeconds,
          -1,
          0,
          0,
          index + 1,
          0,
          2500,
          0,
          0,
          0,
          0,
          0,
          0,
          ''
        ])
      })

      noteInsert.free()
      cardInsert.free()

      const zip = new JSZip()
      zip.file('collection.anki2', db.export())
      const mediaManifest = {}
      mediaFiles.forEach(file => {
        mediaManifest[file.zipName] = file.filename
        zip.file(file.zipName, file.bytes)
      })
      zip.file('media', JSON.stringify(mediaManifest))
      db.close()

      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
      downloadBlob(blob, `medquest-deck-${todayKey()}.apkg`)
      setImportLog(`${activeCards.length} cards exportados em APKG${mediaFiles.length ? ` com ${mediaFiles.length} midias` : ''}.`)
    } catch (err) {
      console.error(err)
      setImportLog(`Erro ao exportar APKG: ${err.message || String(err)}`)
    } finally {
      setImportBusy(false)
    }
  }

  function applyImportedDeck(imported, buildMessage) {
    const baseCards = latestCardsRef.current || cards
    const result = mergeImportedCards(baseCards, imported)
    setCards(result.merged)
    persistLocalStateNow(result.merged, stats)
    syncCardsInChunks(result.createdCards, 'Cards novos importados')
    if (sessionToken === FIREBASE_CLOUD_TOKEN) {
      window.setTimeout(() => {
        ensureFirebaseDeckComplete('Conferencia automatica apos importacao').catch(err => {
          console.warn('Conferencia automatica apos importacao falhou.', err)
        })
      }, 3000)
    }
    setIndex(0)
    setImportLog(buildMessage(result))
    return result
  }

  function importCSV(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const imported = parseCSV(String(reader.result || ''))
      if (imported.length) {
        applyImportedDeck(imported, result => `Importacao concluida: ${result.added} cards novos adicionados, ${result.ignoredExisting} cards antigos ignorados, ${result.preservedEdited} edicoes do site preservadas. Total no deck: ${result.merged.filter(card => !card.deleted).length}.`)
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

      applyImportedDeck(imported, result => `Importacao concluida: ${result.added} cards novos adicionados, ${result.ignoredExisting} cards antigos ignorados, ${result.preservedEdited} edicoes do site preservadas. Midias encontradas: ${Object.keys(mediaMap).length}. Total no deck: ${result.merged.filter(card => !card.deleted).length}.`)
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
          <img src="/medquest-logo.png" alt="MedQuest" className="login-logo" />
          <input value={login} onChange={e=>setLogin(e.target.value)} placeholder="Email" type="email" onKeyDown={e=> e.key === 'Enter' && cloudEnter()} />
          <input value={senha} onChange={e=>setSenha(e.target.value)} placeholder="Senha" type="password" onKeyDown={e=> e.key === 'Enter' && cloudEnter()} />
          <label className="remember-login">
            <input type="checkbox" checked={rememberLogin} onChange={e => setRememberLogin(e.target.checked)} />
            <span>Manter conectado neste dispositivo privado</span>
          </label>
          <button onClick={cloudEnter} disabled={authLoading}>{authLoading ? 'Entrando...' : 'Entrar'}</button>
          {feedback?.type === 'bad' && <div className="alert bad">{feedback.text}</div>}
          {feedback?.type === 'good' && <div className="alert good">{feedback.text}</div>}
        </section>
      </main>
    )
  }

  return (
    <main className={`app ${tab === 'study' ? 'study-mode' : ''}`}>
      <header className="top">
        <div className="brand">
          <img src="/medquest-logo.png" alt="MedQuest" className="brand-logo" />
        </div>
        <div className="profile">
          <div className="profile-copy">
            <span>{user?.email}</span>
            {syncStatus && <small>{syncStatus}</small>}
          </div>
          <button onClick={cloudLogout}><LogOut size={20}/> Sair</button>
        </div>
      </header>
      {importLog && (
        <div className={`import-status ${importLog.startsWith('Erro') || importLog.startsWith('Nao') ? 'bad' : 'good'}`}>
          <span>{importLog}</span>
          <button type="button" onClick={() => setImportLog('')} aria-label="Fechar aviso">×</button>
        </div>
      )}

      <nav className="tabs">
        <button className={tab==='study'?'active':''} onClick={() => { setFocusedCardIds([]); setIndex(0); setTab('study') }}><Brain size={18}/> Estudar</button>
        <button className={tab==='cards'?'active':''} onClick={()=>setTab('cards')}><Eye size={18}/> Ver flashcards</button>
        <button className={tab==='import'?'active':''} onClick={()=>setTab('import')}><Upload size={18}/> Importar</button>
        <button className={tab==='create'?'active':''} onClick={()=>setTab('create')}><Plus size={18}/> Criar card</button>
        <button className={tab==='stats'?'active':''} onClick={()=>setTab('stats')}><BarChart3 size={18}/> Estatísticas</button>
        <button className={tab==='settings'?'active':''} onClick={()=>setTab('settings')}><Settings size={18}/> Configurações</button>
      </nav>

      {tab !== 'study' && (
        statsPanel
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
                  setCurrentCardId('')
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
              {(currentStageBadge || currentExamBadges.length > 0) && (
                <div className="exam-badges" aria-label="Tags de prova">
                  <span className={`study-score-pill ${studyScorePulse ? 'pulse' : ''}`} title="Estudados hoje">
                    Hoje {todayDone} · I {todayNewCards} R {todayReviewCards}
                  </span>
                  {currentStageBadge && (
                    <span className={`study-stage-badge ${currentStageBadge.className}`}>{currentStageBadge.label}</span>
                  )}
                  {currentExamBadges.map(badge => (
                    <span className={`exam-badge exam-badge-${badge.key}`} key={badge.key}>{badge.label}</span>
                  ))}
                </div>
              )}
              <div className="card-top">
                <span className="card-count">Card vencido {currentQueueNumber} de {dueCards.length}</span>
                <span className={timeChallenge && !currentAlreadyAnswered ? `challenge-timer ${challengeLeft <= 10 ? 'urgent' : ''}` : 'timer-chip'}>
                  {timeChallenge && !currentAlreadyAnswered ? `${challengeLeft}s` : formatTime(cardSeconds)}
                </span>
                <button
                  className={`quick-toggle ${timeChallenge ? 'active' : ''}`}
                  type="button"
                  onClick={() => setTimeChallenge(value => !value)}
                  title={timeChallenge ? 'Desligar desafio de 30 segundos' : 'Ligar desafio de 30 segundos'}
                >
                  30s
                </button>
              </div>
              <HtmlContent className="question-html" html={currentView.htmlFront || currentView.pergunta} />
              <div className="study-workspace">
                <div className="study-main">
                  {editing && (
                    <div className="edit-box">
                      <h3>Editar card</h3>
                      <label>Frente/pergunta</label>
                      <RichTextEditor value={editFront} onChange={updateEditFront} />
                      <label>Resposta/gabarito</label>
                      <RichTextEditor value={editBack} onChange={updateEditBack} />
                      <div className="actions">
                        <button onClick={saveEdit}>Salvar edição</button>
                        <button className="secondary" onClick={() => { setEditing(false); setLibraryEditingId(null) }}>Cancelar</button>
                      </div>
                    </div>
                  )}

                  {!editing && (
                    <div className="answer-entry">
                      <details className="answer-tools">
                        <summary title="Ferramentas da resposta">Aa</summary>
                        <div className="answer-tool-popover">
                          <button className="secondary" onClick={() => insertAnswerSymbol('≥')} type="button" title="Ctrl + .">≥</button>
                          <button className="secondary" onClick={() => insertAnswerSymbol('≤')} type="button" title="Ctrl + ,">≤</button>
                        </div>
                      </details>
                      <textarea ref={answerRef} value={answer} onChange={e=>setAnswer(e.target.value)} onKeyDown={handleAnswerKeyDown} readOnly={currentAlreadyAnswered} placeholder="Digite sua resposta aqui..." />
                    </div>
                  )}
                  <div className="actions">
                    <button onClick={evaluate} disabled={currentAlreadyAnswered || editing} title="Ctrl + Enter"><CheckCircle2 size={18}/> Responder</button>
                    <button className="secondary" onClick={nextCard} title="Ctrl + Enter depois de responder">Próximo</button>
                    <button className="secondary" onClick={goToLastAnswered} disabled={!lastAnsweredId} title="Voltar ao último card respondido">Voltar último</button>
                    <button className="secondary" onClick={startEdit} title="Editar este card">Editar card</button>
                  </div>
                </div>
                <aside className={`answer-panel ${feedback && feedback.cardId === current.id ? `result ${feedback.type}` : ''}`}>
                  {shouldShowAnswerPanel ? (
                    <>
                      {feedback?.cardId === current.id && feedback.percent >= 80 ? (
                        <button className="result-dot result-dot-wrong" onClick={markCurrentAsWrong} title="Marcar como erro (Ctrl + ç)" aria-label="Marcar como erro" type="button" />
                      ) : feedback?.cardId === current.id ? (
                        <button className="result-dot result-dot-correct" onClick={markCurrentAsCorrect} title="Marcar como acerto (Ctrl + ~)" aria-label="Marcar como acerto" type="button" />
                      ) : null}
                      <div className="answer-box">
                        <HtmlContent html={currentAnswerPanelHtml} compactParagraphs />
                      </div>
                    </>
                  ) : (
                    <div className="answer-placeholder" />
                  )}
                </aside>
              </div>
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
          <div className="library-filter-row">
            <label>
              Tag
              <select value={libraryTagFilter} onChange={e => setLibraryTagFilter(e.target.value)}>
                <option value="">Todas as tags</option>
                {allTags.map(tag => <option key={tag} value={tag}>{tag}</option>)}
              </select>
            </label>
            <button
              type="button"
              className="secondary compact-button"
              onClick={() => {
                setSearchTerm('')
                setCardStageFilter('all')
                setLibraryTagFilter('')
                setLibrarySortMode('difficulty')
              }}
            >
              Limpar filtros
            </button>
          </div>
          <div className="stage-filter">
            {reviewCategoryOptions.map(option => (
              <button
                key={option.key}
                type="button"
                className={`${cardStageFilter === option.key ? 'active ' : ''}${option.className}`}
                onClick={() => setCardStageFilter(option.key)}
              >
                <span>{option.label}</span>
                <b>{reviewCategoryCounts[option.key] || 0}</b>
              </button>
            ))}
          </div>
          <div className="library-sort">
            <button
              type="button"
              className={librarySortMode === 'difficulty' ? 'active' : ''}
              onClick={() => setLibrarySortMode('difficulty')}
            >
              Mais repetidos
            </button>
            <button
              type="button"
              className={librarySortMode === 'recent' ? 'active' : ''}
              onClick={() => setLibrarySortMode('recent')}
            >
              Ultimos adicionados
            </button>
          </div>
          <p className="hint">
            {filteredCards.length} de {activeCards.length} flashcards encontrados. Mostrando {visibleFilteredCards.length}. Ordenacao: {librarySortMode === 'recent' ? 'ultimos adicionados' : 'mais repetidos'}. Suspensos: {suspendedCount}. Excluidos preservados: {deletedCount}.
          </p>
          <div className="grid-cards">
            {visibleFilteredCards.map((c, i) => {
              const v = getCardView(c)
              const stage = reviewStageDetails(v)
              const reviewSummary = reviewCountSummary(v, reviewMetricsByCard.get(v.id))
              const reps = reviewSummary.attempts
              return (
                <div className={`mini ${c.suspended ? 'suspended' : ''}`} key={c.id}>
                  <div className="library-card-top">
                    <span className={`review-stage-chip ${stage.className}`}>{stage.label}</span>
                    <span className="repeat-chip">{reps} repetições</span>
                    {c.suspended && <span className="status-chip">Suspenso</span>}
                  </div>
                  <b>{i+1}. {v.pergunta}</b>
                  {shouldShowLibraryFrontPreview(v) && (
                    <HtmlContent className="library-front-preview" html={v.htmlFront} />
                  )}
                  <p><b>Resposta:</b> {v.resposta}</p>
                  {libraryEditingId === c.id && editing && (
                    <div className="edit-box">
                      <h3>Editar flashcard</h3>
                      <label>Frente/pergunta</label>
                      <RichTextEditor value={editFront} onChange={updateEditFront} />
                      <label>Resposta/gabarito</label>
                      <RichTextEditor value={editBack} onChange={updateEditBack} />
                      <div className="actions">
                        <button onClick={saveEdit}>Salvar edição</button>
                        <button className="secondary" onClick={() => { setEditing(false); setLibraryEditingId(null) }}>Cancelar</button>
                      </div>
                    </div>
                  )}
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
                      <p className="hint">Revise as partes sugeridas antes de criar. Cada bloco vira um novo flashcard; você pode editar a pergunta e o gabarito de cada um.</p>
                      {splitParts.map((part, partIndex) => (
                        <div className="split-part" key={partIndex}>
                          <label>
                            Pergunta
                            <textarea value={typeof part === 'string' ? '' : part.front} onChange={e => updateSplitPart(partIndex, 'front', e.target.value)} />
                          </label>
                          <label>
                            Resposta
                            <textarea value={typeof part === 'string' ? part : part.back} onChange={e => updateSplitPart(partIndex, 'back', e.target.value)} />
                          </label>
                          <button className="secondary" onClick={() => removeSplitPart(partIndex)}>Remover</button>
                        </div>
                      ))}
                      <div className="actions">
                        <button className="secondary" onClick={() => setSplitParts(prev => [...prev, { front: '', back: '' }])}><Plus size={16}/> Adicionar parte</button>
                        <label><input type="checkbox" checked={splitSuspendOriginal} onChange={e => setSplitSuspendOriginal(e.target.checked)}/> Suspender card original</label>
                      </div>
                      <div className="actions">
                        <button onClick={createSplitCards}><Scissors size={16}/> Criar cards menores</button>
                        <button className="secondary" onClick={() => setSplitCardId(null)}>Cancelar</button>
                      </div>
                    </div>
                  )}
                  <div className="library-meta">
                    {v.isCloze && <span>Cloze</span>}
                    <span><b>Repetições:</b> {reps}</span>
                    <span><b>Acertos:</b> {reviewSummary.corrects}</span>
                    <span><b>Erros:</b> {reviewSummary.wrongs}</span>
                    <span><b>Categoria:</b> {stage.label}</span>
                    <span><b>Progresso:</b> {stage.progress}</span>
                    <span><b>Próxima revisão:</b> {hasScheduledDue(v) ? new Date(dueTimestamp(v)).toLocaleString('pt-BR') : 'inédito'}</span>
                  </div>
                </div>
              )
            })}
          </div>
          {visibleFilteredCards.length < filteredCards.length && (
            <button type="button" className="secondary load-more-button" onClick={() => setLibraryVisibleCount(count => count + 80)}>
              Mostrar mais {Math.min(80, filteredCards.length - visibleFilteredCards.length)}
            </button>
          )}
        </section>
      )}

      {tab === 'import' && (
        <section className="card">
          <h2>Importar deck</h2>
          <p className="hint">Use APKG para importar seu deck completo com imagens/mídias. CSV continua disponível como alternativa.</p>
          <div className="actions">
            <label className={`import ${importBusy ? 'disabled' : ''}`}>
              <Upload size={18}/> {importBusy ? 'Importando...' : 'Importar .APKG'}
              <input type="file" accept=".apkg" onChange={importAPKG} disabled={importBusy}/>
            </label>
            <label className={`import dark ${importBusy ? 'disabled' : ''}`}>
              <Upload size={18}/> Importar CSV
              <input type="file" accept=".csv,.txt" onChange={importCSV} disabled={importBusy}/>
            </label>
            <button className="secondary" onClick={exportToAnki} disabled={importBusy}><Download size={18}/> Exportar .APKG</button>
          </div>
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
            <label>Tags</label>
            <input list="existing-tags" value={newTags} onChange={e=>setNewTags(e.target.value)} placeholder="Ex.: cardio pediatria revisao" />
            <datalist id="existing-tags">
              {allTags.map(tag => <option value={tag} key={tag} />)}
            </datalist>
            <div className="actions">
              <button onClick={createCard}><Plus size={18}/> Criar card</button>
              <button className="secondary" onClick={()=>{setNewFront(''); setNewBack(''); setNewTags('')}}>Limpar</button>
            </div>
          </div>
        </section>
      )}

      {tab === 'stats' && (
        <section className="card daily-rhythm-card">
          <h2>Ritmo diario</h2>
          <div className="chart-box">
            <h4>Cards por dia</h4>
            <div className="bar-chart daily-mini-chart">
              {performanceDays.map(day => (
                <div className="chart-day" key={day.key}>
                  <b>{day.count || ''}</b>
                  <span style={{height: `${Math.max(3, (day.count / maxPerformanceCount) * 100)}%`}} className={day.count >= dailyTargetToFinish ? 'met' : ''} title={`${day.label}: ${day.count} cards`} />
                  <small>{day.label}</small>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {false && tab === 'stats' && (
        <section className="card">
          <h2>Progresso do estudo</h2>
          <div className="mastery-panel" hidden>
            <div className="mastery-head">
              <div>
                <span>Cards ainda frágeis</span>
                <b>{weakCount}</b>
                <small>{masteredCount} cards já chegaram em 80% ou mais.</small>
              </div>
              <strong>{masteredPercent}% fortes</strong>
            </div>
            <div className="mastery-track">
              <i style={{width: `${Math.min(100, masteredPercent)}%`}} />
            </div>
            <p className="hint">
              Nas últimas 50 respostas, você acertou {recentCorrectRate}% dos cards.
              {recentTrend != null && ` Isso é ${recentTrend >= 0 ? '+' : ''}${recentTrend} pontos vs. as 50 respostas anteriores.`}
            </p>
            <div className="mastery-breakdown">
              <div className="mastery-bad"><b>{weakCount}</b><span>Prioridade<br/>abaixo de 60%</span></div>
              <div className="mastery-mid"><b>{partialCount}</b><span>Quase lá<br/>60-79%</span></div>
              <div className="mastery-ok"><b>{masteredCount}</b><span>Fortes<br/>80-100%</span></div>
            </div>
          </div>

          <div className="progress-cards">
            <div>
              <span>Cards únicos nos últimos 7 dias</span>
              <b>{last7UniqueCount}</b>
              <small>{weeklyCountTrend >= 0 ? '+' : ''}{weeklyCountTrend} vs. 7 dias anteriores</small>
            </div>
            <div>
              <span>Dias estudados na semana</span>
              <b>{activeStudyDays}/7</b>
              <small>dias com pelo menos 1 card</small>
            </div>
            <div>
              <span>Acurácia recente</span>
              <b>{recentCorrectRate}%</b>
              <small>{recentHistory.length} respostas recentes</small>
            </div>
          </div>

          <h3>Gráficos de estudo</h3>
          <div className="chart-grid">
            <div className="chart-box">
              <h4>Cards por dia</h4>
              <div className="bar-chart">
                {performanceDays.map(day => (
                  <div className="chart-day" key={day.key}>
                    <b>{day.count || ''}</b>
                    <span style={{height: `${Math.max(3, (day.count / maxPerformanceCount) * 100)}%`}} className={day.count >= STREAK_MIN_CARDS ? 'met' : ''} title={`${day.label}: ${day.count} cards`} />
                    <small>{day.label}</small>
                  </div>
                ))}
              </div>
            </div>
            <div className="chart-box">
              <h4>Acurácia diária</h4>
              <div className="accuracy-chart">
                {performanceDays.slice().reverse().map(day => (
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
            <div className="advanced-box"><span>Exposição acumulada</span><b>{exposurePercent}%</b><small>100% = uma volta completa no deck</small></div>
            <div className="advanced-box"><span>Tempo médio</span><b>{formatTime(avgTime)}</b><small>Total: {formatTime(stats.totalAnswerSeconds)}</small></div>
            <div className="advanced-box"><span>Mais rápido</span><b>{stats.fastestSeconds == null ? '--' : formatTime(stats.fastestSeconds)}</b><small>Menor tempo</small></div>
            <div className="advanced-box"><span>Mais lento</span><b>{formatTime(stats.slowestSeconds)}</b><small>Maior tempo</small></div>
          </div>

        </section>
      )}

      {tab === 'settings' && (
        <section className="card">
          <h2>Escada de aprendizado</h2>
          <p className="hint">
            Fila ativa em proporcao 1 revisao para 1 inedito enquanto houver cards novos.
            Acertos sobem a escada: 10 min, 10 min, 1 dia, 3 dias, 7 dias, 15 dias, 30 dias e aprendido.
            Erros descem um degrau.
          </p>
          <div className="settings-grid">
            <label>Meta diária<input type="number" value={config.dailyGoal} onChange={e=>setConfig({...config, dailyGoal:Number(e.target.value)})}/></label>
            <label>Meta de inéditos/dia<input type="number" min="1" value={configuredNewDailyGoal(config)} onChange={e=>setConfig({...config, newDailyGoal:Number(e.target.value)})}/></label>
            <label>Data da meta<input type="date" value={config.targetDate || DEFAULT_CONFIG.targetDate} onChange={e=>setConfig({...config, targetDate:e.target.value || DEFAULT_CONFIG.targetDate})}/></label>
          </div>
        </section>
      )}
    </main>
  )
}

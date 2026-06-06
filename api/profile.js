const SUPABASE_URL = 'https://lgmfmdpzmqunouysuwjp.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_q0Kj-XQCbt89nVlQPdsG3A_pJPvVP-7'

function parseMaybeJson(text, fallback) {
  if (!text) return fallback
  try {
    return JSON.parse(text)
  } catch {
    return {
      message: text.includes('<!DOCTYPE')
        ? 'O Supabase respondeu uma pagina de erro em vez de JSON. Tente novamente em alguns segundos.'
        : text.slice(0, 240)
    }
  }
}

function bearerToken(req) {
  const authorization = req.headers.authorization || ''
  if (!authorization.toLowerCase().startsWith('bearer ')) return ''
  if (authorization.includes(SUPABASE_ANON_KEY)) return ''
  return authorization
}

async function authenticatedUser(req) {
  const authorization = bearerToken(req)
  if (!authorization) return { error: 'Login obrigatorio.' }

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      authorization,
      accept: 'application/json'
    }
  })
  const text = await response.text()
  const data = parseMaybeJson(text, null)
  if (!response.ok || !data?.id) return { error: 'Sessao invalida ou expirada.' }
  return { user: data, authorization }
}

function authHeaders(authorization) {
  return {
    apikey: SUPABASE_ANON_KEY,
    authorization,
    accept: 'application/json',
    'content-type': 'application/json'
  }
}

async function supabaseJson(path, authorization, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      ...authHeaders(authorization),
      ...(options.headers || {})
    }
  })
  const text = await response.text()
  return {
    ok: response.ok,
    status: response.status,
    data: parseMaybeJson(text, { ok: response.ok })
  }
}

function timestampScore(card = {}) {
  return Math.max(
    Date.parse(card.manualEditedAt || '') || 0,
    Date.parse(card.updatedAt || '') || 0,
    Date.parse(card.updated_at || '') || 0,
    Date.parse(card.importedAt || '') || 0,
    Number(card.lastReviewedAt || 0) || 0,
    Number(card.dueAt || 0) || 0
  )
}

function progressScore(card = {}) {
  return (
    Number(card.reviewAttempts || card.siteReps || card.reps || 0) * 1000 +
    Number(card.correctCount || 0) * 100 +
    Number(card.reviewWrong || 0) * 100 +
    Number(card.reviewLevel || 0)
  )
}

function mergeCard(existing = {}, incoming = {}) {
  const contentWinner = timestampScore(incoming) >= timestampScore(existing) ? incoming : existing
  const progressWinner = progressScore(incoming) >= progressScore(existing) ? incoming : existing
  return {
    ...existing,
    ...incoming,
    pergunta: contentWinner.pergunta || incoming.pergunta || existing.pergunta || '',
    resposta: contentWinner.resposta || incoming.resposta || existing.resposta || '',
    htmlFront: contentWinner.htmlFront || contentWinner.html_front || incoming.htmlFront || existing.htmlFront || '',
    htmlBack: contentWinner.htmlBack || contentWinner.html_back || incoming.htmlBack || existing.htmlBack || '',
    tags: contentWinner.tags || incoming.tags || existing.tags || '',
    manualEditedAt: contentWinner.manualEditedAt || incoming.manualEditedAt || existing.manualEditedAt,
    dueAt: progressWinner.dueAt ?? incoming.dueAt ?? existing.dueAt,
    reviewLevel: progressWinner.reviewLevel ?? incoming.reviewLevel ?? existing.reviewLevel,
    correctCount: progressWinner.correctCount ?? incoming.correctCount ?? existing.correctCount,
    reviewAttempts: progressWinner.reviewAttempts ?? progressWinner.siteReps ?? incoming.reviewAttempts ?? existing.reviewAttempts,
    siteReps: progressWinner.siteReps ?? progressWinner.reviewAttempts ?? incoming.siteReps ?? existing.siteReps,
    reviewCorrect: progressWinner.reviewCorrect ?? incoming.reviewCorrect ?? existing.reviewCorrect,
    reviewWrong: progressWinner.reviewWrong ?? incoming.reviewWrong ?? existing.reviewWrong
  }
}

function mergeCardLists(primaryCards = [], backupCards = []) {
  const byId = new Map()
  ;[...backupCards, ...primaryCards].filter(Boolean).forEach(card => {
    const id = String(card.id || card.card_id || '')
    if (!id) return
    byId.set(id, mergeCard(byId.get(id) || {}, card))
  })
  return [...byId.values()]
}

async function loadProfileData(userId, authorization) {
  const result = await supabaseJson(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=stats,email,cards`,
    authorization
  )
  if (!result.ok) return { stats: null, email: null, cards: [] }
  const row = Array.isArray(result.data) ? result.data[0] : result.data
  const legacyCards = Array.isArray(row?.cards) ? row.cards.filter(Boolean) : []
  return {
    stats: row?.stats && typeof row.stats === 'object' ? row.stats : null,
    email: row?.email || null,
    cards: legacyCards
  }
}

async function loadGranularCards(userId, authorization) {
  const pageSize = 1000
  const cards = []

  for (let offset = 0; offset < 10000; offset += pageSize) {
    const result = await supabaseJson(
      `/rest/v1/mq_cards?user_id=eq.${encodeURIComponent(userId)}&deleted=eq.false&select=payload&order=updated_at.asc`,
      authorization,
      { headers: { Range: `${offset}-${offset + pageSize - 1}` } }
    )

    if (!result.ok) {
      return { ok: false, cards: [], detail: result.data }
    }

    const rows = Array.isArray(result.data) ? result.data : []
    cards.push(...rows.map(row => row?.payload).filter(Boolean))
    if (rows.length < pageSize) break
  }

  return { ok: true, cards }
}

export default async function handler(req, res) {
  try {
    const auth = await authenticatedUser(req)
    if (auth.error) {
      res.status(401).json({ message: auth.error })
      return
    }

    if (req.method === 'GET') {
      const id = String(req.query.id || auth.user.id)
      if (id !== auth.user.id) {
        res.status(403).json({ message: 'Acesso negado.' })
        return
      }

      const [profile, granular] = await Promise.all([
        loadProfileData(id, auth.authorization),
        loadGranularCards(id, auth.authorization)
      ])
      const legacyCards = Array.isArray(profile.cards) ? profile.cards : []
      const granularCards = granular.ok ? granular.cards : []
      const mergedCards = mergeCardLists(granularCards, legacyCards)
      const useLegacyBackup = legacyCards.length > granularCards.length

      res.status(200).json({
        cards: mergedCards,
        stats: profile.stats,
        granularReady: granular.ok,
        granularDetail: granular.ok ? null : granular.detail,
        migrationNeeded: granular.ok && (useLegacyBackup || mergedCards.length > granularCards.length),
        legacyCardCount: legacyCards.length,
        granularCardCount: granularCards.length,
        mergedCardCount: mergedCards.length
      })
      return
    }

    if (req.method === 'POST') {
      const { id, email, stats, cards } = req.body || {}
      if (id !== auth.user.id) {
        res.status(403).json({ message: 'Acesso negado.' })
        return
      }

      const profilePayload = { id, email }
      if (stats && typeof stats === 'object') profilePayload.stats = stats
      if (Array.isArray(cards)) profilePayload.cards = cards.filter(Boolean)

      const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles?on_conflict=id`, {
        method: 'POST',
        headers: {
          ...authHeaders(auth.authorization),
          Prefer: 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify(profilePayload)
      })
      const text = await response.text()
      res.status(response.status).json(parseMaybeJson(text, { ok: response.ok }))
      return
    }

    res.status(405).json({ message: 'Method not allowed' })
  } catch (err) {
    res.status(500).json({ message: err.message || 'Erro ao conectar ao Supabase.' })
  }
}

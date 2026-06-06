const SUPABASE_URL = 'https://lgmfmdpzmqunouysuwjp.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_q0Kj-XQCbt89nVlQPdsG3A_pJPvVP-7'

function parseMaybeJson(text, fallback) {
  if (!text) return fallback
  try {
    return JSON.parse(text)
  } catch {
    return { message: text.slice(0, 240) }
  }
}

function safeIsoDate(value) {
  if (!value) return null
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString()
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return null
  return new Date(time).toISOString()
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

function cardProgressScore(card = {}) {
  return (
    Number(card.reviewAttempts || card.siteReps || card.reps || 0) * 1000 +
    Number(card.correctCount || 0) * 100 +
    Number(card.reviewWrong || 0) * 100 +
    Number(card.reviewLevel || 0)
  )
}

function mergeCard(existing = {}, incoming = {}) {
  const contentWinner = timestampScore(incoming) >= timestampScore(existing) ? incoming : existing
  const progressWinner = cardProgressScore(incoming) >= cardProgressScore(existing) ? incoming : existing
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
    reviewWrong: progressWinner.reviewWrong ?? incoming.reviewWrong ?? existing.reviewWrong,
    updatedAt: incoming.updatedAt || new Date().toISOString()
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

function headers(authorization) {
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
      ...headers(authorization),
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

async function saveCardToProfileBackup(user, authorization, card) {
  const profile = await supabaseJson(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=cards,email`,
    authorization
  )
  const row = Array.isArray(profile.data) ? profile.data[0] : profile.data
  const cards = Array.isArray(row?.cards) ? row.cards.filter(Boolean) : []
  const byId = new Map(cards.map(item => [String(item.id || item.card_id || ''), item]))
  const id = String(card.id)
  byId.set(id, mergeCard(byId.get(id) || {}, card))

  const payload = {
    id: user.id,
    email: row?.email || user.email,
    cards: [...byId.values()]
  }

  return supabaseJson('/rest/v1/profiles?on_conflict=id', authorization, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(payload)
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' })
    return
  }

  try {
    const auth = await authenticatedUser(req)
    if (auth.error) {
      res.status(401).json({ message: auth.error })
      return
    }

    const { userId, card, event } = req.body || {}
    if (!userId || !card?.id) {
      res.status(400).json({ message: 'userId e card.id sao obrigatorios.' })
      return
    }
    if (userId !== auth.user.id) {
      res.status(403).json({ message: 'Acesso negado.' })
      return
    }

    const cardPayload = {
      user_id: userId,
      card_id: card.id,
      pergunta: card.pergunta || '',
      resposta: card.resposta || '',
      html_front: card.htmlFront || '',
      html_back: card.htmlBack || '',
      tags: card.tags || '',
      due_at: safeIsoDate(card.dueAt),
      review_level: Number(card.reviewLevel || 0),
      correct_count: Number(card.correctCount || 0),
      site_reps: Number(card.siteReps || card.reviewAttempts || 0),
      review_correct: Number(card.reviewCorrect || 0),
      review_wrong: Number(card.reviewWrong || 0),
      suspended: !!card.suspended,
      deleted: !!card.deleted,
      payload: card,
      updated_at: new Date().toISOString()
    }

    const cardResult = await supabaseJson('/rest/v1/mq_cards?on_conflict=user_id,card_id', auth.authorization, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(cardPayload)
    })

    if (!cardResult.ok) {
      const backupResult = await saveCardToProfileBackup(auth.user, auth.authorization, card)
      if (!backupResult.ok) {
        res.status(202).json({ ok: false, fallback: 'local', message: 'Falha ao salvar no banco granular e no backup.', detail: { granular: cardResult.data, backup: backupResult.data } })
        return
      }
      res.status(200).json({ ok: true, fallback: 'profile-json', message: 'Salvo no backup da nuvem.' })
      return
    }

    if (event) {
      const eventPayload = {
        user_id: userId,
        card_id: card.id,
        grade: event.grade || '',
        percent: Number(event.percent || 0),
        correct: !!event.correct,
        seconds: Number(event.seconds || 0),
        answered_at: event.answeredAt || new Date().toISOString(),
        payload: event
      }

      const eventResult = await supabaseJson('/rest/v1/mq_review_events', auth.authorization, {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(eventPayload)
      })
      if (!eventResult.ok) {
        res.status(200).json({ ok: true, eventFallback: true, detail: eventResult.data })
        return
      }
    }

    res.status(200).json({ ok: true })
  } catch (err) {
    try {
      const auth = await authenticatedUser(req)
      const { card } = req.body || {}
      if (!auth.error && card?.id) {
        const backupResult = await saveCardToProfileBackup(auth.user, auth.authorization, card)
        if (backupResult.ok) {
          res.status(200).json({ ok: true, fallback: 'profile-json', message: 'Salvo no backup da nuvem.' })
          return
        }
      }
    } catch {
      // Fall through to local fallback response.
    }
    res.status(202).json({ ok: false, fallback: 'local', message: err.message || 'Falha ao sincronizar revisao.' })
  }
}

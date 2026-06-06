const SUPABASE_URL = 'https://lgmfmdpzmqunouysuwjp.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_q0Kj-XQCbt89nVlQPdsG3A_pJPvVP-7'

function parseMaybeJson(text, fallback) {
  if (!text) return fallback
  try {
    return JSON.parse(text)
  } catch {
    return {
      message: text.includes('<!DOCTYPE')
        ? 'O Supabase respondeu uma pagina de erro em vez de JSON.'
        : text.slice(0, 240)
    }
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

function mergeCard(existing = {}, incoming = {}) {
  const contentWinner = timestampScore(incoming) >= timestampScore(existing) ? incoming : existing
  return {
    ...existing,
    ...incoming,
    pergunta: contentWinner.pergunta || incoming.pergunta || existing.pergunta || '',
    resposta: contentWinner.resposta || incoming.resposta || existing.resposta || '',
    htmlFront: contentWinner.htmlFront || contentWinner.html_front || incoming.htmlFront || existing.htmlFront || '',
    htmlBack: contentWinner.htmlBack || contentWinner.html_back || incoming.htmlBack || existing.htmlBack || '',
    tags: contentWinner.tags || incoming.tags || existing.tags || '',
    manualEditedAt: contentWinner.manualEditedAt || incoming.manualEditedAt || existing.manualEditedAt,
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

function cardPayload(userId, card) {
  const htmlFront = card.htmlFront || card.html_front || ''
  const htmlBack = card.htmlBack || card.html_back || ''
  return {
    user_id: userId,
    card_id: String(card.id),
    pergunta: card.pergunta || '',
    resposta: card.resposta || '',
    html_front: htmlFront,
    html_back: htmlBack,
    tags: card.tags || '',
    due_at: safeIsoDate(card.dueAt),
    review_level: Number(card.reviewLevel || 0),
    correct_count: Number(card.correctCount || 0),
    site_reps: Number(card.siteReps || card.reviewAttempts || 0),
    review_correct: Number(card.reviewCorrect || 0),
    review_wrong: Number(card.reviewWrong || 0),
    suspended: !!card.suspended,
    deleted: !!card.deleted,
    payload: { ...card, htmlFront, htmlBack },
    updated_at: new Date().toISOString()
  }
}

async function saveCardsToProfileBackup(user, authorization, cards) {
  const profile = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=cards,email`, {
    headers: headers(authorization)
  })
  const profileText = await profile.text()
  const profileData = parseMaybeJson(profileText, [])
  const row = Array.isArray(profileData) ? profileData[0] : profileData
  const existingCards = Array.isArray(row?.cards) ? row.cards.filter(Boolean) : []
  const byId = new Map(existingCards.map(item => [String(item.id || item.card_id || ''), item]))

  cards.filter(card => card?.id).forEach(card => {
    const id = String(card.id)
    byId.set(id, mergeCard(byId.get(id) || {}, card))
  })

  const payload = {
    id: user.id,
    email: row?.email || user.email,
    cards: [...byId.values()]
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles?on_conflict=id`, {
    method: 'POST',
    headers: {
      ...headers(authorization),
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(payload)
  })
  const text = await response.text()
  return { ok: response.ok, status: response.status, data: parseMaybeJson(text, { ok: response.ok }) }
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

    const { userId, cards } = req.body || {}
    if (userId !== auth.user.id) {
      res.status(403).json({ message: 'Acesso negado.' })
      return
    }
    if (!Array.isArray(cards) || !cards.length) {
      res.status(200).json({ ok: true, synced: 0 })
      return
    }
    if (cards.length > 150) {
      res.status(413).json({ message: 'Envie no maximo 150 cards por lote.' })
      return
    }

    const payload = cards
      .filter(card => card?.id)
      .map(card => cardPayload(userId, card))

    const response = await fetch(`${SUPABASE_URL}/rest/v1/mq_cards?on_conflict=user_id,card_id`, {
      method: 'POST',
      headers: {
        ...headers(auth.authorization),
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(payload)
    })

    const text = await response.text()
    if (!response.ok) {
      const backupResult = await saveCardsToProfileBackup(auth.user, auth.authorization, cards)
      if (backupResult.ok) {
        res.status(200).json({ ok: true, synced: payload.length, fallback: 'profile-json', message: 'Cards salvos no backup da nuvem.' })
        return
      }
      res.status(response.status).json(parseMaybeJson(text, { message: 'Falha ao salvar cards.', backup: backupResult.data }))
      return
    }

    res.status(200).json({ ok: true, synced: payload.length })
  } catch (err) {
    try {
      const auth = await authenticatedUser(req)
      const { cards } = req.body || {}
      if (!auth.error && Array.isArray(cards) && cards.length) {
        const backupResult = await saveCardsToProfileBackup(auth.user, auth.authorization, cards)
        if (backupResult.ok) {
          res.status(200).json({ ok: true, synced: cards.length, fallback: 'profile-json', message: 'Cards salvos no backup da nuvem.' })
          return
        }
      }
    } catch {
      // Fall through to error response.
    }
    res.status(500).json({ message: err.message || 'Falha ao salvar cards.' })
  }
}

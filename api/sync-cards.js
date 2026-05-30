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
  return {
    user_id: userId,
    card_id: String(card.id),
    pergunta: card.pergunta || '',
    resposta: card.resposta || '',
    html_front: card.htmlFront || '',
    html_back: card.htmlBack || '',
    tags: card.tags || '',
    due_at: card.dueAt ? new Date(card.dueAt).toISOString() : null,
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
      res.status(response.status).json(parseMaybeJson(text, { message: 'Falha ao salvar cards.' }))
      return
    }

    res.status(200).json({ ok: true, synced: payload.length })
  } catch (err) {
    res.status(500).json({ message: err.message || 'Falha ao salvar cards.' })
  }
}

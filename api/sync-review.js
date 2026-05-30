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

function headers(req) {
  return {
    apikey: SUPABASE_ANON_KEY,
    authorization: req.headers.authorization || `Bearer ${SUPABASE_ANON_KEY}`,
    accept: 'application/json',
    'content-type': 'application/json'
  }
}

async function supabaseJson(path, req, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      ...headers(req),
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' })
    return
  }

  try {
    const { userId, card, event } = req.body || {}
    if (!userId || !card?.id) {
      res.status(400).json({ message: 'userId e card.id sao obrigatorios.' })
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

    const cardResult = await supabaseJson('/rest/v1/mq_cards?on_conflict=user_id,card_id', req, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(cardPayload)
    })

    if (!cardResult.ok) {
      res.status(202).json({ ok: false, fallback: 'profile-json', detail: cardResult.data })
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

      await supabaseJson('/rest/v1/mq_review_events', req, {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(eventPayload)
      })
    }

    res.status(200).json({ ok: true })
  } catch (err) {
    res.status(202).json({ ok: false, fallback: 'local', message: err.message || 'Falha ao sincronizar revisao.' })
  }
}

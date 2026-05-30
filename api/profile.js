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

function authHeaders(req) {
  const authorization = req.headers.authorization || ''
  return {
    apikey: SUPABASE_ANON_KEY,
    authorization: authorization || `Bearer ${SUPABASE_ANON_KEY}`,
    accept: 'application/json',
    'content-type': 'application/json'
  }
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const id = String(req.query.id || '')
      if (!id) {
        res.status(400).json({ message: 'ID obrigatorio.' })
        return
      }

      const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=cards,stats`, {
        headers: authHeaders(req)
      })
      const text = await response.text()
      const data = parseMaybeJson(text, [])
      res.status(response.status).json(Array.isArray(data) ? data[0] || null : data)
      return
    }

    if (req.method === 'POST') {
      const { id, email, cards, stats } = req.body || {}
      if (!id) {
        res.status(400).json({ message: 'ID obrigatorio.' })
        return
      }

      const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles?on_conflict=id`, {
        method: 'POST',
        headers: {
          ...authHeaders(req),
          Prefer: 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify({ id, email, cards, stats })
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

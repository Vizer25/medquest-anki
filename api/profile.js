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

      const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=cards,stats`, {
        headers: authHeaders(auth.authorization)
      })
      const text = await response.text()
      const data = parseMaybeJson(text, [])
      res.status(response.status).json(Array.isArray(data) ? data[0] || null : data)
      return
    }

    if (req.method === 'POST') {
      const { id, email, cards, stats } = req.body || {}
      if (id !== auth.user.id) {
        res.status(403).json({ message: 'Acesso negado.' })
        return
      }

      const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles?on_conflict=id`, {
        method: 'POST',
        headers: {
          ...authHeaders(auth.authorization),
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

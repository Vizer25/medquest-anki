const SUPABASE_URL = 'https://lgmfmdpzmqunouysuwjp.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_q0Kj-XQCbt89nVlQPdsG3A_pJPvVP-7'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' })
    return
  }

  try {
    const { email, password } = req.body || {}
    if (!email || !password) {
      res.status(400).json({ message: 'Email e senha sao obrigatorios.' })
      return
    }

    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    })

    const text = await response.text()
    const data = text ? JSON.parse(text) : {}
    res.status(response.status).json(data)
  } catch (err) {
    res.status(500).json({ message: err.message || 'Erro ao conectar ao Supabase.' })
  }
}

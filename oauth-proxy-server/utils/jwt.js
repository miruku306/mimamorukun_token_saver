const jwt = require('jsonwebtoken')

const JWT_SECRET = process.env.JWT_SECRET

// セッショントークンを発行
function issueToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' })
}

// セッショントークンを検証
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET)
  } catch {
    return null
  }
}

// 認証ミドルウェア
function requireAuth(req, res, next) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未認証です' })
  }

  const token = auth.slice(7)
  const payload = verifyToken(token)
  if (!payload) {
    return res.status(401).json({ error: 'トークンが無効または期限切れです' })
  }

  req.userId = payload.userId
  next()
}

module.exports = { issueToken, verifyToken, requireAuth }
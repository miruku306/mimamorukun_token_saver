require('dotenv').config()
const express = require('express')
const cors = require('cors')
const rateLimit = require('express-rate-limit')
const { initDB } = require('./utils/db')
const authRouter = require('./routes/auth')

const app = express()
const PORT = process.env.PORT || 3000

// ─── ミドルウェア ──────────────────────────────────────
app.use(cors({
  origin: ['http://localhost', 'http://127.0.0.1'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))
app.use(express.json())

// レートリミット（1IPあたり15分で100リクエストまで）
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'リクエストが多すぎます。しばらく待ってから再試行してください。' }
})
app.use(limiter)

// ─── ルーティング ──────────────────────────────────────
app.use('/auth', authRouter)

// ヘルスチェック
app.get('/health', (req, res) => {
  res.json({ ok: true })
})

// ─── 起動 ──────────────────────────────────────────────
async function start() {
  try {
    await initDB()
    app.listen(PORT, () => {
      console.log(`[server] 起動完了: port ${PORT}`)
    })
  } catch (e) {
    console.error('[server] 起動失敗:', e)
    process.exit(1)
  }
}

start()
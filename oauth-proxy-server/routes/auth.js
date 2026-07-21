const express = require('express')
const router = express.Router()
const { upsertGithubUser, upsertDiscordUser, getUserById } = require('../utils/db')
const { issueToken, requireAuth, verifyToken } = require('../utils/jwt')

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET

// ─── GitHub認証 ───────────────────────────────────────
// ElectronからcodeとredirectUriを受け取り、セッショントークンを返す
router.post('/github', async (req, res) => {
  try {
    const { code, redirectUri } = req.body
    if (!code || !redirectUri) {
      return res.status(400).json({ error: 'codeとredirectUriが必要です' })
    }

   const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    client_secret: DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri
  })
})

const tokenData = await tokenRes.json()
console.log('[discord] tokenData:', JSON.stringify(tokenData))
console.log('[discord] redirectUri:', redirectUri)
console.log('[discord] client_id:', DISCORD_CLIENT_ID)

if (!tokenData.access_token) {
  return res.status(400).json({ error: 'Discordトークン取得失敗' })
}

    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    })
    const user = await userRes.json()

    const dbUser = await upsertGithubUser(String(user.id), user.login)
    const sessionToken = issueToken(dbUser.id)

    res.json({
      sessionToken,
      user: { id: dbUser.id, username: user.login }
    })
  } catch (e) {
    console.error('[auth/github]', e)
    res.status(500).json({ error: 'サーバーエラー' })
  }
})

// ─── GitHubデバイスフロー認証 ──────────────────────────
// ElectronからアクセストークンをそのままもらってJWTを発行する
router.post('/github/device', async (req, res) => {
  try {
    const { accessToken } = req.body
    if (!accessToken) {
      return res.status(400).json({ error: 'accessTokenが必要です' })
    }

    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    const user = await userRes.json()

    if (!user.id) {
      return res.status(400).json({ error: '無効なアクセストークンです' })
    }

    const dbUser = await upsertGithubUser(String(user.id), user.login)
    const sessionToken = issueToken(dbUser.id)

    res.json({
      sessionToken,
      user: { id: dbUser.id, username: user.login }
    })
  } catch (e) {
    console.error('[auth/github/device]', e)
    res.status(500).json({ error: 'サーバーエラー' })
  }
})

// ─── Discord認証 ──────────────────────────────────────
// ElectronからcodeとredirectUriを受け取り、セッショントークンを返す
router.post('/discord', async (req, res) => {
  try {
    const { code, redirectUri, sessionToken } = req.body
    if (!code || !redirectUri) {
      return res.status(400).json({ error: 'codeとredirectUriが必要です' })
    }

    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri
      })
    })

    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) {
      return res.status(400).json({ error: 'Discordトークン取得失敗' })
    }

    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    })
    const discordUser = await userRes.json()

    // 既存のGitHubセッションがあればDiscordを紐付け
    if (sessionToken) {
      const payload = verifyToken(sessionToken)
      if (payload) {
        await upsertDiscordUser(payload.userId, discordUser.id, discordUser.username)
        return res.json({
          sessionToken,
          discordAccessToken: tokenData.access_token,
          user: { id: discordUser.id, username: discordUser.username }
        })
      }
    }
  


    res.json({
      discordAccessToken: tokenData.access_token,
      user: { id: discordUser.id, username: discordUser.username }
    })
  } catch (e) {
    console.error('[auth/discord]', e)
    res.status(500).json({ error: 'サーバーエラー' })
  }
})

// ─── ユーザー情報取得 ──────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await getUserById(req.userId)
    if (!user) return res.status(404).json({ error: 'ユーザーが見つかりません' })
    res.json({ user })
  } catch (e) {
    console.error('[auth/me]', e)
    res.status(500).json({ error: 'サーバーエラー' })
  }
})

module.exports = router
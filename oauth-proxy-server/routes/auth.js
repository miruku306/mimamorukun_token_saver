const express = require('express')
const router = express.Router()
const { upsertGithubUser, upsertDiscordUser, getUserById } = require('../utils/db')
const { issueToken, requireAuth } = require('../utils/jwt')

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

    // codeをアクセストークンに交換
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri
      })
    })

    const tokenData = await tokenRes.json()
    if (tokenData.error) {
      return res.status(400).json({ error: tokenData.error_description })
    }

    // ユーザー情報を取得
    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    })
    const user = await userRes.json()

    // DBに保存
    const dbUser = await upsertGithubUser(String(user.id), user.login)

    // セッショントークンを発行
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

// ─── Discord認証 ──────────────────────────────────────
// ElectronからcodeとredirectUriを受け取り、セッショントークンを返す
router.post('/discord', async (req, res) => {
  try {
    const { code, redirectUri, sessionToken } = req.body
    if (!code || !redirectUri) {
      return res.status(400).json({ error: 'codeとredirectUriが必要です' })
    }

    // codeをアクセストークンに交換
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

    // ユーザー情報を取得
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    })
    const discordUser = await userRes.json()

    // 既存のGitHubセッションがあればDiscordを紐付け
    if (sessionToken) {
      const { requireAuth: _, verifyToken } = require('../utils/jwt')
      const { verifyToken: verify } = require('../utils/jwt')
      const payload = verify(sessionToken)
      if (payload) {
        await upsertDiscordUser(payload.userId, discordUser.id, discordUser.username)
        return res.json({
          sessionToken,
          user: { discordId: discordUser.id, username: discordUser.username }
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
const express = require('express')
const router = express.Router()
const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

// ─── Botが収集済みのサーバー一覧 ──────────────────────
router.get('/servers', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT guild_id, guild_name, COUNT(*) AS message_count
      FROM messages
      GROUP BY guild_id, guild_name
      ORDER BY message_count DESC
    `)
    res.json(result.rows.map((r) => ({ ...r, message_count: Number(r.message_count) })))
  } catch (e) {
    console.error('[discord/servers]', e)
    res.status(500).json({ error: 'サーバーエラー' })
  }
})

// ─── Discord設定を取得 ─────────────────────────────────
router.get('/settings/:repoFullName', async (req, res) => {
  try {
    const repoFullName = decodeURIComponent(req.params.repoFullName)
    const result = await pool.query(
      `SELECT guild_id, guild_name, bot_registered
       FROM discord_settings
       WHERE repo_full_name = $1
       ORDER BY registered_at DESC
       LIMIT 1`,
      [repoFullName]
    )
    res.json(result.rows[0] || null)
  } catch (e) {
    console.error('[discord/settings]', e)
    res.status(500).json({ error: 'サーバーエラー' })
  }
})

// ─── Discord設定を保存 ─────────────────────────────────
router.post('/settings', async (req, res) => {
  try {
    const { repoFullName, guildId, guildName } = req.body
    await pool.query(
      `INSERT INTO discord_settings (repo_full_name, guild_id, guild_name, bot_registered)
       VALUES ($1, $2, $3, false)
       ON CONFLICT (repo_full_name, guild_id) DO UPDATE SET guild_name = $3`,
      [repoFullName, guildId, guildName]
    )
    res.json({ ok: true })
  } catch (e) {
    console.error('[discord/settings POST]', e)
    res.status(500).json({ error: 'サーバーエラー' })
  }
})

// ─── Bot登録フラグを更新 ───────────────────────────────
router.post('/settings/bot-registered', async (req, res) => {
  try {
    const { repoFullName, guildId } = req.body
    await pool.query(
      'UPDATE discord_settings SET bot_registered = true WHERE repo_full_name = $1 AND guild_id = $2',
      [repoFullName, guildId]
    )
    res.json({ ok: true })
  } catch (e) {
    console.error('[discord/bot-registered]', e)
    res.status(500).json({ error: 'サーバーエラー' })
  }
})

// ─── Discordユーザー一覧を取得 ─────────────────────────
router.get('/users/:guildId', async (req, res) => {
  try {
    const { guildId } = req.params
    const result = await pool.query(
      `SELECT author_id, author_name, COUNT(*) AS message_count
       FROM messages
       WHERE guild_id = $1
       GROUP BY author_id, author_name
       ORDER BY message_count DESC`,
      [guildId]
    )
    res.json(result.rows.map((r) => ({ ...r, message_count: Number(r.message_count) })))
  } catch (e) {
    console.error('[discord/users]', e)
    res.status(500).json({ error: 'サーバーエラー' })
  }
})

// ─── アカウント紐付けを取得 ───────────────────────────
router.get('/account-links/:repoFullName', async (req, res) => {
  try {
    const repoFullName = decodeURIComponent(req.params.repoFullName)
    const result = await pool.query(
      'SELECT github_username, discord_user_id, discord_user_name FROM account_links WHERE repo_full_name = $1',
      [repoFullName]
    )
    res.json(result.rows)
  } catch (e) {
    console.error('[discord/account-links]', e)
    res.status(500).json({ error: 'サーバーエラー' })
  }
})

// ─── アカウント紐付けを保存 ───────────────────────────
router.post('/account-links', async (req, res) => {
  try {
    const { githubUsername, discordUserId, discordUserName, repoFullName } = req.body
    await pool.query(
      `INSERT INTO account_links (github_username, discord_user_id, discord_user_name, repo_full_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (github_username, repo_full_name) DO UPDATE
         SET discord_user_id = $2, discord_user_name = $3, linked_at = NOW()`,
      [githubUsername, discordUserId, discordUserName, repoFullName]
    )
    res.json({ ok: true })
  } catch (e) {
    console.error('[discord/account-links POST]', e)
    res.status(500).json({ error: 'サーバーエラー' })
  }
})

// ─── GitHubユーザーを登録 ─────────────────────────────
router.post('/github-users', async (req, res) => {
  try {
    const { repoFullName, githubUsernames } = req.body
    for (const username of githubUsernames) {
      await pool.query(
        `INSERT INTO account_links (github_username, repo_full_name)
         VALUES ($1, $2)
         ON CONFLICT (github_username, repo_full_name) DO NOTHING`,
        [username, repoFullName]
      )
    }
    res.json({ ok: true })
  } catch (e) {
    console.error('[discord/github-users]', e)
    res.status(500).json({ error: 'サーバーエラー' })
  }
})

// ─── Discordスコアを算出 ──────────────────────────────
router.get('/scores/:guildId', async (req, res) => {
  try {
    const { guildId } = req.params
    const result = await pool.query(
      `
      SELECT
        author_id,
        MAX(author_name) AS author_name,
        COUNT(*) AS message_count,
        COUNT(DISTINCT channel_id) AS channel_count,
        COUNT(DISTINCT DATE(message_created_at)) AS active_days,
        COUNT(*) FILTER (WHERE reply_to IS NOT NULL) AS reply_count,
        COALESCE(
          AVG(LEAST(LENGTH(content), 200))
            FILTER (WHERE content IS NOT NULL AND content <> 'EMPTY' AND LENGTH(TRIM(content)) > 0),
          0
        ) AS avg_content_length
      FROM messages
      WHERE guild_id = $1
      GROUP BY author_id
      `,
      [guildId]
    )

    const WEIGHTS = {
      messageCount: 0.3,
      activeDays: 0.25,
      channelCount: 0.15,
      replyCount: 0.15,
      avgContentLength: 0.15
    }

    const scored = result.rows.map((r) => {
      const messageCount = Number(r.message_count)
      const activeDays = Number(r.active_days)
      const channelCount = Number(r.channel_count)
      const replyCount = Number(r.reply_count)
      const avgContentLength = Number(r.avg_content_length)

      const score =
        Math.log(messageCount + 1) * WEIGHTS.messageCount +
        Math.log(activeDays + 1) * WEIGHTS.activeDays +
        Math.log(channelCount + 1) * WEIGHTS.channelCount +
        Math.log(replyCount + 1) * WEIGHTS.replyCount +
        Math.log(avgContentLength + 1) * WEIGHTS.avgContentLength

      return {
        author_id: r.author_id,
        author_name: r.author_name,
        score,
        breakdown: { messageCount, activeDays, channelCount, replyCount, avgContentLength }
      }
    })

    const scoreValues = scored.map((s) => s.score)
    const min = Math.min(...scoreValues)
    const max = Math.max(...scoreValues)
    const range = max - min

    res.json(scored.map((s) => ({
      ...s,
      scoreX20: Number((s.score * 20).toFixed(2)),
      percentage: range === 0 ? 100 : Number((((s.score - min) / range) * 100).toFixed(1))
    })))
  } catch (e) {
    console.error('[discord/scores]', e)
    res.status(500).json({ error: 'サーバーエラー' })
  }
})

module.exports = router
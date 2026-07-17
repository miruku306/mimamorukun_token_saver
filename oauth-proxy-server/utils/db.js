const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

// usersテーブルの初期化
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id              SERIAL PRIMARY KEY,
      github_id       TEXT UNIQUE,
      github_username TEXT,
      discord_id      TEXT UNIQUE,
      discord_username TEXT,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  console.log('[db] テーブル初期化完了')
}

// GitHubユーザーをupsert
async function upsertGithubUser(githubId, username) {
  const result = await pool.query(
    `INSERT INTO users (github_id, github_username)
     VALUES ($1, $2)
     ON CONFLICT (github_id) DO UPDATE
       SET github_username = $2, updated_at = NOW()
     RETURNING id`,
    [githubId, username]
  )
  return result.rows[0]
}

// DiscordユーザーをGitHubユーザーに紐付け
async function upsertDiscordUser(userId, discordId, discordUsername) {
  const result = await pool.query(
    `UPDATE users
     SET discord_id = $2, discord_username = $3, updated_at = NOW()
     WHERE id = $1
     RETURNING id`,
    [userId, discordId, discordUsername]
  )
  return result.rows[0]
}

// IDでユーザーを取得
async function getUserById(id) {
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [id])
  return result.rows[0] || null
}

module.exports = { initDB, upsertGithubUser, upsertDiscordUser, getUserById }
-- ═══════════════════════════════════════════════════════════
-- ZAFAR GameFi — Supabase Database Schema
-- supabase.com da "SQL Editor" ga nusxa olib ishga tushiring
-- ═══════════════════════════════════════════════════════════

-- 1. USERS JADVALI
CREATE TABLE IF NOT EXISTS users (
  id                  BIGSERIAL PRIMARY KEY,
  telegram_id         BIGINT UNIQUE NOT NULL,
  username            TEXT,
  display_name        TEXT,
  coins               BIGINT DEFAULT 0,
  energy              INT DEFAULT 1000,
  max_energy          INT DEFAULT 1000,
  tap_power           INT DEFAULT 1,
  level               INT DEFAULT 1,
  streak              INT DEFAULT 0,
  last_daily          TIMESTAMPTZ,
  last_energy_update  TIMESTAMPTZ DEFAULT NOW(),
  referral_code       TEXT UNIQUE,
  referred_by         BIGINT REFERENCES users(id),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- 2. TRANSACTIONS
CREATE TABLE IF NOT EXISTS transactions (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL, -- tap_earn, daily_bonus, referral_passive, withdrawal, tournament_prize
  amount      BIGINT NOT NULL,
  status      TEXT DEFAULT 'completed', -- completed, pending, failed
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 3. DAILY TASKS
CREATE TABLE IF NOT EXISTS daily_tasks (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT REFERENCES users(id) ON DELETE CASCADE,
  task_type     TEXT NOT NULL,
  completed_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 4. BOOSTERS
CREATE TABLE IF NOT EXISTS boosters (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT REFERENCES users(id) ON DELETE CASCADE,
  booster_type    TEXT NOT NULL,
  multiplier      INT DEFAULT 1,
  expires_at      TIMESTAMPTZ,
  activated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 5. WITHDRAWALS
CREATE TABLE IF NOT EXISTS withdrawals (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT REFERENCES users(id) ON DELETE CASCADE,
  amount_zfc  BIGINT NOT NULL,
  fee_zfc     BIGINT DEFAULT 0,
  amount_uzs  BIGINT NOT NULL,
  method      TEXT NOT NULL, -- click, payme, bank
  phone       TEXT NOT NULL,
  status      TEXT DEFAULT 'pending', -- pending, processing, completed, failed
  tx_id       TEXT, -- to'lov tizimi transaction ID
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 6. REFERRALS
CREATE TABLE IF NOT EXISTS referrals (
  id            BIGSERIAL PRIMARY KEY,
  referrer_id   BIGINT REFERENCES users(id) ON DELETE CASCADE,
  referred_id   BIGINT REFERENCES users(id) ON DELETE CASCADE,
  bonus_given   BIGINT DEFAULT 5000,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(referrer_id, referred_id)
);

-- 7. TOURNAMENTS
CREATE TABLE IF NOT EXISTS tournaments (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT REFERENCES users(id) ON DELETE CASCADE,
  week          TEXT NOT NULL, -- '2024-W01' format
  score         BIGINT DEFAULT 0,
  rank          INT,
  entry_fee     BIGINT DEFAULT 10000,
  prize_zfc     BIGINT DEFAULT 0,
  prize_claimed BOOLEAN DEFAULT FALSE,
  joined_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════
-- INDEXES (tezlikni oshirish uchun)
-- ═══════════════════════════════════════════
CREATE INDEX idx_users_telegram_id ON users(telegram_id);
CREATE INDEX idx_users_coins ON users(coins DESC);
CREATE INDEX idx_users_referral_code ON users(referral_code);
CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_daily_tasks_user_date ON daily_tasks(user_id, completed_at);
CREATE INDEX idx_withdrawals_user_status ON withdrawals(user_id, status);
CREATE INDEX idx_tournaments_week ON tournaments(week, score DESC);

-- ═══════════════════════════════════════════
-- FUNCTIONS
-- ═══════════════════════════════════════════

-- Coinlarni oshirish (atomic)
CREATE OR REPLACE FUNCTION increment_coins(user_id BIGINT, amount BIGINT)
RETURNS void AS $$
  UPDATE users SET coins = coins + amount WHERE id = user_id;
$$ LANGUAGE sql SECURITY DEFINER;

-- Foydalanuvchi reyting o'rni
CREATE OR REPLACE FUNCTION get_user_rank(p_telegram_id BIGINT)
RETURNS INT AS $$
  SELECT COUNT(*) + 1
  FROM users
  WHERE coins > (SELECT coins FROM users WHERE telegram_id = p_telegram_id)
$$ LANGUAGE sql SECURITY DEFINER;

-- ═══════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS)
-- ═══════════════════════════════════════════
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;

-- Faqat service_key orqali kirish (backend tomondan)
-- Frontend to'g'ridan-to'g'ri kirmasin
CREATE POLICY "Service role only" ON users
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role only" ON transactions
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role only" ON daily_tasks
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role only" ON withdrawals
  FOR ALL USING (auth.role() = 'service_role');

-- ═══════════════════════════════════════════
-- TEST FOYDALANUVCHI (ixtiyoriy)
-- ═══════════════════════════════════════════
INSERT INTO users (telegram_id, username, display_name, coins, referral_code)
VALUES (12345678, 'testuser', 'Test Foydalanuvchi', 100000, 'ZAFTEST001')
ON CONFLICT DO NOTHING;

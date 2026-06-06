// ═══════════════════════════════════════════════════════════
// ZAFAR GameFi — Backend API (Node.js + Express + Supabase)
// ═══════════════════════════════════════════════════════════

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// ─── CONFIG ───
const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN';
const SUPABASE_URL = process.env.SUPABASE_URL || 'YOUR_SUPABASE_URL';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || 'YOUR_SUPABASE_SERVICE_KEY';
const PORT = process.env.PORT || 3000;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── CONSTANTS ───
const COIN_RATE = 50;          // 1 ZFC = 1/50000 so'm
const MIN_WITHDRAW = 500000;   // Minimal yechish ZFC
const MAX_ENERGY = 1000;
const ENERGY_REGEN = 1;        // per second
const MAX_TAP_RATE = 10;       // taps/sec
const WITHDRAW_FEE = 0.05;     // 5% komissiya

// ─── RATE LIMITER ───
const tapLimiter = rateLimit({
  windowMs: 1000,
  max: MAX_TAP_RATE,
  message: { error: 'Juda tez! Max 10 tap/sekund' }
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Juda ko\'p so\'rov. Bir daqiqa kutib turing.' }
});

app.use('/api/', apiLimiter);

// ═══════════════════════════════════════════
// TELEGRAM initData VALIDATION
// ═══════════════════════════════════════════
function validateTelegramData(initData) {
  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    urlParams.delete('hash');

    const dataCheckString = Array.from(urlParams.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData')
      .update(BOT_TOKEN)
      .digest();

    const expectedHash = crypto.createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (expectedHash !== hash) return null;

    const userData = JSON.parse(urlParams.get('user') || '{}');
    return userData;
  } catch (e) {
    return null;
  }
}

// Auth Middleware
function authMiddleware(req, res, next) {
  // Development mode: skip validation
  if (process.env.NODE_ENV === 'development') {
    req.telegramUser = { id: 12345678, first_name: 'Test', username: 'testuser' };
    return next();
  }

  const initData = req.headers['x-telegram-init-data'];
  if (!initData) return res.status(401).json({ error: 'Telegram autentifikatsiya kerak' });

  const user = validateTelegramData(initData);
  if (!user) return res.status(401).json({ error: 'Noto\'g\'ri Telegram ma\'lumoti' });

  req.telegramUser = user;
  next();
}

// ═══════════════════════════════════════════
// HELPER: Energiyani hisoblash
// ═══════════════════════════════════════════
function calculateCurrentEnergy(lastEnergyUpdate, currentEnergy, maxEnergy) {
  const now = Date.now();
  const elapsed = Math.floor((now - new Date(lastEnergyUpdate).getTime()) / 1000);
  const regenAmount = elapsed * ENERGY_REGEN;
  return Math.min(maxEnergy, currentEnergy + regenAmount);
}

// Referal kodi generatsiya
function generateRefCode(telegramId) {
  return 'ZAF' + telegramId.toString(36).toUpperCase().slice(-4) +
         Math.random().toString(36).substr(2, 3).toUpperCase();
}

// ═══════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════

// ─── 1. USER INIT ───
app.post('/api/user/init', authMiddleware, async (req, res) => {
  const { id, first_name, username } = req.telegramUser;
  const { ref_code } = req.body;

  try {
    // Check if user exists
    let { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', id)
      .single();

    if (!user) {
      // Create new user
      const refCode = generateRefCode(id);
      const newUser = {
        telegram_id: id,
        username: username || first_name,
        display_name: first_name,
        coins: 0,
        energy: MAX_ENERGY,
        max_energy: MAX_ENERGY,
        tap_power: 1,
        level: 1,
        streak: 0,
        last_daily: null,
        referral_code: refCode,
        referred_by: null,
        last_energy_update: new Date().toISOString(),
        created_at: new Date().toISOString()
      };

      const { data: created, error } = await supabase
        .from('users')
        .insert(newUser)
        .select()
        .single();

      if (error) throw error;
      user = created;

      // Handle referral
      if (ref_code && ref_code !== refCode) {
        const { data: referrer } = await supabase
          .from('users')
          .select('id, coins')
          .eq('referral_code', ref_code)
          .single();

        if (referrer) {
          // Give referral bonus to referrer
          await supabase
            .from('users')
            .update({ coins: referrer.coins + 5000 })
            .eq('id', referrer.id);

          // Link referral
          await supabase
            .from('users')
            .update({ referred_by: referrer.id })
            .eq('id', user.id);

          await supabase.from('referrals').insert({
            referrer_id: referrer.id,
            referred_id: user.id,
            bonus_given: 5000
          });
        }
      }
    } else {
      // Update display name
      await supabase
        .from('users')
        .update({ display_name: first_name, username: username || first_name })
        .eq('id', user.id);
    }

    // Calculate current energy
    const currentEnergy = calculateCurrentEnergy(
      user.last_energy_update, user.energy, user.max_energy
    );

    res.json({
      success: true,
      user: {
        ...user,
        energy: currentEnergy,
        isNew: !user.created_at || Date.now() - new Date(user.created_at).getTime() < 5000
      }
    });

  } catch (error) {
    console.error('Init error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// ─── 2. TAP ───
app.post('/api/game/tap', authMiddleware, tapLimiter, async (req, res) => {
  const { taps = 1 } = req.body;
  const telegramId = req.telegramUser.id;

  if (taps < 1 || taps > 10) return res.status(400).json({ error: 'Noto\'g\'ri tap soni' });

  try {
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegramId)
      .single();

    if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });

    // Calculate current energy
    const currentEnergy = calculateCurrentEnergy(
      user.last_energy_update, user.energy, user.max_energy
    );

    if (currentEnergy < taps) {
      return res.status(400).json({ error: 'Energiya yetarli emas', energy: currentEnergy });
    }

    const actualTaps = Math.min(taps, currentEnergy);
    const earned = actualTaps * user.tap_power;
    const newEnergy = currentEnergy - actualTaps;
    const newCoins = user.coins + earned;
    const newLevel = Math.floor(newCoins / 50000) + 1;

    // Update user
    await supabase
      .from('users')
      .update({
        coins: newCoins,
        energy: newEnergy,
        level: newLevel,
        last_energy_update: new Date().toISOString()
      })
      .eq('id', user.id);

    // Log transaction
    await supabase.from('transactions').insert({
      user_id: user.id,
      type: 'tap_earn',
      amount: earned,
      status: 'completed'
    });

    // Referral passive income (10% to referrer)
    if (user.referred_by) {
      const referralBonus = Math.floor(earned * 0.1);
      if (referralBonus > 0) {
        await supabase.rpc('increment_coins', {
          user_id: user.referred_by,
          amount: referralBonus
        });
        await supabase.from('transactions').insert({
          user_id: user.referred_by,
          type: 'referral_passive',
          amount: referralBonus,
          status: 'completed',
          note: `From user ${user.id}`
        });
      }
    }

    res.json({
      success: true,
      earned,
      coins: newCoins,
      energy: newEnergy,
      level: newLevel
    });

  } catch (error) {
    console.error('Tap error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// ─── 3. DAILY CLAIM ───
app.post('/api/game/daily-claim', authMiddleware, async (req, res) => {
  const telegramId = req.telegramUser.id;

  try {
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegramId)
      .single();

    if (!user) return res.status(404).json({ error: 'Topilmadi' });

    const now = new Date();
    const lastDaily = user.last_daily ? new Date(user.last_daily) : null;

    // Check if already claimed today
    if (lastDaily) {
      const diffHours = (now - lastDaily) / (1000 * 60 * 60);
      if (diffHours < 20) {
        const nextClaim = new Date(lastDaily.getTime() + 20 * 60 * 60 * 1000);
        return res.status(400).json({
          error: 'Allaqachon olindi',
          nextClaim: nextClaim.toISOString()
        });
      }
    }

    // Calculate streak
    let newStreak = 1;
    if (lastDaily) {
      const diffDays = (now - lastDaily) / (1000 * 60 * 60 * 24);
      if (diffDays < 2) {
        newStreak = Math.min(7, (user.streak || 0) + 1);
      }
    }

    // Streak rewards
    const streakRewards = [500, 1000, 1500, 2000, 2500, 3000, 5000];
    const reward = streakRewards[(newStreak - 1)] || 500;

    await supabase
      .from('users')
      .update({
        coins: user.coins + reward,
        streak: newStreak,
        last_daily: now.toISOString()
      })
      .eq('id', user.id);

    await supabase.from('transactions').insert({
      user_id: user.id,
      type: 'daily_bonus',
      amount: reward,
      status: 'completed',
      note: `Streak day ${newStreak}`
    });

    res.json({
      success: true,
      reward,
      streak: newStreak,
      coins: user.coins + reward,
      nextStreak: newStreak < 7 ? streakRewards[newStreak] : null
    });

  } catch (error) {
    console.error('Daily claim error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// ─── 4. LEADERBOARD ───
app.get('/api/leaderboard', authMiddleware, async (req, res) => {
  try {
    const { data: top100 } = await supabase
      .from('users')
      .select('id, display_name, username, coins, level, streak')
      .order('coins', { ascending: false })
      .limit(100);

    const telegramId = req.telegramUser.id;
    const { data: myRank } = await supabase.rpc('get_user_rank', { p_telegram_id: telegramId });

    res.json({
      success: true,
      leaderboard: top100,
      myRank: myRank || 9999
    });
  } catch (error) {
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// ─── 5. TASKS ───
app.get('/api/tasks', authMiddleware, async (req, res) => {
  const telegramId = req.telegramUser.id;

  try {
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('telegram_id', telegramId)
      .single();

    const today = new Date().toISOString().split('T')[0];
    const { data: completed } = await supabase
      .from('daily_tasks')
      .select('task_type')
      .eq('user_id', user.id)
      .gte('completed_at', today);

    const completedIds = completed?.map(t => t.task_type) || [];

    const tasks = {
      daily: [
        { id: 'tap1000', name: '1000 marta tap', reward: 5000, icon: '👆' },
        { id: 'daily_login', name: 'Kunlik kirish', reward: 1000, icon: '📅' },
        { id: 'watch_ad', name: 'Reklama ko\'r', reward: 2000, icon: '📺' },
      ],
      social: [
        { id: 'join_channel', name: 'Kanalga qo\'shil', reward: 3000, icon: '📢', url: 'https://t.me/zafar_game' },
        { id: 'invite_friend', name: '1 do\'st taklif qil', reward: 5000, icon: '👤' },
        { id: 'invite_5', name: '5 do\'st taklif qil', reward: 25000, icon: '👥' },
      ]
    };

    // Mark completed
    Object.values(tasks).flat().forEach(t => {
      t.completed = completedIds.includes(t.id);
    });

    res.json({ success: true, tasks });
  } catch (error) {
    res.status(500).json({ error: 'Server xatosi' });
  }
});

app.post('/api/tasks/complete', authMiddleware, async (req, res) => {
  const { task_id } = req.body;
  const telegramId = req.telegramUser.id;

  const taskRewards = {
    tap1000: 5000, daily_login: 1000, watch_ad: 2000,
    join_channel: 3000, invite_friend: 5000, invite_5: 25000
  };

  const reward = taskRewards[task_id];
  if (!reward) return res.status(400).json({ error: 'Noto\'g\'ri vazifa' });

  try {
    const { data: user } = await supabase
      .from('users').select('id, coins').eq('telegram_id', telegramId).single();
    if (!user) return res.status(404).json({ error: 'Topilmadi' });

    // Check already completed today
    const today = new Date().toISOString().split('T')[0];
    const { data: existing } = await supabase
      .from('daily_tasks')
      .select('id')
      .eq('user_id', user.id)
      .eq('task_type', task_id)
      .gte('completed_at', today)
      .single();

    if (existing) return res.status(400).json({ error: 'Allaqachon bajarilgan' });

    await supabase.from('daily_tasks').insert({
      user_id: user.id, task_type: task_id, completed_at: new Date().toISOString()
    });

    await supabase
      .from('users')
      .update({ coins: user.coins + reward })
      .eq('id', user.id);

    res.json({ success: true, reward, coins: user.coins + reward });
  } catch (error) {
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// ─── 6. WITHDRAW ───
app.post('/api/withdraw', authMiddleware, async (req, res) => {
  const { amount, method, phone } = req.body;
  const telegramId = req.telegramUser.id;

  if (!amount || amount < MIN_WITHDRAW) {
    return res.status(400).json({ error: `Minimum ${MIN_WITHDRAW} ZFC kerak` });
  }

  if (!['click', 'payme', 'bank'].includes(method)) {
    return res.status(400).json({ error: 'Noto\'g\'ri to\'lov usuli' });
  }

  if (!phone || !/^\+998\d{9}$/.test(phone.replace(/\s/g, ''))) {
    return res.status(400).json({ error: 'Telefon raqam noto\'g\'ri (+998XXXXXXXXX)' });
  }

  try {
    const { data: user } = await supabase
      .from('users').select('*').eq('telegram_id', telegramId).single();
    if (!user) return res.status(404).json({ error: 'Topilmadi' });

    // Account age check (min 7 days)
    const accountAge = (Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24);
    if (accountAge < 7) {
      return res.status(400).json({ error: 'Hisob 7 kundan eski bo\'lishi kerak' });
    }

    if (user.coins < amount) {
      return res.status(400).json({ error: 'Yetarli ZFC yo\'q' });
    }

    // Pending withdrawals check
    const { data: pending } = await supabase
      .from('withdrawals')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'pending');

    if (pending?.length > 0) {
      return res.status(400).json({ error: 'Kutilayotgan yechish mavjud' });
    }

    const fee = Math.floor(amount * WITHDRAW_FEE);
    const netAmount = amount - fee;
    const uzsAmount = Math.floor(netAmount / COIN_RATE);

    // Create withdrawal request
    const { data: withdrawal } = await supabase
      .from('withdrawals')
      .insert({
        user_id: user.id,
        amount_zfc: amount,
        fee_zfc: fee,
        amount_uzs: uzsAmount,
        method,
        phone: phone.replace(/\s/g, ''),
        status: 'pending',
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    // Deduct coins
    await supabase
      .from('users')
      .update({ coins: user.coins - amount })
      .eq('id', user.id);

    await supabase.from('transactions').insert({
      user_id: user.id,
      type: 'withdrawal',
      amount: -amount,
      status: 'pending',
      note: `${method} via ${phone}`
    });

    res.json({
      success: true,
      withdrawal_id: withdrawal.id,
      amount_zfc: amount,
      amount_uzs: uzsAmount,
      fee_zfc: fee,
      method,
      status: 'pending',
      message: `${uzsAmount.toLocaleString()} so\'m ${method} orqali yuborilmoqda`
    });

  } catch (error) {
    console.error('Withdraw error:', error);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// ─── 7. REFERRAL INFO ───
app.get('/api/referral', authMiddleware, async (req, res) => {
  const telegramId = req.telegramUser.id;
  try {
    const { data: user } = await supabase
      .from('users').select('id, referral_code, coins').eq('telegram_id', telegramId).single();
    if (!user) return res.status(404).json({ error: 'Topilmadi' });

    const { data: referrals } = await supabase
      .from('referrals')
      .select('referred_id, bonus_given, users!referrals_referred_id_fkey(display_name, coins)')
      .eq('referrer_id', user.id);

    const { data: passiveEarnings } = await supabase
      .from('transactions')
      .select('amount')
      .eq('user_id', user.id)
      .eq('type', 'referral_passive');

    const totalPassive = passiveEarnings?.reduce((sum, t) => sum + t.amount, 0) || 0;

    res.json({
      success: true,
      referral_code: user.referral_code,
      referral_link: `https://t.me/ZafarBot?start=${user.referral_code}`,
      total_referrals: referrals?.length || 0,
      total_passive_earned: totalPassive,
      friends: referrals?.map(r => ({
        name: r.users?.display_name,
        coins: r.users?.coins,
        bonus_earned: Math.floor((r.users?.coins || 0) * 0.1)
      })) || []
    });

  } catch (error) {
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// ─── 8. SHOP / BUY BOOSTER ───
app.post('/api/shop/buy', authMiddleware, async (req, res) => {
  const { item_id, payment_type, stars_amount } = req.body;
  const telegramId = req.telegramUser.id;

  const shopItems = {
    boost_2x_1h:  { stars: 50,  duration: 3600,  multiplier: 2, name: '2x Boost 1 soat' },
    boost_3x_3h:  { stars: 75,  duration: 10800, multiplier: 3, name: '3x Boost 3 soat' },
    boost_auto_1h:{ stars: 100, duration: 3600,  multiplier: 0, name: 'Auto-tap 1 soat' },
    vip_7d:       { stars: 200, duration: 604800, multiplier: 2, name: 'VIP 7 kun' },
    energy_refill:{ stars: 25,  duration: 0,     multiplier: 0, name: 'Energiya to\'ldirish' },
  };

  const item = shopItems[item_id];
  if (!item) return res.status(400).json({ error: 'Mahsulot topilmadi' });

  try {
    const { data: user } = await supabase
      .from('users').select('id, max_energy').eq('telegram_id', telegramId).single();
    if (!user) return res.status(404).json({ error: 'Topilmadi' });

    // In production, validate Telegram payment receipt here
    // For now, trust the client (add payment_id validation in prod)

    const expiresAt = item.duration > 0
      ? new Date(Date.now() + item.duration * 1000).toISOString()
      : null;

    await supabase.from('boosters').insert({
      user_id: user.id,
      booster_type: item_id,
      multiplier: item.multiplier,
      expires_at: expiresAt,
      activated_at: new Date().toISOString()
    });

    // Special handling for energy refill
    if (item_id === 'energy_refill') {
      await supabase
        .from('users')
        .update({ energy: user.max_energy, last_energy_update: new Date().toISOString() })
        .eq('id', user.id);
    }

    // VIP: increase max energy
    if (item_id === 'vip_7d') {
      await supabase
        .from('users')
        .update({ max_energy: 3000, tap_power: 2 })
        .eq('id', user.id);
    }

    res.json({
      success: true,
      item: item.name,
      expires_at: expiresAt,
      message: `${item.name} faollashtirildi!`
    });

  } catch (error) {
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// ─── HEALTH CHECK ───
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', game: 'ZAFAR', version: '1.0.0' });
});

// ═══════════════════════════════════════════
// START
// ═══════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`🎮 ZAFAR Backend running on port ${PORT}`);
});

module.exports = app;

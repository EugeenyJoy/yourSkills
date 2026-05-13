// ============================================
// middleware/auth.js — общая проверка авторизации
// ============================================

function authMiddleware(req, res, next) {
  const initData = req.headers['x-telegram-init-data'];

  if (!initData && process.env.NODE_ENV !== 'development') {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }

  const user = req.app.validateTelegramData(initData);
  if (!user) return res.status(403).json({ error: 'Невалидные данные' });

  req.userId = user.id;
  next();
}

module.exports = authMiddleware;

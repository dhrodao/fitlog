import { Router } from 'express';
import config from '../config.js';
import {
  COOKIE_NAME,
  clearSessionCookie,
  createSession,
  destroySession,
  ensureDevUser,
  publicUser,
  requireAuth,
  setSessionCookie,
  upsertGoogleUser,
  verifyGoogleCredential,
} from '../auth.js';
import { asyncHandler } from '../http.js';

const router = Router();

router.get('/config', (req, res) => {
  res.json({
    googleClientId: config.googleClientId,
    googleEnabled: Boolean(config.googleClientId),
    devLoginEnabled: config.allowDevLogin,
  });
});

router.post(
  '/google',
  asyncHandler(async (req, res) => {
    const credential = req.body?.credential;
    if (!credential || typeof credential !== 'string') {
      return res.status(400).json({ error: 'Falta el token de Google' });
    }

    let payload;
    try {
      payload = await verifyGoogleCredential(credential);
    } catch (error) {
      return res
        .status(401)
        .json({ error: 'No se pudo verificar la cuenta de Google' });
    }

    const user = upsertGoogleUser(payload);
    const session = createSession(user.id);
    setSessionCookie(res, session.token, session.expiresAt);

    res.json({ user: publicUser(user) });
  })
);

router.post('/dev', (req, res) => {
  if (!config.allowDevLogin) {
    return res.status(404).json({ error: 'Login de desarrollo desactivado' });
  }

  const user = ensureDevUser();
  const session = createSession(user.id);
  setSessionCookie(res, session.token, session.expiresAt);

  res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  destroySession(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

export default router;

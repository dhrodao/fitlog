import { Router } from 'express';
import { userByWebhookToken, syncUser } from '../hevy-sync.js';

const router = Router();

/**
 * Public endpoint that Hevy calls when a workout is saved.
 * Payload: { "workoutId": "..." }
 * Auth: the `Authorization: Bearer <token>` header we registered when
 * subscribing. The token maps to a user. Hevy expects a 200 within 5s, so we
 * acknowledge immediately and run the (incremental, idempotent) sync in the
 * background.
 */
router.post('/webhook', (req, res) => {
  const header = req.get('authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  const userId = userByWebhookToken(token);

  if (!userId) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // Acknowledge first; do the work afterwards so we never exceed Hevy's 5s.
  res.status(200).json({ ok: true });

  Promise.resolve()
    .then(() => syncUser(userId))
    .then((result) => {
      if (result?.totals?.imported) {
        console.log(
          `[hevy-webhook] usuario ${userId}: +${result.totals.imported} entrenos`
        );
      }
    })
    .catch((err) => {
      console.warn(`[hevy-webhook] sync usuario ${userId} falló: ${err.message}`);
    });
});

export default router;

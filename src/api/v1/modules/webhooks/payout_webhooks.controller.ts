const payout = require('../wallet/payout_orchestrator');

async function handle(provider, req, res, next) {
  try {
    // app.js captures raw JSON bytes into req.rawBody for reliable webhook signature verification
    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : null;

    const result = await payout.handleWebhook({
      provider,
      headers: req.headers,
      body: req.body,
      rawBody,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (e) {
    return next(e);
  }
}

exports.bkash = (req, res, next) => handle('BKASH', req, res, next);
exports.nagad = (req, res, next) => handle('NAGAD', req, res, next);
exports.rocket = (req, res, next) => handle('ROCKET', req, res, next);

export {};

/**
 * Invite notifier placeholder (SMS/Email integration point)
 * Replace this with real provider integrations (SMS gateway / SendGrid / Mailgun etc.)
 */
exports.sendInvite = async function sendInvite({ channel, to, message }) {
  // eslint-disable-next-line no-console
  console.log(`[INVITE:${channel}] to=${to} message=${message}`);
  return { success: true };
};

export {};

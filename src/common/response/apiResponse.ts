exports.ok = (res, data, message = "OK") =>
  res.json({ success: true, message, data });

exports.fail = (res, message = "Failed", status = 400, details) =>
  res.status(status).json({ success: false, message, ...(details ? { details } : {}) });

export {};

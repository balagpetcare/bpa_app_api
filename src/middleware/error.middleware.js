const ApiError = require("../common/errors/ApiError");

exports.notFound = (req, res, next) => {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
};

exports.errorHandler = (err, req, res, next) => {
  console.error("ERROR:", err);

  const status = err.statusCode || 500;
  res.status(status).json({
    success: false,
    message: err.message || "Internal Server Error",
    ...(err.details ? { details: err.details } : {}),
  });
};

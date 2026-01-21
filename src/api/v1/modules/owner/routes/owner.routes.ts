const express = require('express');
const { requireUser } = require('../../../middlewares/auth');

const { organizationsRouter } = require('./organizations.routes');

const ownerRouter = express.Router();

// all owner endpoints require user
ownerRouter.use(requireUser);

ownerRouter.use('/organizations', organizationsRouter);

module.exports = { ownerRouter };

export {};

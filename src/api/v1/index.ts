const express = require('express');

const { ownerRouter } = require('./modules/owner/routes/owner.routes');

const apiV1Router = express.Router();

apiV1Router.get('/', (req, res) => {
  res.json({ name: 'BPA API', version: 'v1' });
});

apiV1Router.use('/owner', ownerRouter);

module.exports = { apiV1Router };

export {};

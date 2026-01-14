const express = require('express');
const router = express.Router();

const { getDhakaLocations } = require('./locations.service');

// GET /api/v1/locations/dhaka?lang=en|bn
router.get('/dhaka', async (req, res, next) => {
  try {
    const lang = (req.query.lang === 'bn') ? 'bn' : 'en';
    const data = await getDhakaLocations({ lang });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

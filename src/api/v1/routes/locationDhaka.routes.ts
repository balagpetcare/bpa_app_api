
import express from "express";
import { dhakaCityCorps, dhakaSearch } from "../services/locationDhaka.service";
const router = express.Router();

router.get("/city-corps", dhakaCityCorps);
router.get("/search", dhakaSearch);

export default router;

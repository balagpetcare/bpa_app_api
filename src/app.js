require("dotenv").config();

const express = require("express");
const cors = require("cors");
const corsOptions = require("./config/corsOptions");
const appConfig = require("./config/appConfig");

const v1Routes = require("./api/v1/routes");
const { notFound, errorHandler } = require("./middleware/error.middleware");

const app = express();

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/health", (req, res) => res.json({ ok: true }));

// ✅ Mount API
app.use(appConfig.api.prefix, v1Routes);

const listEndpoints = require("express-list-endpoints");
if (process.env.NODE_ENV === "development") {
  console.log(listEndpoints(app));
}




// --------------------
// ✅ GLOBAL REQUEST LOGGER (এখানেই বসাবেন)
// --------------------
app.use((req, res, next) => {
  console.log("\n================ REQUEST ================");
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  console.log("Content-Type:", req.headers["content-type"]);
  console.log("Headers auth:", req.headers.authorization ? "YES" : "NO");
  console.log("Body:", req.body);
  console.log("=========================================");
  next();
});





const path = require("path");

app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));


// ✅ Errors
app.use(notFound);
app.use(errorHandler);

module.exports = app;

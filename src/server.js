const app = require("./app");
const appConfig = require("./config/appConfig");

const PREFIX = appConfig.api?.prefix || "/api/v1";

app.listen(appConfig.server.port, "0.0.0.0", () => {
  console.log(`🚀 Server running at http://0.0.0.0:${appConfig.server.port}${PREFIX}`);
});

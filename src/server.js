const app = require("./app");
const appConfig = require("./config/appConfig");

const PREFIX = appConfig.api.prefix;

app.listen(appConfig.server.port, () => {
  console.log(
    `🚀 Server running at http://${appConfig.server.host}:${appConfig.server.port}${PREFIX}`
  );
});

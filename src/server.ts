import { makeApp } from "./app";

const port = Number(process.env.PORT || 8080);
const app = makeApp();

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`BPA Partner Onboarding API listening on http://localhost:${port}`);
});

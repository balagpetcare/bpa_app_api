/**
 * Smoke: ensure upload + batches handlers stay wired on the sub-router.
 */
describe("admin_medicine_import.routes registration", () => {
  it("registers upload, batches list, and batch purge routes", () => {
    const router = require("./admin_medicine_import.routes");
    expect(router?.stack?.length).toBeGreaterThan(0);
    const paths: { method: string; path: string }[] = [];
    for (const layer of router.stack) {
      const route = layer.route;
      if (!route?.path) continue;
      const methods = route.methods || {};
      for (const m of Object.keys(methods)) {
        if (methods[m]) paths.push({ method: m.toUpperCase(), path: route.path });
      }
    }
    expect(paths.some((p) => p.method === "POST" && p.path === "/upload")).toBe(true);
    expect(paths.some((p) => p.method === "GET" && p.path === "/batches")).toBe(true);
    expect(paths.some((p) => p.method === "POST" && p.path === "/batches/:id/purge")).toBe(true);
  });
});

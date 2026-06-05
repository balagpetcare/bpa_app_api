const { resetStorageProviderForTests } = require("./storage.factory");

function loadConfigModule() {
  jest.resetModules();
  return require("./storage.config");
}

describe("storage.config", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    resetStorageProviderForTests();
  });

  afterAll(() => {
    process.env = env;
  });

  it("defaults to minio provider", () => {
    delete process.env.STORAGE_PROVIDER;
    const { normalizeProvider } = loadConfigModule();
    expect(normalizeProvider(undefined)).toBe("minio");
  });

  it("accepts b2 aliases", () => {
    const { normalizeProvider } = loadConfigModule();
    expect(normalizeProvider("b2")).toBe("b2");
    expect(normalizeProvider("backblaze")).toBe("b2");
  });

  it("rejects unknown provider", () => {
    const { normalizeProvider } = loadConfigModule();
    expect(() => normalizeProvider("azure")).toThrow(/STORAGE_PROVIDER/);
  });

  it("resolves minio from AWS_* vars", () => {
    process.env.STORAGE_PROVIDER = "minio";
    process.env.AWS_BUCKET_NAME = "bpa-pets";
    process.env.AWS_ENDPOINT = "http://localhost:9000";
    process.env.AWS_ACCESS_KEY_ID = "minioadmin";
    process.env.AWS_SECRET_ACCESS_KEY = "minioadmin";
    const { resolveStorageConfig } = loadConfigModule();
    const cfg = resolveStorageConfig();
    expect(cfg.provider).toBe("minio");
    expect(cfg.bucketName).toBe("bpa-pets");
    expect(cfg.endpoint).toBe("http://localhost:9000");
  });

  it("resolves b2 from S3_* vars", () => {
    process.env.STORAGE_PROVIDER = "b2";
    process.env.S3_REGION = "us-east-005";
    process.env.S3_BUCKET = "bpa-production-media";
    process.env.S3_ENDPOINT = "https://s3.us-east-005.backblazeb2.com";
    process.env.S3_ACCESS_KEY = "key-id";
    process.env.S3_SECRET_KEY = "secret";
    process.env.STORAGE_PUBLIC_URL = "https://cdn.example.com";
    const { resolveStorageConfig } = loadConfigModule();
    const cfg = resolveStorageConfig();
    expect(cfg.provider).toBe("b2");
    expect(cfg.bucketName).toBe("bpa-production-media");
    expect(cfg.publicUrl).toBe("https://cdn.example.com");
  });

  it("requires public URL for b2 validation", () => {
    process.env.STORAGE_PROVIDER = "b2";
    process.env.S3_ENDPOINT = "https://s3.us-east-005.backblazeb2.com";
    process.env.S3_BUCKET = "bpa-production-media";
    process.env.S3_ACCESS_KEY = "k";
    process.env.S3_SECRET_KEY = "s";
    process.env.STORAGE_PUBLIC_URL = "";
    process.env.MINIO_PUBLIC_URL = "";
    const { resolveStorageConfig, validateStorageConfig } = loadConfigModule();
    const errors = validateStorageConfig(resolveStorageConfig());
    expect(errors.some((e) => e.includes("STORAGE_PUBLIC_URL"))).toBe(true);
  });
});

export {};

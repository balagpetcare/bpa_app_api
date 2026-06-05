const fs = require("fs");
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

function isDockerRuntime(): boolean {
  try {
    return fs.existsSync("/.dockerenv");
  } catch (_) {
    return false;
  }
}

function resolveStorageEndpoint(rawEndpoint: string): string {
  const endpoint = String(rawEndpoint || "").trim();
  if (!endpoint) return endpoint;
  try {
    const u = new URL(endpoint);
    if (!isDockerRuntime() && u.hostname === "bpa-storage") {
      u.hostname = "localhost";
      return u.toString().replace(/\/$/, "");
    }
    return endpoint;
  } catch (_) {
    return endpoint;
  }
}

function publicMediaBase(config) {
  return String(config.publicUrl || config.endpoint || "").replace(/\/$/, "");
}

class S3CompatibleStorageProvider {
  name: string;
  config: Record<string, unknown>;
  #client: InstanceType<typeof S3Client>;
  #resolvedEndpoint: string;

  constructor(config) {
    this.name = config.provider;
    this.config = config;
    this.#resolvedEndpoint = resolveStorageEndpoint(config.endpoint);
    this.#client = new S3Client({
      region: config.region,
      endpoint: this.#resolvedEndpoint,
      forcePathStyle: config.forcePathStyle ?? true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  getS3Client() {
    return this.#client;
  }

  buildPublicUrl(key: string): string {
    const k = String(key || "").replace(/^\//, "");
    if (!k) return "";
    return `${publicMediaBase(this.config)}/${this.config.bucketName}/${k}`;
  }

  async putObject({ key, body, contentType }: { key: string; body: Buffer; contentType?: string }) {
    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.config.bucketName,
        Key: key,
        Body: body,
        ContentType: contentType || "application/octet-stream",
      })
    );
  }

  async getObject(key: string) {
    const response = await this.#client.send(
      new GetObjectCommand({
        Bucket: this.config.bucketName,
        Key: key,
      })
    );
    return {
      body: response.Body,
      contentType: response.ContentType,
    };
  }

  async deleteObject(key: string) {
    if (!key) return;
    await this.#client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucketName,
        Key: key,
      })
    );
  }

  async objectExists(key: string): Promise<boolean> {
    if (!key) return false;
    try {
      await this.#client.send(
        new HeadObjectCommand({
          Bucket: this.config.bucketName,
          Key: key,
        })
      );
      return true;
    } catch (_) {
      return false;
    }
  }

  async getSignedGetUrl(key: string, expiresInSeconds = 600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.config.bucketName,
      Key: key,
    });
    return getSignedUrl(this.#client, command, { expiresIn: expiresInSeconds });
  }
}

function createS3CompatibleProvider(config) {
  return new S3CompatibleStorageProvider(config);
}

module.exports = {
  S3CompatibleStorageProvider,
  createS3CompatibleProvider,
  resolveStorageEndpoint,
  publicMediaBase,
};

export {};

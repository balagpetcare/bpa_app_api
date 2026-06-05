export type StorageProviderName = "minio" | "b2";

export interface StorageConfig {
  provider: StorageProviderName;
  region: string;
  bucketName: string;
  endpoint: string;
  publicUrl: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  useCountryPrefix: boolean;
}

export interface PutObjectInput {
  key: string;
  body: Buffer;
  contentType?: string;
}

export interface GetObjectResult {
  body: NodeJS.ReadableStream;
  contentType?: string;
}

export interface StorageProvider {
  readonly name: StorageProviderName;
  readonly config: StorageConfig;
  putObject(input: PutObjectInput): Promise<void>;
  getObject(key: string): Promise<GetObjectResult>;
  deleteObject(key: string): Promise<void>;
  objectExists(key: string): Promise<boolean>;
  getSignedGetUrl(key: string, expiresInSeconds?: number): Promise<string>;
  buildPublicUrl(key: string): string;
  /** Underlying S3 client for advanced use (legacy callers). */
  getS3Client(): unknown;
}

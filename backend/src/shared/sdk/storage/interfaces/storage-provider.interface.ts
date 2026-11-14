// ═══════════════════════════════════════════
// Storage SDK — Storage Provider Interface
// ═══════════════════════════════════════════

export interface IStorageProvider {
  readonly name: string;

  upload(key: string, data: Buffer, mimeType: string): Promise<StorageUploadResult>;
  delete(key: string): Promise<void>;
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;
  exists(key: string): Promise<boolean>;
  getMetadata(key: string): Promise<StorageObjectMeta | null>;
  createUploadUrl(key: string, size: number, mimeType: string, expires: number): Promise<string>;
  read(key: string, maxBytes: number): Promise<Buffer>;
}

export interface StorageUploadResult {
  key: string;
  bucket: string;
  provider: string;
  url?: string;
  size: number;
}

export interface StorageObjectMeta {
  key: string;
  size: number;
  mimeType: string;
  lastModified: Date;
  etag?: string;
}

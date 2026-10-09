import fs from 'node:fs/promises';
import path from 'node:path';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9/_.-]*$/;
const assertSafeKey = (key) => {
  if (!SAFE_KEY.test(key) || key.includes('..')) throw new Error('Unsafe storage key');
};

/** Development-only adapter. Not persistent on most hosts - production config requires r2. */
function createLocalStorage(config) {
  const root = path.resolve(config.LOCAL_STORAGE_DIR);
  const resolve = (key) => {
    assertSafeKey(key);
    const p = path.resolve(root, key);
    if (!p.startsWith(root + path.sep)) throw new Error('Unsafe storage key');
    return p;
  };
  return {
    driver: 'local',
    async put(key, body) {
      const p = resolve(key);
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, body);
    },
    async get(key) { return fs.readFile(resolve(key)); },
    async delete(key) { await fs.rm(resolve(key), { force: true }); },
    async ping() { await fs.mkdir(root, { recursive: true }); },
  };
}

function createR2Storage(config) {
  const client = new S3Client({
    region: 'auto',
    endpoint: config.R2_ENDPOINT ?? `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.R2_ACCESS_KEY_ID, secretAccessKey: config.R2_SECRET_ACCESS_KEY },
    // Newer AWS SDK versions add CRC32 checksums by default, which R2 rejects/ignores inconsistently.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  const Bucket = config.R2_BUCKET_NAME;
  return {
    driver: 'r2',
    async put(key, body, contentType) {
      assertSafeKey(key);
      // Buffer body (not a stream): R2 needs a known Content-Length. Files are capped by MAX_FILE_SIZE_BYTES.
      await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType, ContentLength: body.length }));
    },
    async get(key) {
      assertSafeKey(key);
      const res = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      return Buffer.from(await res.Body.transformToByteArray());
    },
    async delete(key) {
      assertSafeKey(key);
      await client.send(new DeleteObjectCommand({ Bucket, Key: key })); // idempotent: missing key is not an error
    },
    async ping() { await client.send(new HeadBucketCommand({ Bucket })); },
  };
}

export const createStorage = (config) => (config.STORAGE_DRIVER === 'r2' ? createR2Storage(config) : createLocalStorage(config));

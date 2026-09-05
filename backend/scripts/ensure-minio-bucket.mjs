import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3'

const endpoint = process.env.S3_ENDPOINT
const bucket = process.env.S3_BUCKET
const accessKeyId = process.env.S3_ACCESS_KEY_ID
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY

if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
  throw new Error('S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY are required')
}

const client = new S3Client({
  endpoint,
  region: process.env.S3_REGION || 'us-east-1',
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
  credentials: { accessKeyId, secretAccessKey },
})

try {
  await client.send(new HeadBucketCommand({ Bucket: bucket }))
} catch {
  await client.send(new CreateBucketCommand({ Bucket: bucket }))
}

console.log('MinIO bucket is present')

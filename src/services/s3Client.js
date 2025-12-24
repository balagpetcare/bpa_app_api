// s3Client.js
const { S3Client } = require('@aws-sdk/client-s3');

const s3Client = new S3Client({
  region: 'us-east-1',
  endpoint: 'http://127.0.0.1:9000',
  forcePathStyle: true,
  credentials: {
    accessKeyId: 'admin',
    secretAccessKey: 'password123'
  },
});

const BUCKET_NAME = 'bpa-pets';

// Export client as default, and bucket as named if needed
module.exports = s3Client;
module.exports.BUCKET_NAME = BUCKET_NAME;
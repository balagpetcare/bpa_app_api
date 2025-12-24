const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const s3Client = new s3Client({
    region: 'us-east-1', // MinIO এর জন্য ডামি রিজিওন
    endpoint: 'http://127.0.0.1:9000', // Docker MinIO URL
    forcePathStyle: true, // MinIO এর জন্য এটি বাধ্যতামূলক
    credentials: {
        accessKeyId: 'admin',      // docker-compose এর ইউজারনেম
        secretAccessKey: 'password123' // docker-compose এর পাসওয়ার্ড
    },
    forcePathStyle: true, // ✅ MinIO
});

const BUCKET_NAME = 'bpa-pets'; // MinIO কনসোলে এই নামে বাকেট বানাতে হবে

module.exports = { s3Client, BUCKET_NAME };
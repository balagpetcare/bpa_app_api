const { S3Client } = require("@aws-sdk/client-s3");
const appConfig = require("./appConfig");

const s3Client = new S3Client({
 
  forcePathStyle: true, // ✅ MinIO

   region: 'us-east-1', // MinIO এর জন্য ডামি রিজিওন
    endpoint: 'http://127.0.0.1:9000', // Docker MinIO URL
    forcePathStyle: true, // MinIO এর জন্য এটি বাধ্যতামূলক
    credentials: {
        accessKeyId: 'admin',      // docker-compose এর ইউজারনেম
        secretAccessKey: 'password123' // docker-compose এর পাসওয়ার্ড
    },


    forcePathStyle: true, // ✅ MinIO


});

module.exports = s3Client;

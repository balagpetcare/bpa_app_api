const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const sharp = require('sharp');
const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

// আমাদের তৈরি করা সার্ভিস এবং কনফিগ ইমপোর্ট
const { s3Client } = require('../../services/s3Service');
const appConfig = require('../../config/appConfig'); // সেন্ট্রাল কনফিগ ফাইল

// পেটের প্রোফাইল পিকচার আপলোড এবং প্রসেসিং কন্ট্রোলার
exports.uploadPetProfileImage = async (req, res) => {
    try {
        const petId = parseInt(req.params.petId);
        const userId = req.user.id; // অথেনটিকেশন মিডলওয়্যার থেকে প্রাপ্ত

        // ১. ফাইল ভ্যালিডেশন
        if (!req.file) {
            return res.status(400).json({ success: false, message: "No image file provided." });
        }

        // ২. পেট ওনারশিপ ভেরিফিকেশন (পেটটি আসলে এই ইউজারর কি না)
        const pet = await prisma.pet.findUnique({
            where: { id: petId },
            include: { profilePic: true } // আগের ছবি থাকলে তা ডিলিট করার জন্য তথ্য লাগবে
        });

        if (!pet) {
            return res.status(404).json({ success: false, message: "Pet not found." });
        }

        if (pet.userId !== userId) {
            return res.status(403).json({ success: false, message: "Unauthorized access to this pet." });
        }

        // ৩. ফাইলের নাম জেনারেট এবং ইমেজ প্রসেসিং (Sharp)
        const bucketName = appConfig.storage.bucketName;
        const filename = `pets/pet-${petId}-${Date.now()}.webp`;
        
        // ইমেজ রিসাইজ (500x500) এবং ফরম্যাট (WebP) পরিবর্তন
        const fileBuffer = await sharp(req.file.buffer)
            .resize(500, 500, { 
                fit: 'cover', 
                position: 'center' 
            })
            .toFormat('webp', { quality: 80 }) // ৮০% কোয়ালিটি (সাইজ কমাবে)
            .toBuffer();

        // ৪. MinIO (S3) তে আপলোড করা
        const uploadParams = {
            Bucket: bucketName,
            Key: filename,
            Body: fileBuffer,
            ContentType: 'image/webp'
        };

        await s3Client.send(new PutObjectCommand(uploadParams));

        // ৫. ডাটাবেস আপডেট (Transaction ব্যবহার করে নিরাপদ আপডেট)
        const updatedData = await prisma.$transaction(async (tx) => {
            
            // ক. পাবলিক URL তৈরি (Config ফাইল থেকে IP নিয়ে)
            // ফরম্যাট: http://192.168.10.111:9000/bpa-pets/pets/filename.webp
            const publicUrl = `${appConfig.storage.publicUrl}/${bucketName}/${filename}`;

            // খ. Media টেবিলে নতুন এন্ট্রি তৈরি
            const newMedia = await tx.media.create({
                data: {
                    url: publicUrl,
                    type: 'image/webp'
                }
            });

            // গ. Pet টেবিলে profilePicId আপডেট করা
            const updatedPet = await tx.pet.update({
                where: { id: petId },
                data: { profilePicId: newMedia.id },
                include: { profilePic: true }
            });

            // ঘ. আগের ছবি S3 থেকে ডিলিট করা (Cleanup)
            if (pet.profilePic) {
                // URL থেকে Key বের করা। 
                // উদাহরণ: http://.../bpa-pets/pets/old.webp থেকে শুধু 'pets/old.webp' বের করা
                const urlParts = pet.profilePic.url.split(`${bucketName}/`);
                
                if (urlParts.length > 1) {
                    const oldKey = urlParts[1];
                    try {
                        await s3Client.send(new DeleteObjectCommand({
                            Bucket: bucketName,
                            Key: oldKey
                        }));
                        console.log(`Old image deleted: ${oldKey}`);
                    } catch (err) {
                        console.warn("Failed to delete old image from S3 (Non-fatal):", err.message);
                    }
                }
            }

            return updatedPet;
        });

        // ৬. সফল রেসপন্স
        res.status(200).json({
            success: true,
            message: "Pet profile picture updated successfully!",
            data: updatedData
        });

    } catch (error) {
        console.error("Upload Logic Error:", error);
        res.status(500).json({ 
            success: false, 
            message: "Image upload failed.", 
            error: error.message 
        });
    }
};
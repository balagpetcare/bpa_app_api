const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken'); // টোকেন তৈরির জন্য

// --- REGISTER ---
exports.register = async (req, res) => {
    try {
        const { name, email, password, phone, address } = req.body;

        // ১. চেক করা ইউজার আগে থেকেই আছে কিনা
        const existingUser = await prisma.user.findUnique({
            where: { email }
        });

        if (existingUser) {
            return res.status(400).json({ success: false, message: "Email already exists" });
        }

        // ২. পাসওয়ার্ড এনক্রিপ্ট করা
        const hashedPassword = await bcrypt.hash(password, 10);

        // ৩. ট্রানজেকশন: ইউজার তৈরি + ওয়ালেট তৈরি
        const result = await prisma.$transaction(async (tx) => {
            // ক. ইউজার তৈরি
            const newUser = await tx.user.create({
                data: {
                    name,
                    email,
                    password: hashedPassword,
                    phone,
                    address
                }
            });

            // খ. ওয়ালেট তৈরি (UserWallet)
            await tx.userWallet.create({
                data: {
                    userId: newUser.id,
                    balance: 0.00,
                    points: 0,
                    tier: "Bronze",
                    currency: "BDT"
                }
            });

            return newUser;
        });

        res.status(201).json({
            success: true,
            message: "User registered successfully!",
            user: {
                id: result.id,
                name: result.name,
                email: result.email
            }
        });

    } catch (error) {
        console.error("Register Error:", error);
        res.status(500).json({ success: false, message: "Registration failed", error: error.message });
    }
};

// --- LOGIN (নতুন যুক্ত করা হয়েছে) ---
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // ১. ইউজার খোঁজা
        const user = await prisma.user.findUnique({
            where: { email }
        });

        if (!user) {
            return res.status(400).json({ success: false, message: "User not found" });
        }

        // ২. পাসওয়ার্ড মিলানো
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: "Invalid credentials" });
        }

        // ৩. টোকেন তৈরি করা (JWT)
        // .env ফাইলে JWT_SECRET না থাকলে ডিফল্ট 'secret_key' ব্যবহার হবে (প্রোডাকশনে অবশ্যই .env ব্যবহার করবেন)
        const token = jwt.sign(
            { id: user.id, email: user.email },
            process.env.JWT_SECRET || 'secret_key', 
            { expiresIn: '7d' } // টোকেন ৭ দিন মেয়াদ থাকবে
        );

        res.status(200).json({
            success: true,
            message: "Login successful",
            token: token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                phone: user.phone
            }
        });

    } catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({ success: false, message: "Login failed", error: error.message });
    }
};

// --- GET PROFILE (Test purpose) ---
exports.getProfile = async (req, res) => {
    try {
        // req.user আসছে authMiddleware থেকে
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            include: { 
                wallet: true, // ইউজারের সাথে ওয়ালেট তথ্যও দেখাবে
                pets: true    // পেটের তথ্যও দেখাবে
            } 
        });

        res.json({ success: true, data: user });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server Error" });
    }
};
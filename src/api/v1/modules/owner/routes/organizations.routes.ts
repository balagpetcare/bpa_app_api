const express = require('express');
const multer = require('multer');
const path = require('path');

const {
  listMyOrganizations,
  getMyOrganizationById,
  updateMyOrganizationBasic,
  upsertMyOrganizationLegalProfile,
  submitMyOrganizationForReview,
  uploadOrgDocument,
  deleteOrgDocument,
} = require('../controllers/organizations.controller');

const organizationsRouter = express.Router();

const uploadDir = process.env.UPLOAD_DIR || 'uploads';
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(process.cwd(), uploadDir, 'org-docs'));
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// list
organizationsRouter.get('/', listMyOrganizations);

// view
organizationsRouter.get('/:id', getMyOrganizationById);

// update basic info (name, supportPhone, addressJson) - blocked after VERIFIED
organizationsRouter.put('/:id', updateMyOrganizationBasic);

// legal profile upsert/update - blocked after VERIFIED
organizationsRouter.put('/:id/legal-profile', upsertMyOrganizationLegalProfile);

// upload a KYC doc (creates Media + OrganizationDocument)
organizationsRouter.post('/:id/legal-profile/documents', upload.single('file'), uploadOrgDocument);

// delete a doc (soft delete media)
organizationsRouter.delete('/:id/legal-profile/documents/:docId', deleteOrgDocument);

// submit for review (UNSUBMITTED/REJECTED -> SUBMITTED)
organizationsRouter.post('/:id/submit', submitMyOrganizationForReview);

module.exports = { organizationsRouter };

export {};

# Certificate Design Document

## 2026 Cat Flu + Rabies Vaccination Campaign

---

## 1. Overview

The vaccination certificate serves as official proof of vaccination and must be:
- Verifiable via QR code
- Professional in appearance
- Printable (A4 format)
- Mobile-friendly (digital view)

---

## 2. Certificate Types

### 2.1 Digital Certificate (Web View)

Responsive web page displayed when accessing certificate URL.

### 2.2 PDF Certificate

Downloadable/printable A4 PDF document.

### 2.3 SMS Certificate

Abbreviated version sent via SMS with verification link.

---

## 3. Certificate Data Model

### 3.1 Required Fields

```typescript
interface CertificateData {
  // Certificate Identity
  certificateToken: string;      // CERT-XXXXXXXXXXXX
  issuedAt: Date;
  
  // Pet Information
  pet: {
    name: string;
    species: string;             // "Cat"
    breed?: string;
    gender?: string;
    estimatedAge?: string;       // "2 years" or "8 months"
  };
  
  // Owner Information
  owner: {
    name: string;
    phone: string;
    address?: string;
  };
  
  // Vaccination Details
  vaccination: {
    vaccineName: string;         // "Rabies", "Cat Flu (FVRCP)"
    vaccineType: string;         // Detailed type
    batchNumber: string;
    lotNumber?: string;
    manufacturer?: string;
    administeredAt: Date;
    nextDueDate: Date;
  };
  
  // Administration Details
  administration: {
    location: string;
    address: string;
    administeredBy: string;      // Staff name (optional)
    veterinarian?: string;       // Supervising vet
  };
  
  // Campaign Information
  campaign: {
    name: string;
    organizer: string;           // "Bangladesh Pet Alliance"
  };
  
  // Verification
  verification: {
    qrCodeUrl: string;
    verifyUrl: string;
  };
}
```

---

## 4. PDF Certificate Layout

### 4.1 Visual Design

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│    ┌─────────┐                                                         │
│    │  LOGO   │     VACCINATION CERTIFICATE                             │
│    └─────────┘     Bangladesh Pet Alliance                             │
│                                                                         │
│    ─────────────────────────────────────────────────────────────────   │
│                                                                         │
│    Certificate No: CERT-XYZ789012345                                   │
│    Issued: 15 July 2026                                                │
│                                                                         │
│    ─────────────────────────────────────────────────────────────────   │
│                                                                         │
│    PET INFORMATION                                                      │
│    ┌─────────────────────────────────────────────────────────────────┐ │
│    │  Name:    Mittens                                               │ │
│    │  Species: Cat                                                   │ │
│    │  Breed:   Domestic Shorthair                                    │ │
│    │  Gender:  Female                                                │ │
│    │  Age:     2 years (approx.)                                     │ │
│    └─────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│    OWNER INFORMATION                                                    │
│    ┌─────────────────────────────────────────────────────────────────┐ │
│    │  Name:    John Doe                                              │ │
│    │  Phone:   01712345678                                           │ │
│    │  Address: Dhanmondi, Dhaka                                      │ │
│    └─────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│    VACCINATION DETAILS                                                  │
│    ┌─────────────────────────────────────────────────────────────────┐ │
│    │  Vaccine:           Rabies Vaccine                              │ │
│    │  Batch Number:      RAB-2026-001                                │ │
│    │  Date Administered: 15 July 2026                                │ │
│    │  Location:          Dhaka Central Vet Clinic                    │ │
│    │                     123 Main Road, Dhanmondi, Dhaka             │ │
│    │                                                                 │ │
│    │  ╔═══════════════════════════════════════════════════════════╗ │ │
│    │  ║  NEXT VACCINATION DUE: 15 July 2027                       ║ │ │
│    │  ╚═══════════════════════════════════════════════════════════╝ │ │
│    └─────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│    ┌───────────────────┐                                               │
│    │                   │   VERIFICATION                                │
│    │    [QR CODE]      │   Scan this QR code or visit:                │
│    │                   │   vacc.bpa.com.bd/verify/CERT-XYZ789012345   │
│    │                   │                                               │
│    └───────────────────┘                                               │
│                                                                         │
│    ─────────────────────────────────────────────────────────────────   │
│                                                                         │
│    This certificate is issued under the 2026 Cat Flu + Rabies          │
│    Vaccination Campaign by Bangladesh Pet Alliance (BPA).              │
│                                                                         │
│    For verification, scan the QR code above or contact:                │
│    support@bpa.com.bd | 09612-345678                                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.2 PDF Generation Code

```typescript
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

const COLORS = {
  primary: '#1a5f7a',
  secondary: '#57837b',
  accent: '#c38154',
  text: '#333333',
  lightBg: '#f5f5f5',
  border: '#dddddd',
};

async function generateCertificatePdf(data: CertificateData): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 40, bottom: 40, left: 50, right: 50 },
  });
  
  const buffers: Buffer[] = [];
  doc.on('data', buffers.push.bind(buffers));
  
  // Header with logo
  await addHeader(doc, data);
  
  // Certificate number
  addCertificateNumber(doc, data);
  
  // Sections
  addSection(doc, 'PET INFORMATION', [
    { label: 'Name', value: data.pet.name },
    { label: 'Species', value: data.pet.species },
    { label: 'Breed', value: data.pet.breed || 'Not specified' },
    { label: 'Gender', value: data.pet.gender || 'Not specified' },
    { label: 'Age', value: data.pet.estimatedAge || 'Unknown' },
  ]);
  
  addSection(doc, 'OWNER INFORMATION', [
    { label: 'Name', value: data.owner.name },
    { label: 'Phone', value: formatPhone(data.owner.phone) },
    { label: 'Address', value: data.owner.address || 'Not provided' },
  ]);
  
  addSection(doc, 'VACCINATION DETAILS', [
    { label: 'Vaccine', value: data.vaccination.vaccineName },
    { label: 'Batch Number', value: data.vaccination.batchNumber },
    { label: 'Date Administered', value: formatDate(data.vaccination.administeredAt) },
    { label: 'Location', value: data.administration.location },
  ]);
  
  // Next due date highlight
  addNextDueHighlight(doc, data.vaccination.nextDueDate);
  
  // QR Code and verification
  await addVerificationSection(doc, data);
  
  // Footer
  addFooter(doc, data);
  
  doc.end();
  
  return new Promise((resolve) => {
    doc.on('end', () => {
      resolve(Buffer.concat(buffers));
    });
  });
}

async function addHeader(doc: PDFKit.PDFDocument, data: CertificateData) {
  // Logo (if available)
  // doc.image('path/to/logo.png', 50, 40, { width: 60 });
  
  doc
    .font('Helvetica-Bold')
    .fontSize(24)
    .fillColor(COLORS.primary)
    .text('VACCINATION CERTIFICATE', { align: 'center' });
  
  doc
    .font('Helvetica')
    .fontSize(14)
    .fillColor(COLORS.secondary)
    .text(data.campaign.organizer, { align: 'center' });
  
  doc.moveDown();
  
  // Horizontal line
  doc
    .strokeColor(COLORS.border)
    .lineWidth(1)
    .moveTo(50, doc.y)
    .lineTo(545, doc.y)
    .stroke();
  
  doc.moveDown();
}

function addCertificateNumber(doc: PDFKit.PDFDocument, data: CertificateData) {
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(COLORS.text);
  
  doc.text(`Certificate No: ${data.certificateToken}`, { align: 'right' });
  doc.text(`Issued: ${formatDate(data.issuedAt)}`, { align: 'right' });
  
  doc.moveDown();
}

function addSection(
  doc: PDFKit.PDFDocument,
  title: string,
  fields: Array<{ label: string; value: string }>
) {
  // Section title
  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(COLORS.primary)
    .text(title);
  
  doc.moveDown(0.3);
  
  // Section box
  const startY = doc.y;
  const boxHeight = fields.length * 18 + 20;
  
  doc
    .rect(50, startY, 495, boxHeight)
    .fillColor(COLORS.lightBg)
    .fill();
  
  doc
    .rect(50, startY, 495, boxHeight)
    .strokeColor(COLORS.border)
    .stroke();
  
  doc.y = startY + 10;
  
  // Fields
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.text);
  
  for (const field of fields) {
    doc.text(`${field.label}:`, 60, doc.y, { continued: true, width: 120 });
    doc.text(field.value, { width: 350 });
    doc.moveDown(0.3);
  }
  
  doc.y = startY + boxHeight + 10;
}

function addNextDueHighlight(doc: PDFKit.PDFDocument, nextDueDate: Date) {
  const boxY = doc.y;
  const boxHeight = 30;
  
  doc
    .rect(100, boxY, 395, boxHeight)
    .fillColor(COLORS.accent)
    .fill();
  
  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor('#ffffff')
    .text(
      `NEXT VACCINATION DUE: ${formatDate(nextDueDate)}`,
      100,
      boxY + 9,
      { align: 'center', width: 395 }
    );
  
  doc.y = boxY + boxHeight + 20;
}

async function addVerificationSection(
  doc: PDFKit.PDFDocument,
  data: CertificateData
) {
  // Generate QR code
  const qrDataUrl = await QRCode.toDataURL(data.verification.verifyUrl, {
    width: 120,
    margin: 1,
    errorCorrectionLevel: 'H',
  });
  
  // QR code image
  doc.image(qrDataUrl, 50, doc.y, { width: 100 });
  
  // Verification text
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(COLORS.primary)
    .text('VERIFICATION', 170, doc.y);
  
  doc.moveDown(0.3);
  
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(COLORS.text)
    .text('Scan this QR code or visit:', 170)
    .fillColor(COLORS.secondary)
    .text(data.verification.verifyUrl, 170);
  
  doc.y += 80;
}

function addFooter(doc: PDFKit.PDFDocument, data: CertificateData) {
  // Horizontal line
  doc
    .strokeColor(COLORS.border)
    .lineWidth(0.5)
    .moveTo(50, doc.y)
    .lineTo(545, doc.y)
    .stroke();
  
  doc.moveDown();
  
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(COLORS.text)
    .text(
      `This certificate is issued under the ${data.campaign.name} by ${data.campaign.organizer}.`,
      { align: 'center' }
    );
  
  doc.text(
    'For verification, scan the QR code above or contact: support@bpa.com.bd | 09612-345678',
    { align: 'center' }
  );
}

function formatDate(date: Date): string {
  return format(date, 'dd MMMM yyyy');
}

function formatPhone(phone: string): string {
  // Format as 01712-345678
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 11) {
    return `${cleaned.slice(0, 5)}-${cleaned.slice(5)}`;
  }
  return phone;
}
```

---

## 5. Digital Certificate (Web View)

### 5.1 React Component

```tsx
// components/Certificate.tsx

interface CertificateViewProps {
  data: CertificateData;
}

export function CertificateView({ data }: CertificateViewProps) {
  return (
    <div className="max-w-2xl mx-auto bg-white shadow-lg rounded-lg overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-800 text-white p-6 text-center">
        <h1 className="text-2xl font-bold">Vaccination Certificate</h1>
        <p className="text-blue-100">{data.campaign.organizer}</p>
      </div>
      
      {/* Certificate Number */}
      <div className="bg-gray-50 px-6 py-3 border-b flex justify-between text-sm">
        <span>Certificate No: <strong>{data.certificateToken}</strong></span>
        <span>Issued: {formatDate(data.issuedAt)}</span>
      </div>
      
      {/* Verification Badge */}
      <div className="bg-green-50 px-6 py-3 border-b flex items-center justify-center gap-2">
        <CheckCircleIcon className="w-5 h-5 text-green-600" />
        <span className="text-green-700 font-medium">Verified Certificate</span>
      </div>
      
      {/* Content */}
      <div className="p-6 space-y-6">
        {/* Pet Information */}
        <Section title="Pet Information">
          <InfoRow label="Name" value={data.pet.name} />
          <InfoRow label="Species" value={data.pet.species} />
          <InfoRow label="Breed" value={data.pet.breed || '-'} />
          <InfoRow label="Gender" value={data.pet.gender || '-'} />
        </Section>
        
        {/* Owner Information */}
        <Section title="Owner Information">
          <InfoRow label="Name" value={data.owner.name} />
          <InfoRow label="Phone" value={maskPhone(data.owner.phone)} />
        </Section>
        
        {/* Vaccination Details */}
        <Section title="Vaccination Details">
          <InfoRow label="Vaccine" value={data.vaccination.vaccineName} />
          <InfoRow label="Batch No" value={data.vaccination.batchNumber} />
          <InfoRow label="Date" value={formatDate(data.vaccination.administeredAt)} />
          <InfoRow label="Location" value={data.administration.location} />
        </Section>
        
        {/* Next Due Date */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-center">
          <p className="text-amber-700 text-sm">Next Vaccination Due</p>
          <p className="text-amber-900 text-xl font-bold">
            {formatDate(data.vaccination.nextDueDate)}
          </p>
        </div>
        
        {/* QR Code */}
        <div className="text-center">
          <QRCodeSVG
            value={data.verification.verifyUrl}
            size={150}
            level="H"
            className="mx-auto"
          />
          <p className="text-gray-500 text-xs mt-2">Scan to verify</p>
        </div>
      </div>
      
      {/* Actions */}
      <div className="bg-gray-50 px-6 py-4 border-t flex gap-3 justify-center">
        <Button
          variant="primary"
          onClick={() => downloadPdf(data.certificateToken)}
        >
          <DownloadIcon className="w-4 h-4 mr-2" />
          Download PDF
        </Button>
        <Button
          variant="secondary"
          onClick={() => shareCertificate(data.verification.verifyUrl)}
        >
          <ShareIcon className="w-4 h-4 mr-2" />
          Share
        </Button>
      </div>
      
      {/* Footer */}
      <div className="px-6 py-4 text-center text-xs text-gray-500">
        <p>Issued by {data.campaign.organizer}</p>
        <p>Questions? Contact support@bpa.com.bd</p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
        {title}
      </h3>
      <div className="bg-gray-50 rounded-lg p-4 space-y-2">
        {children}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-600">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function maskPhone(phone: string): string {
  // Show: 01712***678
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length >= 8) {
    return `${cleaned.slice(0, 5)}***${cleaned.slice(-3)}`;
  }
  return phone;
}
```

---

## 6. Certificate Verification

### 6.1 Public Verification Page

```tsx
// pages/verify/[token].tsx

export default function VerifyPage({ certificate }: { certificate: CertificateData | null }) {
  if (!certificate) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="bg-white p-8 rounded-lg shadow-lg text-center max-w-md">
          <XCircleIcon className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">
            Certificate Not Found
          </h1>
          <p className="text-gray-600 mb-4">
            This certificate could not be verified. It may be invalid or revoked.
          </p>
          <a
            href="https://bpa.com.bd/contact"
            className="text-blue-600 hover:underline"
          >
            Contact Support
          </a>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <div className="max-w-2xl mx-auto px-4">
        {/* Verification Status */}
        <div className="bg-green-100 border border-green-300 rounded-lg p-4 mb-6 flex items-center gap-3">
          <CheckCircleIcon className="w-8 h-8 text-green-600" />
          <div>
            <p className="font-bold text-green-800">Valid Certificate</p>
            <p className="text-green-700 text-sm">
              This vaccination record has been verified.
            </p>
          </div>
        </div>
        
        {/* Certificate Card */}
        <CertificateView data={certificate} />
      </div>
    </div>
  );
}

export async function getServerSideProps({ params }: { params: { token: string } }) {
  const certificate = await verifyCertificate(params.token);
  
  return {
    props: {
      certificate: certificate ? serializeCertificate(certificate) : null,
    },
  };
}
```

### 6.2 Verification API

```typescript
// GET /campaign-certificate/:token/verify

async function verifyCertificate(token: string) {
  const vaccination = await prisma.vaccination.findUnique({
    where: { certificateToken: token },
    include: {
      pet: {
        include: { breed: true, animalType: true },
      },
      vaccineType: true,
      campaignBooking: {
        include: {
          campaign: true,
          location: true,
        },
      },
    },
  });
  
  if (!vaccination) {
    return null;
  }
  
  // Check if voided
  if (vaccination.status === 'VOIDED') {
    return {
      valid: false,
      reason: 'REVOKED',
      message: 'This certificate has been revoked',
    };
  }
  
  // Build response (limited public info)
  return {
    valid: true,
    certificate: {
      token: vaccination.certificateToken,
      pet: {
        name: vaccination.pet.name,
        species: vaccination.pet.animalType.name,
        breed: vaccination.pet.breed?.name,
      },
      vaccination: {
        name: vaccination.vaccineType.name,
        date: vaccination.administeredAt,
        nextDue: vaccination.nextDueDate,
      },
      issuer: 'Bangladesh Pet Alliance',
      campaign: vaccination.campaignBooking?.campaign.name,
    },
  };
}
```

---

## 7. Certificate Revocation

### 7.1 Revocation Reasons

- Vaccination record voided (error correction)
- Fraudulent certificate reported
- Administrative revocation

### 7.2 Revocation Process

```typescript
async function revokeCertificate(
  certificateToken: string,
  reason: string,
  adminUserId: number
) {
  const vaccination = await prisma.vaccination.findUnique({
    where: { certificateToken },
    include: { campaignBooking: true },
  });
  
  if (!vaccination) {
    throw new ApiError('CERTIFICATE_NOT_FOUND', 404);
  }
  
  // Update vaccination status
  await prisma.vaccination.update({
    where: { id: vaccination.id },
    data: {
      status: 'VOIDED',
      voidReason: reason,
      voidedAt: new Date(),
      voidedByUserId: adminUserId,
    },
  });
  
  // Clear cached PDF
  await redis.del(`cert:pdf:${certificateToken}`);
  
  // Audit log
  await logAudit({
    campaignId: vaccination.campaignBooking?.campaignId,
    action: 'CERTIFICATE_REVOKED',
    entityType: 'VACCINATION',
    entityId: vaccination.id,
    actorUserId: adminUserId,
    metadataJson: { reason },
  });
  
  return { revoked: true };
}
```

---

## 8. Certificate Reissuance

### 8.1 Regenerate Certificate

```typescript
async function regenerateCertificate(
  vaccinationId: number,
  reason: string,
  staffUserId: number
) {
  const vaccination = await prisma.vaccination.findUnique({
    where: { id: vaccinationId },
  });
  
  if (!vaccination) {
    throw new ApiError('VACCINATION_NOT_FOUND', 404);
  }
  
  if (vaccination.status === 'VOIDED') {
    throw new ApiError('VACCINATION_VOIDED', 'Cannot reissue voided vaccination', 400);
  }
  
  // Generate new token
  const newToken = generateCertificateToken();
  
  // Update record
  await prisma.vaccination.update({
    where: { id: vaccinationId },
    data: {
      certificateToken: newToken,
    },
  });
  
  // Clear old cached PDF (if any)
  if (vaccination.certificateToken) {
    await redis.del(`cert:pdf:${vaccination.certificateToken}`);
  }
  
  // Audit log
  await logAudit({
    action: 'CERTIFICATE_REGENERATED',
    entityType: 'VACCINATION',
    entityId: vaccinationId,
    actorUserId: staffUserId,
    metadataJson: {
      reason,
      oldToken: vaccination.certificateToken,
      newToken,
    },
  });
  
  return {
    newToken,
    verifyUrl: `https://vacc.bpa.com.bd/verify/${newToken}`,
    pdfUrl: `https://api.bpa.com.bd/api/v1/campaign-certificate/${newToken}/pdf`,
  };
}
```

---

## 9. Multi-Pet Certificates

When multiple pets are vaccinated in one booking, each pet receives an individual certificate. Options for combined view:

### 9.1 Family Certificate View

```tsx
// View all certificates for a booking
function BookingCertificates({ bookingRef }: { bookingRef: string }) {
  const { data: certificates } = useCertificatesByBooking(bookingRef);
  
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Vaccination Certificates</h2>
      <p className="text-gray-600">
        {certificates.length} certificate(s) issued for this booking
      </p>
      
      {certificates.map((cert) => (
        <CertificateCard
          key={cert.certificateToken}
          petName={cert.pet.name}
          vaccineName={cert.vaccination.vaccineName}
          date={cert.vaccination.administeredAt}
          downloadUrl={cert.pdfUrl}
        />
      ))}
      
      <Button onClick={() => downloadAllPdfs(certificates)}>
        Download All Certificates (ZIP)
      </Button>
    </div>
  );
}
```

---

## 10. Accessibility & Localization

### 10.1 Bengali Language Support

```typescript
const CERTIFICATE_LABELS = {
  en: {
    title: 'VACCINATION CERTIFICATE',
    petInfo: 'PET INFORMATION',
    ownerInfo: 'OWNER INFORMATION',
    vaccInfo: 'VACCINATION DETAILS',
    nextDue: 'NEXT VACCINATION DUE',
    verify: 'VERIFICATION',
    scanQr: 'Scan this QR code or visit:',
  },
  bn: {
    title: 'টিকাদান সনদপত্র',
    petInfo: 'পোষা প্রাণীর তথ্য',
    ownerInfo: 'মালিকের তথ্য',
    vaccInfo: 'টিকাদানের বিবরণ',
    nextDue: 'পরবর্তী টিকাদানের তারিখ',
    verify: 'যাচাইকরণ',
    scanQr: 'এই QR কোড স্ক্যান করুন অথবা দেখুন:',
  },
};

async function generateCertificatePdf(
  data: CertificateData,
  language: 'en' | 'bn' = 'en'
) {
  const labels = CERTIFICATE_LABELS[language];
  // Use labels in PDF generation...
}
```

### 10.2 Print Optimization

```css
@media print {
  .certificate-container {
    width: 210mm;
    height: 297mm;
    margin: 0;
    padding: 15mm;
    page-break-after: always;
  }
  
  .no-print {
    display: none !important;
  }
  
  .qr-code {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
```

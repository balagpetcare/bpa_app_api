# Verification Design Document

## 2026 Cat Flu + Rabies Vaccination Campaign

---

## 1. Overview

The verification system enables anyone to validate vaccination certificates using QR codes or certificate numbers.

---

## 2. Verification Methods

### 2.1 QR Code Scan
- Scan QR code on certificate
- Opens verification URL in browser
- Shows verification result

### 2.2 Certificate Number Entry
- Manual entry of certificate number (CERT-XXXXXXXXXXXX)
- Used when QR code is damaged or unavailable

### 2.3 API Verification
- Programmatic verification for third-party systems
- Returns structured verification response

---

## 3. Public Verification Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       PUBLIC VERIFICATION FLOW                               │
└─────────────────────────────────────────────────────────────────────────────┘

[Scan QR Code] ──or── [Enter Certificate Number]
        │                        │
        └────────────┬───────────┘
                     │
                     ▼
            [Verification Page]
                     │
                     ▼
            [API: GET /verify/:token]
                     │
         ┌───────────┴───────────┐
         │                       │
     [FOUND]                 [NOT FOUND]
         │                       │
         ▼                       ▼
[Check Status]           [Show "Invalid Certificate"]
         │
    ┌────┴────┐
    │         │
[ACTIVE]  [VOIDED]
    │         │
    ▼         ▼
[Show Valid   [Show "Certificate
 Certificate]   Revoked"]
```

---

## 4. Verification API

### 4.1 Public Verification Endpoint

```typescript
// GET /api/v1/campaign-certificate/:token/verify

interface VerificationResponse {
  valid: boolean;
  status: 'VALID' | 'INVALID' | 'REVOKED' | 'EXPIRED';
  certificate?: {
    token: string;
    issuedAt: string;
    pet: {
      name: string;
      species: string;
      breed?: string;
    };
    vaccination: {
      name: string;
      administeredDate: string;
      nextDueDate: string;
    };
    issuer: string;
    campaign?: string;
  };
  message?: string;
}

async function verifyCertificatePublic(token: string): Promise<VerificationResponse> {
  // Validate token format
  if (!isValidTokenFormat(token)) {
    return {
      valid: false,
      status: 'INVALID',
      message: 'Invalid certificate format',
    };
  }
  
  // Look up vaccination record
  const vaccination = await prisma.vaccination.findUnique({
    where: { certificateToken: token },
    include: {
      pet: {
        include: { breed: true, animalType: true },
      },
      vaccineType: true,
      campaignBooking: {
        include: { campaign: true },
      },
    },
  });
  
  if (!vaccination) {
    // Log verification attempt for security monitoring
    await logVerificationAttempt(token, 'NOT_FOUND');
    
    return {
      valid: false,
      status: 'INVALID',
      message: 'Certificate not found',
    };
  }
  
  // Check if revoked/voided
  if (vaccination.status === 'VOIDED') {
    await logVerificationAttempt(token, 'REVOKED');
    
    return {
      valid: false,
      status: 'REVOKED',
      message: 'This certificate has been revoked',
    };
  }
  
  // Valid certificate
  await logVerificationAttempt(token, 'VALID');
  
  return {
    valid: true,
    status: 'VALID',
    certificate: {
      token: vaccination.certificateToken!,
      issuedAt: vaccination.administeredAt.toISOString(),
      pet: {
        name: vaccination.pet.name,
        species: vaccination.pet.animalType.name,
        breed: vaccination.pet.breed?.name,
      },
      vaccination: {
        name: vaccination.vaccineType.name,
        administeredDate: vaccination.administeredAt.toISOString(),
        nextDueDate: vaccination.nextDueDate?.toISOString() || 'N/A',
      },
      issuer: 'Bangladesh Pet Alliance',
      campaign: vaccination.campaignBooking?.campaign.name,
    },
  };
}

function isValidTokenFormat(token: string): boolean {
  // CERT-XXXXXXXXXXXX format
  return /^CERT-[A-Z0-9]{12}$/i.test(token);
}
```

### 4.2 Verification Logging

```typescript
interface VerificationLog {
  token: string;
  result: 'VALID' | 'INVALID' | 'REVOKED' | 'NOT_FOUND';
  ipAddress: string;
  userAgent: string;
  timestamp: Date;
}

async function logVerificationAttempt(
  token: string,
  result: string,
  context?: { ip?: string; userAgent?: string }
) {
  await prisma.certificateVerificationLog.create({
    data: {
      token,
      result,
      ipAddress: context?.ip || 'unknown',
      userAgent: context?.userAgent?.slice(0, 256),
      timestamp: new Date(),
    },
  });
  
  // Check for suspicious patterns
  await checkVerificationPatterns(token, context?.ip);
}

async function checkVerificationPatterns(token: string, ip?: string) {
  if (!ip) return;
  
  // Rate limit: max 100 verifications per IP per hour
  const hourAgo = new Date(Date.now() - 3600000);
  const count = await prisma.certificateVerificationLog.count({
    where: {
      ipAddress: ip,
      timestamp: { gte: hourAgo },
    },
  });
  
  if (count > 100) {
    console.warn(`High verification rate from IP: ${ip}`);
    // Could implement IP blocking or CAPTCHA requirement
  }
  
  // Check for repeated invalid attempts on same token
  const invalidCount = await prisma.certificateVerificationLog.count({
    where: {
      token,
      result: { in: ['INVALID', 'NOT_FOUND'] },
      timestamp: { gte: hourAgo },
    },
  });
  
  if (invalidCount > 10) {
    console.warn(`Suspicious verification attempts for token: ${token}`);
  }
}
```

---

## 5. Verification Page UI

### 5.1 Verification States

```tsx
// components/VerificationResult.tsx

type VerificationState = 'loading' | 'valid' | 'invalid' | 'revoked' | 'error';

function VerificationResult({ token }: { token: string }) {
  const [state, setState] = useState<VerificationState>('loading');
  const [certificate, setCertificate] = useState<Certificate | null>(null);
  
  useEffect(() => {
    verifyToken(token);
  }, [token]);
  
  async function verifyToken(token: string) {
    try {
      const response = await fetch(`/api/v1/campaign-certificate/${token}/verify`);
      const data = await response.json();
      
      if (data.valid) {
        setState('valid');
        setCertificate(data.certificate);
      } else if (data.status === 'REVOKED') {
        setState('revoked');
      } else {
        setState('invalid');
      }
    } catch (error) {
      setState('error');
    }
  }
  
  return (
    <div className="verification-container">
      {state === 'loading' && <LoadingSpinner />}
      {state === 'valid' && <ValidCertificate certificate={certificate!} />}
      {state === 'invalid' && <InvalidCertificate />}
      {state === 'revoked' && <RevokedCertificate />}
      {state === 'error' && <ErrorMessage />}
    </div>
  );
}

function ValidCertificate({ certificate }: { certificate: Certificate }) {
  return (
    <div className="bg-white rounded-lg shadow-lg overflow-hidden max-w-md mx-auto">
      {/* Success Header */}
      <div className="bg-green-500 p-4 text-center">
        <CheckCircleIcon className="w-12 h-12 text-white mx-auto" />
        <h1 className="text-xl font-bold text-white mt-2">
          Valid Certificate
        </h1>
      </div>
      
      {/* Certificate Details */}
      <div className="p-6 space-y-4">
        <DetailRow label="Pet Name" value={certificate.pet.name} />
        <DetailRow label="Species" value={certificate.pet.species} />
        <DetailRow label="Vaccine" value={certificate.vaccination.name} />
        <DetailRow 
          label="Date" 
          value={formatDate(certificate.vaccination.administeredDate)} 
        />
        <DetailRow label="Issued By" value={certificate.issuer} />
        
        <div className="border-t pt-4 mt-4">
          <p className="text-sm text-gray-500 text-center">
            Certificate: {certificate.token}
          </p>
        </div>
      </div>
    </div>
  );
}

function InvalidCertificate() {
  return (
    <div className="bg-white rounded-lg shadow-lg overflow-hidden max-w-md mx-auto">
      <div className="bg-red-500 p-4 text-center">
        <XCircleIcon className="w-12 h-12 text-white mx-auto" />
        <h1 className="text-xl font-bold text-white mt-2">
          Invalid Certificate
        </h1>
      </div>
      
      <div className="p-6 text-center">
        <p className="text-gray-600 mb-4">
          This certificate could not be verified. It may be:
        </p>
        <ul className="text-left text-gray-500 space-y-2 mb-6">
          <li>• Invalid or counterfeit</li>
          <li>• Entered incorrectly</li>
          <li>• From a different system</li>
        </ul>
        
        <p className="text-sm text-gray-500">
          If you believe this is an error, please contact:
          <br />
          <a href="mailto:support@bpa.com.bd" className="text-blue-600">
            support@bpa.com.bd
          </a>
        </p>
      </div>
    </div>
  );
}

function RevokedCertificate() {
  return (
    <div className="bg-white rounded-lg shadow-lg overflow-hidden max-w-md mx-auto">
      <div className="bg-amber-500 p-4 text-center">
        <ExclamationTriangleIcon className="w-12 h-12 text-white mx-auto" />
        <h1 className="text-xl font-bold text-white mt-2">
          Certificate Revoked
        </h1>
      </div>
      
      <div className="p-6 text-center">
        <p className="text-gray-600 mb-4">
          This certificate has been revoked and is no longer valid.
        </p>
        <p className="text-sm text-gray-500">
          Possible reasons:
        </p>
        <ul className="text-left text-gray-500 space-y-2 mt-2 mb-6">
          <li>• Record correction required</li>
          <li>• Certificate reported as fraudulent</li>
          <li>• Administrative action</li>
        </ul>
        
        <p className="text-sm text-gray-500">
          Contact us for more information:
          <br />
          <a href="tel:+8809612345678" className="text-blue-600">
            09612-345678
          </a>
        </p>
      </div>
    </div>
  );
}
```

### 5.2 Manual Entry Form

```tsx
function ManualVerificationForm() {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();
  
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    
    // Validate format
    const cleanToken = token.toUpperCase().trim();
    
    if (!cleanToken) {
      setError('Please enter a certificate number');
      return;
    }
    
    // Auto-prefix CERT- if not present
    let finalToken = cleanToken;
    if (!finalToken.startsWith('CERT-')) {
      if (/^[A-Z0-9]{12}$/.test(finalToken)) {
        finalToken = `CERT-${finalToken}`;
      }
    }
    
    if (!/^CERT-[A-Z0-9]{12}$/.test(finalToken)) {
      setError('Invalid certificate format. Expected: CERT-XXXXXXXXXXXX');
      return;
    }
    
    router.push(`/verify/${finalToken}`);
  }
  
  return (
    <form onSubmit={handleSubmit} className="max-w-md mx-auto">
      <label className="block text-sm font-medium text-gray-700 mb-2">
        Certificate Number
      </label>
      
      <input
        type="text"
        value={token}
        onChange={(e) => {
          setToken(e.target.value);
          setError('');
        }}
        placeholder="CERT-XXXXXXXXXXXX"
        className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
      />
      
      {error && (
        <p className="text-red-500 text-sm mt-1">{error}</p>
      )}
      
      <button
        type="submit"
        className="w-full mt-4 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700"
      >
        Verify Certificate
      </button>
    </form>
  );
}
```

---

## 6. QR Code Scanner

### 6.1 Web-based Scanner

```tsx
import { QrReader } from 'react-qr-reader';

function QrVerificationScanner() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  
  function handleScan(result: string | null) {
    if (!result) return;
    
    try {
      const url = new URL(result);
      
      // Check if it's our verification URL
      if (url.hostname === 'vacc.bpa.com.bd' && url.pathname.startsWith('/verify/')) {
        const token = url.pathname.split('/verify/')[1];
        router.push(`/verify/${token}`);
      } else {
        setError('Invalid QR code. Please scan a BPA vaccination certificate.');
      }
    } catch {
      // Not a URL, try to extract token directly
      if (/^CERT-[A-Z0-9]{12}$/i.test(result)) {
        router.push(`/verify/${result}`);
      } else {
        setError('Invalid QR code format');
      }
    }
  }
  
  return (
    <div className="max-w-md mx-auto">
      <div className="bg-black rounded-lg overflow-hidden">
        <QrReader
          constraints={{ facingMode: 'environment' }}
          onResult={(result) => {
            if (result) {
              handleScan(result.getText());
            }
          }}
          scanDelay={300}
          containerStyle={{ paddingTop: '100%' }}
          videoContainerStyle={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
          }}
        />
      </div>
      
      {error && (
        <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}
      
      <div className="mt-4 text-center">
        <p className="text-sm text-gray-500">
          Point your camera at a vaccination certificate QR code
        </p>
        <button
          onClick={() => router.push('/verify')}
          className="mt-2 text-blue-600 text-sm hover:underline"
        >
          Or enter certificate number manually
        </button>
      </div>
    </div>
  );
}
```

---

## 7. Third-Party Integration

### 7.1 API Authentication (Optional)

For trusted third parties requiring bulk verification:

```typescript
// API Key authentication for bulk verification

interface BulkVerificationRequest {
  tokens: string[];  // Max 100 per request
}

interface BulkVerificationResponse {
  results: Array<{
    token: string;
    valid: boolean;
    status: string;
    certificate?: Partial<Certificate>;
  }>;
}

// POST /api/v1/campaign-certificate/verify/bulk
// Header: X-API-Key: <api_key>

async function bulkVerify(
  tokens: string[],
  apiKey: string
): Promise<BulkVerificationResponse> {
  // Validate API key
  const client = await validateApiKey(apiKey);
  if (!client) {
    throw new ApiError('UNAUTHORIZED', 401);
  }
  
  // Rate limit
  if (tokens.length > 100) {
    throw new ApiError('TOO_MANY_TOKENS', 'Maximum 100 tokens per request', 400);
  }
  
  // Verify all tokens
  const results = await Promise.all(
    tokens.map(async (token) => {
      const result = await verifyCertificatePublic(token);
      return {
        token,
        valid: result.valid,
        status: result.status,
        certificate: result.certificate,
      };
    })
  );
  
  // Log bulk verification
  await logBulkVerification(client.id, tokens.length);
  
  return { results };
}
```

### 7.2 Webhook Notifications

```typescript
// Notify third parties of certificate events

interface WebhookPayload {
  event: 'certificate.issued' | 'certificate.revoked';
  timestamp: string;
  certificate: {
    token: string;
    petName: string;
    vaccineName: string;
    issuedAt: string;
  };
}

async function notifyWebhookSubscribers(
  event: string,
  certificate: Vaccination
) {
  const subscribers = await prisma.webhookSubscription.findMany({
    where: {
      events: { has: event },
      isActive: true,
    },
  });
  
  const payload: WebhookPayload = {
    event: event as WebhookPayload['event'],
    timestamp: new Date().toISOString(),
    certificate: {
      token: certificate.certificateToken!,
      petName: certificate.pet.name,
      vaccineName: certificate.vaccineType.name,
      issuedAt: certificate.administeredAt.toISOString(),
    },
  };
  
  for (const subscriber of subscribers) {
    await webhookQueue.add('send-webhook', {
      url: subscriber.url,
      payload,
      secret: subscriber.secret,
    });
  }
}
```

---

## 8. Security Measures

### 8.1 Rate Limiting

```typescript
const VERIFICATION_LIMITS = {
  perIp: {
    windowMs: 60 * 1000,  // 1 minute
    max: 30,              // 30 requests per minute
  },
  perToken: {
    windowMs: 60 * 1000,
    max: 10,              // Same token 10 times per minute
  },
};

async function rateLimitVerification(
  token: string,
  ip: string
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const ipKey = `verify:ip:${ip}`;
  const tokenKey = `verify:token:${token}`;
  
  const [ipCount, tokenCount] = await Promise.all([
    redis.incr(ipKey),
    redis.incr(tokenKey),
  ]);
  
  // Set expiry on first increment
  if (ipCount === 1) {
    await redis.expire(ipKey, 60);
  }
  if (tokenCount === 1) {
    await redis.expire(tokenKey, 60);
  }
  
  if (ipCount > VERIFICATION_LIMITS.perIp.max) {
    const ttl = await redis.ttl(ipKey);
    return { allowed: false, retryAfter: ttl };
  }
  
  if (tokenCount > VERIFICATION_LIMITS.perToken.max) {
    const ttl = await redis.ttl(tokenKey);
    return { allowed: false, retryAfter: ttl };
  }
  
  return { allowed: true };
}
```

### 8.2 CAPTCHA Protection

```tsx
// After N failed verifications from same IP, require CAPTCHA

function VerificationWithCaptcha() {
  const [requiresCaptcha, setRequiresCaptcha] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  
  async function handleVerify(token: string) {
    const response = await fetch('/api/verify-check', {
      method: 'POST',
      body: JSON.stringify({ token, captchaToken }),
    });
    
    const data = await response.json();
    
    if (data.requiresCaptcha) {
      setRequiresCaptcha(true);
      return;
    }
    
    // Proceed with verification
  }
  
  return (
    <div>
      {requiresCaptcha && (
        <ReCAPTCHA
          sitekey={RECAPTCHA_SITE_KEY}
          onChange={(token) => setCaptchaToken(token)}
        />
      )}
      
      <ManualVerificationForm
        onSubmit={handleVerify}
        disabled={requiresCaptcha && !captchaToken}
      />
    </div>
  );
}
```

---

## 9. Analytics & Monitoring

### 9.1 Verification Metrics

```typescript
interface VerificationMetrics {
  totalVerifications: number;
  validCount: number;
  invalidCount: number;
  revokedCount: number;
  uniqueTokensVerified: number;
  uniqueIps: number;
  topVerifiedTokens: Array<{ token: string; count: number }>;
  verificationsByHour: Array<{ hour: number; count: number }>;
}

async function getVerificationMetrics(
  period: 'day' | 'week' | 'month'
): Promise<VerificationMetrics> {
  const since = getStartOfPeriod(period);
  
  const metrics = await prisma.certificateVerificationLog.groupBy({
    by: ['result'],
    where: { timestamp: { gte: since } },
    _count: true,
  });
  
  // ... aggregate other metrics
  
  return {
    totalVerifications: metrics.reduce((sum, m) => sum + m._count, 0),
    validCount: metrics.find(m => m.result === 'VALID')?._count || 0,
    invalidCount: metrics.find(m => m.result === 'INVALID')?._count || 0,
    revokedCount: metrics.find(m => m.result === 'REVOKED')?._count || 0,
    // ... other metrics
  };
}
```

### 9.2 Fraud Detection

```typescript
// Detect potential fraud patterns

interface FraudAlert {
  type: 'HIGH_FAILURE_RATE' | 'SUSPICIOUS_IP' | 'TOKEN_ENUMERATION';
  severity: 'low' | 'medium' | 'high';
  details: Record<string, unknown>;
}

async function detectFraudPatterns(): Promise<FraudAlert[]> {
  const alerts: FraudAlert[] = [];
  const hourAgo = new Date(Date.now() - 3600000);
  
  // Check for high invalid verification rate from single IP
  const suspiciousIps = await prisma.$queryRaw<Array<{ ip: string; failCount: number }>>`
    SELECT ip_address as ip, COUNT(*) as "failCount"
    FROM certificate_verification_logs
    WHERE timestamp > ${hourAgo}
      AND result IN ('INVALID', 'NOT_FOUND')
    GROUP BY ip_address
    HAVING COUNT(*) > 50
  `;
  
  for (const ip of suspiciousIps) {
    alerts.push({
      type: 'HIGH_FAILURE_RATE',
      severity: ip.failCount > 100 ? 'high' : 'medium',
      details: { ip: ip.ip, failCount: ip.failCount },
    });
  }
  
  // Check for sequential token attempts (enumeration)
  const sequentialAttempts = await detectSequentialTokenAttempts();
  if (sequentialAttempts.length > 0) {
    alerts.push({
      type: 'TOKEN_ENUMERATION',
      severity: 'high',
      details: { attempts: sequentialAttempts },
    });
  }
  
  return alerts;
}
```

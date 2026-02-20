# 🔧 BPA MVP Developer Guide
## Complete Technical Implementation Guide

*Version: 1.0.0 | Last Updated: January 2026*

---

## 📋 Table of Contents

1. [Setup & Installation](#1-setup--installation)
2. [API Architecture](#2-api-architecture)
3. [Authentication & Authorization](#3-authentication--authorization)
4. [Module Implementation](#4-module-implementation)
5. [Database Schema](#5-database-schema)
6. [Testing](#6-testing)
7. [Deployment](#7-deployment)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Setup & Installation

### 1.1 Prerequisites

**Required Software:**
- Node.js (v18 or higher)
- PostgreSQL (v14 or higher)
- Docker & Docker Compose (optional)
- Git

**Recommended Tools:**
- VS Code or similar IDE
- Postman (API testing)
- Prisma Studio (database GUI)

### 1.2 Installation Steps

#### Step 1: Clone Repository
```bash
git clone <repository-url>
cd backend-api
```

#### Step 2: Install Dependencies
```bash
npm install
```

#### Step 3: Environment Setup
```bash
# Copy example env file
cp .env.example .env

# Edit .env with your configuration
# Required variables:
# - DATABASE_URL
# - JWT_SECRET
# - MINIO_ENDPOINT
# - MINIO_ACCESS_KEY
# - MINIO_SECRET_KEY
```

#### Step 4: Database Setup
```bash
# Run migrations
npx prisma migrate dev

# Generate Prisma Client
npx prisma generate

# Seed database (optional)
npm run seed
```

#### Step 5: Start Development Server
```bash
npm run dev
```

**Server runs on:** `http://localhost:3000`

### 1.3 Project Structure

```
backend-api/
├── src/
│   ├── api/
│   │   └── v1/
│   │       ├── modules/          # Feature modules
│   │       ├── middlewares/      # Auth, error handling
│   │       └── routes.ts         # Main routes
│   ├── infrastructure/
│   │   ├── db/                   # Database config
│   │   └── media/                # File upload
│   ├── middleware/               # Express middlewares
│   ├── utils/                    # Helper functions
│   └── app.ts                    # Express app setup
├── prisma/
│   ├── schema.prisma             # Database schema
│   └── migrations/               # Migration files
├── .env                          # Environment variables
└── package.json
```

---

## 2. API Architecture

### 2.1 API Structure

**Base URL:** `http://localhost:3000/api/v1`

**Route Pattern:**
```
/api/v1/{module}/{action}
```

**Examples:**
- `GET /api/v1/products` - List products
- `POST /api/v1/products` - Create product
- `GET /api/v1/products/:id` - Get product
- `PATCH /api/v1/products/:id` - Update product
- `DELETE /api/v1/products/:id` - Delete product

### 2.2 Response Format

**Success Response:**
```json
{
  "success": true,
  "data": { ... },
  "message": "Operation successful"
}
```

**Error Response:**
```json
{
  "success": false,
  "message": "Error message",
  "errors": ["Error detail 1", "Error detail 2"]
}
```

### 2.3 HTTP Status Codes

- `200` - OK (Success)
- `201` - Created (Resource created)
- `400` - Bad Request (Validation error)
- `401` - Unauthorized (Not authenticated)
- `403` - Forbidden (No permission)
- `404` - Not Found (Resource not found)
- `500` - Internal Server Error (Server error)

---

## 3. Authentication & Authorization

### 3.1 Authentication Flow

**Login:**
```typescript
POST /api/v1/auth/login
Body: {
  email: string,
  password: string
}
Response: {
  success: true,
  data: {
    user: User,
    cookie: "bpa_auth=..."
  }
}
```

**Logout:**
```typescript
POST /api/v1/auth/logout
Response: {
  success: true,
  message: "Logged out"
}
```

**Get Current User:**
```typescript
GET /api/v1/auth/me
Response: {
  success: true,
  data: User
}
```

### 3.2 Authorization Middleware

**Usage:**
```typescript
import { requireAuth, requirePermission } from '@/middleware/auth.middleware';

// Require authentication
router.get('/products', requireAuth, getProducts);

// Require specific permission
router.post('/products', requireAuth, requirePermission('product.create'), createProduct);
```

**Permission Format:**
- `{resource}.{action}`
- Examples:
  - `product.create`
  - `product.update`
  - `order.view`
  - `inventory.update`

### 3.3 Role-Based Access

**Roles:**
- `SUPER_ADMIN` - Full access
- `ORG_OWNER` - Organization owner
- `BRANCH_MANAGER` - Branch manager
- `STAFF` - General staff
- `VET` - Veterinarian
- `SELLER` - Sales staff

**Role Assignment:**
- Assigned during staff creation
- Can be updated by owner/admin
- Permissions based on role

---

## 4. Module Implementation

### 4.1 Creating a New Module

#### Step 1: Create Module Structure
```bash
mkdir -p src/api/v1/modules/products
cd src/api/v1/modules/products
```

**Files to Create:**
- `products.controller.ts` - Request handlers
- `products.service.ts` - Business logic
- `products.routes.ts` - Route definitions
- `products.validator.ts` - Input validation (optional)

#### Step 2: Controller Example
```typescript
// products.controller.ts
import { Request, Response } from 'express';
import * as service from './products.service';

export const getProducts = async (req: Request, res: Response) => {
  try {
    const products = await service.getProducts({
      branchId: req.query.branchId,
      categoryId: req.query.categoryId,
      page: req.query.page || 1,
      limit: req.query.limit || 20,
    });
    
    return res.status(200).json({
      success: true,
      data: products,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const createProduct = async (req: Request, res: Response) => {
  try {
    const product = await service.createProduct({
      ...req.body,
      createdBy: req.user.id,
    });
    
    return res.status(201).json({
      success: true,
      data: product,
      message: 'Product created successfully',
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};
```

#### Step 3: Service Example
```typescript
// products.service.ts
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export const getProducts = async (options: {
  branchId?: number;
  categoryId?: number;
  page: number;
  limit: number;
}) => {
  const skip = (options.page - 1) * options.limit;
  
  const where: any = {};
  if (options.branchId) {
    where.branchId = options.branchId;
  }
  if (options.categoryId) {
    where.categoryId = options.categoryId;
  }
  
  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip,
      take: options.limit,
      include: {
        category: true,
        variants: true,
      },
    }),
    prisma.product.count({ where }),
  ]);
  
  return {
    items: products,
    pagination: {
      page: options.page,
      limit: options.limit,
      total,
      totalPages: Math.ceil(total / options.limit),
    },
  };
};

export const createProduct = async (data: {
  name: string;
  description?: string;
  categoryId: number;
  price: number;
  createdBy: number;
}) => {
  return await prisma.product.create({
    data: {
      name: data.name,
      description: data.description,
      categoryId: data.categoryId,
      basePrice: data.price,
      createdBy: data.createdBy,
    },
    include: {
      category: true,
    },
  });
};
```

#### Step 4: Routes Example
```typescript
// products.routes.ts
import { Router } from 'express';
import * as controller from './products.controller';
import { requireAuth, requirePermission } from '@/middleware/auth.middleware';

const router = Router();

router.get('/', requireAuth, requirePermission('product.read'), controller.getProducts);
router.post('/', requireAuth, requirePermission('product.create'), controller.createProduct);
router.get('/:id', requireAuth, requirePermission('product.read'), controller.getProduct);
router.patch('/:id', requireAuth, requirePermission('product.update'), controller.updateProduct);
router.delete('/:id', requireAuth, requirePermission('product.delete'), controller.deleteProduct);

export default router;
```

#### Step 5: Register Routes
```typescript
// src/api/v1/routes.ts
import productsRoutes from './modules/products/products.routes';

router.use('/products', productsRoutes);
```

### 4.2 Common Patterns

#### Pagination
```typescript
const page = parseInt(req.query.page) || 1;
const limit = parseInt(req.query.limit) || 20;
const skip = (page - 1) * limit;

const [items, total] = await Promise.all([
  prisma.model.findMany({ skip, take: limit }),
  prisma.model.count(),
]);

return {
  items,
  pagination: {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  },
};
```

#### Filtering
```typescript
const where: any = {};

if (req.query.status) {
  where.status = req.query.status;
}

if (req.query.branchId) {
  where.branchId = parseInt(req.query.branchId);
}

const items = await prisma.model.findMany({ where });
```

#### Sorting
```typescript
const orderBy: any = {};

if (req.query.sortBy) {
  orderBy[req.query.sortBy] = req.query.sortOrder || 'asc';
} else {
  orderBy.createdAt = 'desc'; // Default
}

const items = await prisma.model.findMany({ orderBy });
```

#### Search
```typescript
const search = req.query.search;

const where: any = {
  OR: [
    { name: { contains: search, mode: 'insensitive' } },
    { description: { contains: search, mode: 'insensitive' } },
  ],
};

const items = await prisma.model.findMany({ where });
```

---

## 5. Database Schema

### 5.1 Prisma Schema Structure

**Location:** `prisma/schema.prisma`

**Example Model:**
```prisma
model Product {
  id          Int      @id @default(autoincrement())
  name        String
  description String?
  categoryId  Int
  category    Category @relation(fields: [categoryId], references: [id])
  basePrice   Decimal
  sku         String   @unique
  variants    ProductVariant[]
  images      String[] // Array of image URLs
  branchId    Int?
  branch      Branch?  @relation(fields: [branchId], references: [id])
  createdBy   Int
  creator     User     @relation(fields: [createdBy], references: [id])
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@map("products")
}
```

### 5.2 Creating Migrations

**Create Migration:**
```bash
npx prisma migrate dev --name add_products_table
```

**Apply Migration:**
```bash
npx prisma migrate deploy
```

**Reset Database (Development Only):**
```bash
npx prisma migrate reset
```

### 5.3 Seeding Data

**Location:** `prisma/seed.ts`

**Example:**
```typescript
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Seed categories
  await prisma.category.createMany({
    data: [
      { name: 'Food' },
      { name: 'Medicine' },
      { name: 'Accessories' },
    ],
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

**Run Seed:**
```bash
npm run seed
```

---

## 6. Testing

### 6.1 Unit Tests

**Example Test:**
```typescript
// products.service.test.ts
import { getProducts } from './products.service';
import { PrismaClient } from '@prisma/client';

jest.mock('@prisma/client');

describe('Products Service', () => {
  it('should get products with pagination', async () => {
    const mockProducts = [
      { id: 1, name: 'Product 1' },
      { id: 2, name: 'Product 2' },
    ];
    
    (PrismaClient as any).mockImplementation(() => ({
      product: {
        findMany: jest.fn().mockResolvedValue(mockProducts),
        count: jest.fn().mockResolvedValue(2),
      },
    }));
    
    const result = await getProducts({ page: 1, limit: 20 });
    
    expect(result.items).toHaveLength(2);
    expect(result.pagination.total).toBe(2);
  });
});
```

**Run Tests:**
```bash
npm test
```

### 6.2 API Testing

**Using Postman:**
1. Import collection
2. Set environment variables
3. Run requests
4. Check responses

**Using Jest:**
```typescript
import request from 'supertest';
import app from '../src/app';

describe('Products API', () => {
  it('should get products', async () => {
    const response = await request(app)
      .get('/api/v1/products')
      .set('Cookie', 'bpa_auth=...')
      .expect(200);
    
    expect(response.body.success).toBe(true);
    expect(response.body.data).toBeDefined();
  });
});
```

---

## 7. Deployment

### 7.1 Environment Setup

**Production Environment Variables:**
```env
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@host:5432/db
JWT_SECRET=your-secret-key
MINIO_ENDPOINT=minio.example.com
MINIO_ACCESS_KEY=your-access-key
MINIO_SECRET_KEY=your-secret-key
PORT=3000
```

### 7.2 Build Process

**Build:**
```bash
npm run build
```

**Start Production:**
```bash
npm start
```

### 7.3 Docker Deployment

**Dockerfile:**
```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
```

**Docker Compose:**
```yaml
version: '3.8'
services:
  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://user:pass@db:5432/bpa
    depends_on:
      - db
  
  db:
    image: postgres:14
    environment:
      - POSTGRES_DB=bpa
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

**Deploy:**
```bash
docker-compose up -d
```

---

## 8. Troubleshooting

### 8.1 Common Issues

**Problem: Database Connection Error**

**Solutions:**
1. Check DATABASE_URL in .env
2. Verify PostgreSQL is running
3. Check network connectivity
4. Verify credentials

**Problem: Prisma Client Not Generated**

**Solutions:**
```bash
npx prisma generate
```

**Problem: Migration Fails**

**Solutions:**
1. Check schema syntax
2. Verify database state
3. Try: `npx prisma migrate reset` (dev only)
4. Check migration files

**Problem: Port Already in Use**

**Solutions:**
1. Change PORT in .env
2. Kill process using port 3000
3. Use different port

### 8.2 Debugging

**Enable Debug Logs:**
```typescript
// Add to app.ts
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });
}
```

**Prisma Studio (Database GUI):**
```bash
npx prisma studio
```
Opens at: `http://localhost:5555`

---

## 9. Best Practices

### 9.1 Code Organization

- Keep controllers thin (only request/response handling)
- Put business logic in services
- Use middleware for common functionality
- Validate inputs
- Handle errors properly

### 9.2 Security

- Always validate user input
- Use parameterized queries (Prisma does this)
- Check permissions before operations
- Sanitize file uploads
- Use HTTPS in production

### 9.3 Performance

- Use database indexes
- Implement pagination
- Cache frequently accessed data
- Optimize database queries
- Use connection pooling

### 9.4 Error Handling

**Centralized Error Handler:**
```typescript
// middlewares/errors.ts
export const errorHandler = (err, req, res, next) => {
  console.error(err);
  
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: err.errors,
    });
  }
  
  return res.status(500).json({
    success: false,
    message: 'Internal server error',
  });
};
```

---

## 10. API Documentation

### 10.1 Swagger/OpenAPI

**Install:**
```bash
npm install swagger-ui-express swagger-jsdoc
```

**Setup:**
```typescript
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'BPA API',
      version: '1.0.0',
    },
  },
  apis: ['./src/api/v1/modules/**/*.ts'],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
```

**Access:** `http://localhost:3000/api-docs`

---

## 11. Module Checklist

When creating a new module, ensure:

- [ ] Controller with CRUD operations
- [ ] Service with business logic
- [ ] Routes with authentication
- [ ] Permission checks
- [ ] Input validation
- [ ] Error handling
- [ ] Pagination (for list endpoints)
- [ ] Filtering & sorting
- [ ] Database schema
- [ ] Migration files
- [ ] Unit tests
- [ ] API documentation

---

## 12. Quick Reference

### Common Commands

```bash
# Development
npm run dev              # Start dev server
npm run build            # Build for production
npm start                # Start production server

# Database
npx prisma migrate dev   # Create & apply migration
npx prisma generate      # Generate Prisma Client
npx prisma studio        # Open database GUI
npx prisma seed          # Seed database

# Testing
npm test                 # Run tests
npm run test:watch       # Watch mode
npm run test:coverage    # Coverage report
```

### Common Imports

```typescript
// Express
import { Request, Response, Router } from 'express';

// Prisma
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Auth
import { requireAuth, requirePermission } from '@/middleware/auth.middleware';
```

---

*This guide is continuously updated. Check repository for latest version.*

**Last Updated:** January 2026  
**Version:** 1.0.0  
**For Questions:** dev@bpa.com

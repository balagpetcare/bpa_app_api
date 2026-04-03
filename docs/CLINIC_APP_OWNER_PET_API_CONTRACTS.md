# BPA Clinic + App Owner/Pet Identity — API Contracts

**Purpose:** API surface for unified owner/pet identity. Request/response shapes, error codes, permissions.

**Reference:** [CLINIC_APP_OWNER_PET_IDENTITY_STRATEGY.md](./CLINIC_APP_OWNER_PET_IDENTITY_STRATEGY.md).

---

## 1. Clinic namespace

**Base path:** `GET|POST|PATCH /api/v1/clinic/branches/:branchId/...`  
**Auth:** Required. **Permission:** One of listed clinic permissions per endpoint.

### 1.1 Owner lookup

**Method / path:** `GET /api/v1/clinic/branches/:branchId/patients/owner-lookup?q=`  
**Permission:** clinic.patients.read OR clinic.patients.manage

**Query:** `q` (or `phone` or `email`) — search string.

**Response (200):**

```json
{
  "success": true,
  "data": {
    "id": 1,
    "profile": { "displayName": "John Doe", "username": "john_doe" },
    "auth": { "email": null, "phone": "01777888993" }
  }
}
```

**Error (404):** `{ "success": false, "code": "OWNER_NOT_FOUND", "message": "Owner not found" }`

---

### 1.2 Ensure owner

**Method / path:** `POST /api/v1/clinic/branches/:branchId/patients/ensure-owner`  
**Permission:** clinic.patients.manage

**Request body:**

```json
{
  "phone": "01777888993",
  "displayName": "John Doe"
}
```

**Response (200):**

```json
{
  "success": true,
  "data": {
    "id": 1,
    "profile": { "displayName": "John Doe", "username": "owner_77888993_xxx" },
    "auth": { "email": null, "phone": "01777888993" }
  },
  "message": "Owner found or created"
}
```

**Error (400):** `{ "success": false, "code": "VALIDATION_ERROR", "message": "phone is required" }`

---

### 1.3 List patients

**Method / path:** `GET /api/v1/clinic/branches/:branchId/patients?limit=&offset=&search=&ownerId=`  
**Permission:** clinic.patients.read OR clinic.patients.manage

**Query:** `limit`, `offset`, `search`, `ownerId` (optional — filter by User id).

**Response (200):**

```json
{
  "success": true,
  "data": {
    "patients": [
      {
        "id": 1,
        "name": "Max",
        "uniquePetId": "PET-ABC123",
        "userId": 10,
        "owner": { "userId": 10, "displayName": "John", "email": null, "phone": "01777888993" },
        "animalType": { "id": 1, "name": "Dog" },
        "breed": { "id": 1, "name": "Labrador" }
      }
    ],
    "total": 1
  }
}
```

---

### 1.4 Get patient by petId

**Method / path:** `GET /api/v1/clinic/branches/:branchId/patients/:petId`  
**Permission:** clinic.patients.read OR clinic.patients.manage

**Response (200):** Same shape as single patient (id, name, uniquePetId, userId, owner, animalType, breed, ...).

**Error (404):** `{ "success": false, "code": "PATIENT_NOT_FOUND" }`

---

### 1.5 Get patient by uniquePetId

**Method / path:** `GET /api/v1/clinic/branches/:branchId/patients/unique/:uniquePetId`  
**Permission:** clinic.patients.read OR clinic.patients.manage

**Response (200):** Same as get patient by petId.

**Error (404):** PATIENT_NOT_FOUND

---

### 1.6 Register patient

**Method / path:** `POST /api/v1/clinic/branches/:branchId/patients`  
**Permission:** clinic.patients.manage

**Request body:**

```json
{
  "userId": 10,
  "name": "Max",
  "animalTypeId": 1,
  "breedId": 1,
  "sex": "MALE",
  "dateOfBirth": "2020-01-15",
  "microchipNumber": null,
  "allergies": [],
  "bloodType": null,
  "notes": null,
  "isRescue": false,
  "isNeutered": false
}
```

**Required:** userId, name, animalTypeId.

**Response (201):**

```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "Max",
    "uniquePetId": "PET-XYZ789",
    "userId": 10,
    "owner": { "userId": 10, "displayName": "John", "email": null, "phone": "01777888993" },
    "animalType": { "id": 1, "name": "Dog" },
    "breed": { "id": 1, "name": "Labrador" }
  },
  "message": "Patient registered"
}
```

**Error (400):** VALIDATION_ERROR — e.g. userId, name, or animalTypeId missing.

---

### 1.7 Update patient

**Method / path:** `PATCH /api/v1/clinic/branches/:branchId/patients/:petId`  
**Permission:** clinic.patients.manage

**Request body:** Same fields as register (except userId, animalTypeId) — name, breedId, sex, dateOfBirth, microchipNumber, allergies, bloodType, notes, isRescue, isNeutered, foodHabits, healthDisorders, qrCodeUrl. All optional for PATCH.

**Response (200):** Updated patient object.

**Error (404):** PATIENT_NOT_FOUND

---

### 1.8 Link owner (to be implemented)

**Method / path:** `PATCH /api/v1/clinic/branches/:branchId/patients/:petId/link-owner`  
**Permission:** clinic.patients.manage

**Request body:**

```json
{
  "userId": 10
}
```

**Response (200):** Updated patient (Pet.userId set to new userId).

**Error (400):** userId required or User not found. **Error (404):** PATIENT_NOT_FOUND.

---

### 1.9 Promote appointment

**Method / path:** `POST /api/v1/clinic/branches/:branchId/appointments/:appointmentId/promote`  
**Permission:** clinic.appointments.manage

**Request body:**

```json
{
  "patientId": 10,
  "petId": 1,
  "doctorId": null,
  "notes": null
}
```

**Required:** patientId. petId optional (can be set later).

**Response (200):** Updated appointment; message "Appointment promoted to booked".

**Error (404):** APPOINTMENT_NOT_FOUND. **Error (409):** INVALID_STATUS_TRANSITION.

---

## 2. Owner namespace

**Base path:** `GET /api/v1/owner/...`  
**Auth:** Required (owner session).

### 2.1 List my pets

**Method / path:** `GET /api/v1/owner/me/pets`  
**Permission:** Owner context (req.user.id).

**Response (200):**

```json
{
  "success": true,
  "data": { "pets": [ { "id": 1, "name": "Max", "animalType": { "name": "Dog" }, ... } ] }
}
```

---

### 2.2 Get my pet

**Method / path:** `GET /api/v1/owner/me/pets/:petId`  
**Permission:** Owner; must be pet’s owner (Pet.userId = req.user.id).

**Response (200):** Single pet object.

**Error (404):** If pet not found or not owned by current user.

---

## 3. Pets namespace

**Base path:** `POST /api/v1/pets/...`  
**Auth:** Required.

### 3.1 Register pet (create)

**Method / path:** `POST /api/v1/pets/register` or `POST /api/v1/pets/`  
**Permission:** Authenticated user; Pet.userId = req.user.id.

**Request body:** Same shape as clinic register (name, animalTypeId, breedId, sex, dateOfBirth, microchipNumber, allergies, etc.). userId must NOT be sent — taken from session.

**Response (201):** Created pet.

**Error (400):** Validation. **Error (409):** DUPLICATE_PET if microchipNumber already exists.

---

## 4. Error codes

| Code | HTTP | Meaning |
|------|------|---------|
| OWNER_NOT_FOUND | 404 | No User found for phone/email |
| PATIENT_NOT_FOUND | 404 | Pet not found or not in branch context |
| VALIDATION_ERROR | 400 | Missing or invalid body/params |
| DUPLICATE_PET | 409 | microchipNumber already used |
| APPOINTMENT_NOT_FOUND | 404 | Appointment not found |
| INVALID_STATUS_TRANSITION | 409 | Promote not allowed for current status |

---

## 5. Permission matrix

| Endpoint | Permissions |
|----------|-------------|
| GET patients/owner-lookup | clinic.patients.read, clinic.patients.manage |
| POST patients/ensure-owner | clinic.patients.manage |
| GET patients, GET patients/:petId, GET patients/unique/:uniquePetId | clinic.patients.read, clinic.patients.manage |
| POST patients, PATCH patients/:petId | clinic.patients.manage |
| PATCH patients/:petId/link-owner | clinic.patients.manage (when implemented) |
| POST appointments/:id/promote | clinic.appointments.manage |
| GET /owner/me/pets, GET /owner/me/pets/:petId | Owner (session) |
| POST /pets/register, POST /pets/ | Authenticated |

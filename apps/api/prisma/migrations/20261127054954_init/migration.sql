-- CreateEnum
CREATE TYPE "Role" AS ENUM ('FACTORY_OPERATOR', 'CARRIER_OPERATOR', 'DRIVER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "CarrierStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "DriverStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('APPROVED', 'PENDING_CHANGE');

-- CreateEnum
CREATE TYPE "HallCategory" AS ENUM ('BAG', 'BULK');

-- CreateEnum
CREATE TYPE "PackagingCategory" AS ENUM ('BAG', 'BULK');

-- CreateEnum
CREATE TYPE "Allocation" AS ENUM ('GROUP', 'TIMED', 'FREE');

-- CreateEnum
CREATE TYPE "HallDayStatus" AS ENUM ('SCHEDULED', 'OPEN', 'ALLOCATING', 'CLOSED', 'HALTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Strategy" AS ENUM ('TIMED_PRIORITY_RESERVATION', 'BULK_GROUP_ROTATION', 'FREE_FIRST_COME');

-- CreateEnum
CREATE TYPE "AnnouncementStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FareCalc" AS ENUM ('PER_TRUCK', 'PER_TON');

-- CreateEnum
CREATE TYPE "UnitState" AS ENUM ('OPEN', 'RESERVED', 'CONSUMED', 'CANCELLED', 'HELD');

-- CreateEnum
CREATE TYPE "BagTurnStatus" AS ENUM ('WAITING', 'ALLOCATED', 'NOT_ALLOCATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BulkWindowKind" AS ENUM ('HEAD', 'FREE');

-- CreateEnum
CREATE TYPE "WindowCloseReason" AS ENUM ('TIME', 'EXHAUSTED', 'ALL_RESERVED', 'MANUAL', 'HALL_END', 'HALTED');

-- CreateEnum
CREATE TYPE "ReservationSource" AS ENUM ('TIMED', 'GROUP', 'FREE', 'MANUAL');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('RESERVED', 'ARRIVED', 'LOADED', 'EXITED', 'CANCEL_REQUESTED', 'CANCELLED', 'NO_SHOW', 'RETURNED');

-- CreateEnum
CREATE TYPE "CancelRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PenaltyReason" AS ENUM ('CANCEL_APPROVED', 'MANUAL');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Tehran',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "username" TEXT,
    "mobile" TEXT,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "carrierId" UUID,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "lastLoginAt" TIMESTAMPTZ(3),
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" UUID,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "deviceInfo" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "revokeReason" TEXT,
    "replacedById" UUID,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "actorId" UUID,
    "actorRole" "Role",
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carriers" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "nationalId" TEXT,
    "status" "CarrierStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" UUID,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "carriers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carrier_quotas" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "carrierId" UUID NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "tonnageLimitKg" BIGINT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" UUID,

    CONSTRAINT "carrier_quotas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provinces" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "provinces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cities" (
    "id" INTEGER NOT NULL,
    "provinceId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "destinations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "cityId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" UUID,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "destinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loader_types" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" UUID,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "loader_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packaging_types" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "category" "PackagingCategory" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" UUID,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "packaging_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" UUID,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "halls" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "category" "HallCategory" NOT NULL,
    "defaultAllocation" "Allocation" NOT NULL,
    "terminalName" TEXT,
    "terminalCity" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" UUID,

    CONSTRAINT "halls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hall_schedules" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "hallId" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "t0" TEXT NOT NULL,
    "priorityEnd" TEXT,
    "hallEnd" TEXT NOT NULL,
    "headMinutes" INTEGER,
    "freeMinutes" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" UUID,

    CONSTRAINT "hall_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hall_days" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "hallId" UUID NOT NULL,
    "date" TEXT NOT NULL,
    "t0At" TIMESTAMPTZ(3) NOT NULL,
    "priorityEndAt" TIMESTAMPTZ(3),
    "hallEndAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "HallDayStatus" NOT NULL DEFAULT 'SCHEDULED',
    "policySnapshot" JSONB,
    "turnSeq" INTEGER NOT NULL DEFAULT 0,
    "haltedReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" UUID,

    CONSTRAINT "hall_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_policies" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "hallId" UUID NOT NULL,
    "strategy" "Strategy" NOT NULL,
    "version" INTEGER NOT NULL,
    "params" JSONB NOT NULL,
    "activeFrom" TIMESTAMPTZ(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "queue_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parties" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "carrierId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nationalIdEnc" TEXT NOT NULL,
    "nationalIdHash" TEXT NOT NULL,
    "economicCode" TEXT,
    "addresses" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" UUID,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_owners" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "carrierId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nationalIdEnc" TEXT NOT NULL,
    "nationalIdHash" TEXT NOT NULL,
    "phone" TEXT,
    "mobile" TEXT,
    "otherInfo" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" UUID,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "goods_owners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loading_locations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "carrierId" UUID,
    "warehouseType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nationalCode" TEXT,
    "nature" TEXT,
    "cityId" INTEGER,
    "address" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" UUID,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "loading_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cargo_descriptions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "carrierId" UUID,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" UUID,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "cargo_descriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loading_conditions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "carrierId" UUID,
    "name" TEXT,
    "condition" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" UUID,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "loading_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_files" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "carrierId" UUID NOT NULL,
    "forDate" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "note" TEXT,
    "uploadedBy" UUID NOT NULL,
    "seenAt" TIMESTAMPTZ(3),
    "seenBy" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "daily_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "carrierId" UUID NOT NULL,
    "status" "DriverStatus" NOT NULL DEFAULT 'PENDING',
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "nationalIdEnc" TEXT NOT NULL,
    "nationalIdHash" TEXT NOT NULL,
    "licenseNo" TEXT NOT NULL,
    "licenseIssueDate" DATE NOT NULL,
    "birthCityId" INTEGER,
    "birthDate" DATE,
    "residenceCityId" INTEGER,
    "address" TEXT,
    "postalCode" TEXT,
    "phone" TEXT,
    "bankName" TEXT,
    "accountNo" TEXT,
    "shebaEnc" TEXT,
    "healthCardExpiry" DATE NOT NULL,
    "blockedUntil" TIMESTAMPTZ(3),
    "blockReason" TEXT,
    "decidedBy" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" UUID,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "smartCardNo" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "loaderTypeId" UUID NOT NULL,
    "status" "VehicleStatus" NOT NULL DEFAULT 'APPROVED',
    "pendingChange" JSONB,
    "smartCardExpiry" DATE NOT NULL,
    "inspectionExpiry" DATE NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" UUID,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_penalties" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "reason" "PenaltyReason" NOT NULL,
    "until" TIMESTAMPTZ(3) NOT NULL,
    "sourceReservationId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "driver_penalties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "carrierId" UUID NOT NULL,
    "hallId" UUID NOT NULL,
    "hallDayId" UUID,
    "number" INTEGER NOT NULL,
    "status" "AnnouncementStatus" NOT NULL DEFAULT 'ACTIVE',
    "announceDate" TEXT NOT NULL,
    "announceTime" TEXT NOT NULL,
    "orderCode" TEXT,
    "contractNo" TEXT,
    "unloadCode" TEXT,
    "senderPartyId" UUID,
    "senderName" TEXT,
    "senderNationalIdEnc" TEXT,
    "originCityId" INTEGER,
    "senderPostal" TEXT,
    "senderAddress" TEXT,
    "receiverPartyId" UUID,
    "receiverName" TEXT,
    "receiverNationalIdEnc" TEXT,
    "destCityId" INTEGER,
    "destinationId" UUID,
    "receiverPostal" TEXT,
    "receiverAddress" TEXT,
    "productId" UUID NOT NULL,
    "cargoDescriptionId" UUID,
    "packagingTypeId" UUID NOT NULL,
    "cargoValue" BIGINT NOT NULL,
    "cargoCount" INTEGER,
    "loadingLocationId" UUID NOT NULL,
    "warehouseName" TEXT,
    "loadingDate" TEXT,
    "loadingEndDate" TEXT,
    "loadingFrom" TEXT,
    "loadingTo" TEXT,
    "loadingPlaceText" TEXT,
    "fareCalc" "FareCalc" NOT NULL,
    "loaderTypeId" UUID NOT NULL,
    "loaderType2Id" UUID,
    "truckCount" INTEGER NOT NULL,
    "loaderLength" INTEGER,
    "requestedTruckType" TEXT,
    "weightFromKg" INTEGER NOT NULL,
    "weightToKg" INTEGER NOT NULL,
    "destFareType" TEXT NOT NULL,
    "farePerTruck" BIGINT,
    "ratePerTon" BIGINT,
    "goodsOwnerId" UUID,
    "waybillNote" TEXT,
    "description" TEXT NOT NULL,
    "isFreeOutsideDestinations" BOOLEAN NOT NULL DEFAULT false,
    "extra" JSONB NOT NULL DEFAULT '{}',
    "cancelReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" UUID,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "load_units" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "announcementId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "allocation" "Allocation" NOT NULL,
    "state" "UnitState" NOT NULL DEFAULT 'OPEN',
    "currentReservationId" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "load_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "load_unit_allocation_changes" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "from" "Allocation" NOT NULL,
    "to" "Allocation" NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" UUID NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "load_unit_allocation_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bag_turns" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "hallDayId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "turnNo" INTEGER NOT NULL,
    "registeredAt" TIMESTAMPTZ(6) NOT NULL,
    "status" "BagTurnStatus" NOT NULL DEFAULT 'WAITING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bag_turns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bag_priorities" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "turnId" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "announcementId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bag_priorities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_runs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "hallDayId" UUID NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB NOT NULL,
    "inputHash" TEXT NOT NULL,
    "outputHash" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "finishedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "allocation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulk_groups" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "carrierId" UUID NOT NULL,
    "hallId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" UUID,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "bulk_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulk_group_members" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,
    "reason" TEXT,

    CONSTRAINT "bulk_group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulk_rotation_state" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "carrierId" UUID NOT NULL,
    "hallId" UUID NOT NULL,
    "nextHeadGroupId" UUID,
    "cursorGroupId" UUID,
    "cursorRemaining" UUID[],
    "cursorInitialized" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bulk_rotation_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulk_days" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "carrierId" UUID NOT NULL,
    "hallDayId" UUID NOT NULL,
    "headGroupId" UUID NOT NULL,
    "membersSnapshot" JSONB NOT NULL,
    "stateBefore" JSONB NOT NULL,
    "stateAfter" JSONB,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "haltedReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bulk_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulk_windows" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "bulkDayId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" "BulkWindowKind" NOT NULL,
    "round" INTEGER NOT NULL,
    "groupId" UUID NOT NULL,
    "eligible" UUID[],
    "opensAt" TIMESTAMPTZ(3) NOT NULL,
    "closesAt" TIMESTAMPTZ(3) NOT NULL,
    "closedAt" TIMESTAMPTZ(3),
    "closeReason" "WindowCloseReason",
    "burned" UUID[],
    "carried" UUID[],
    "skipped" UUID[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bulk_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "permitNo" INTEGER NOT NULL,
    "unitId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "carrierId" UUID NOT NULL,
    "source" "ReservationSource" NOT NULL,
    "hallDayId" UUID,
    "bulkWindowId" UUID,
    "allocationRunId" UUID,
    "status" "ReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "statusBeforeCancelRequest" "ReservationStatus",
    "idempotencyKey" TEXT,
    "reservedAt" TIMESTAMPTZ(6) NOT NULL,
    "arrivedAt" TIMESTAMPTZ(3),
    "loadedAt" TIMESTAMPTZ(3),
    "exitedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "returnReason" TEXT,
    "manualReason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "extra" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" UUID,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cancel_requests" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "reservationId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "carrierId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "CancelRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedBy" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cancel_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_events" (
    "seq" BIGSERIAL NOT NULL,
    "tenantId" UUID NOT NULL,
    "hallDayId" UUID,
    "carrierId" UUID,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "actorId" UUID,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "queue_events_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counters" (
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "counters_pkey" PRIMARY KEY ("tenantId","name")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_mobile_key" ON "users"("mobile");

-- CreateIndex
CREATE INDEX "users_tenantId_role_idx" ON "users"("tenantId", "role");

-- CreateIndex
CREATE INDEX "users_carrierId_idx" ON "users"("carrierId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshTokenHash_key" ON "sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_revokedAt_idx" ON "sessions"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "sessions_familyId_idx" ON "sessions"("familyId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_at_idx" ON "audit_logs"("tenantId", "at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entityId_idx" ON "audit_logs"("entity", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_at_idx" ON "audit_logs"("actorId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "carriers_tenantId_code_key" ON "carriers"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "carrier_quotas_carrierId_yearMonth_key" ON "carrier_quotas"("carrierId", "yearMonth");

-- CreateIndex
CREATE UNIQUE INDEX "provinces_name_key" ON "provinces"("name");

-- CreateIndex
CREATE UNIQUE INDEX "cities_provinceId_name_key" ON "cities"("provinceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "destinations_tenantId_cityId_key" ON "destinations"("tenantId", "cityId");

-- CreateIndex
CREATE UNIQUE INDEX "loader_types_tenantId_code_key" ON "loader_types"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "hall_schedules_hallId_weekday_key" ON "hall_schedules"("hallId", "weekday");

-- CreateIndex
CREATE INDEX "hall_days_status_t0At_idx" ON "hall_days"("status", "t0At");

-- CreateIndex
CREATE UNIQUE INDEX "hall_days_hallId_date_key" ON "hall_days"("hallId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "queue_policies_hallId_strategy_version_key" ON "queue_policies"("hallId", "strategy", "version");

-- CreateIndex
CREATE INDEX "parties_carrierId_idx" ON "parties"("carrierId");

-- CreateIndex
CREATE INDEX "goods_owners_carrierId_idx" ON "goods_owners"("carrierId");

-- CreateIndex
CREATE INDEX "loading_locations_carrierId_idx" ON "loading_locations"("carrierId");

-- CreateIndex
CREATE INDEX "cargo_descriptions_carrierId_idx" ON "cargo_descriptions"("carrierId");

-- CreateIndex
CREATE INDEX "loading_conditions_carrierId_idx" ON "loading_conditions"("carrierId");

-- CreateIndex
CREATE UNIQUE INDEX "daily_files_fileKey_key" ON "daily_files"("fileKey");

-- CreateIndex
CREATE INDEX "daily_files_carrierId_forDate_idx" ON "daily_files"("carrierId", "forDate");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_userId_key" ON "drivers"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_nationalIdHash_key" ON "drivers"("nationalIdHash");

-- CreateIndex
CREATE INDEX "drivers_carrierId_status_idx" ON "drivers"("carrierId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_smartCardNo_key" ON "vehicles"("smartCardNo");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_plate_key" ON "vehicles"("plate");

-- CreateIndex
CREATE INDEX "vehicles_driverId_active_idx" ON "vehicles"("driverId", "active");

-- CreateIndex
CREATE INDEX "driver_penalties_driverId_until_idx" ON "driver_penalties"("driverId", "until");

-- CreateIndex
CREATE INDEX "announcements_hallId_status_createdAt_idx" ON "announcements"("hallId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "announcements_carrierId_status_idx" ON "announcements"("carrierId", "status");

-- CreateIndex
CREATE INDEX "announcements_destCityId_status_idx" ON "announcements"("destCityId", "status");

-- CreateIndex
CREATE INDEX "announcements_hallDayId_idx" ON "announcements"("hallDayId");

-- CreateIndex
CREATE UNIQUE INDEX "announcements_tenantId_number_key" ON "announcements"("tenantId", "number");

-- CreateIndex
CREATE INDEX "load_units_announcementId_state_allocation_idx" ON "load_units"("announcementId", "state", "allocation");

-- CreateIndex
CREATE UNIQUE INDEX "load_units_announcementId_seq_key" ON "load_units"("announcementId", "seq");

-- CreateIndex
CREATE INDEX "load_unit_allocation_changes_unitId_idx" ON "load_unit_allocation_changes"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "bag_turns_hallDayId_driverId_key" ON "bag_turns"("hallDayId", "driverId");

-- CreateIndex
CREATE UNIQUE INDEX "bag_turns_hallDayId_turnNo_key" ON "bag_turns"("hallDayId", "turnNo");

-- CreateIndex
CREATE UNIQUE INDEX "bag_priorities_turnId_rank_key" ON "bag_priorities"("turnId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "bag_priorities_turnId_announcementId_key" ON "bag_priorities"("turnId", "announcementId");

-- CreateIndex
CREATE UNIQUE INDEX "allocation_runs_hallDayId_key" ON "allocation_runs"("hallDayId");

-- CreateIndex
CREATE INDEX "bulk_groups_carrierId_hallId_sortOrder_idx" ON "bulk_groups"("carrierId", "hallId", "sortOrder");

-- CreateIndex
CREATE INDEX "bulk_group_members_groupId_idx" ON "bulk_group_members"("groupId");

-- CreateIndex
CREATE INDEX "bulk_group_members_driverId_idx" ON "bulk_group_members"("driverId");

-- CreateIndex
CREATE UNIQUE INDEX "bulk_rotation_state_carrierId_hallId_key" ON "bulk_rotation_state"("carrierId", "hallId");

-- CreateIndex
CREATE UNIQUE INDEX "bulk_days_carrierId_hallDayId_key" ON "bulk_days"("carrierId", "hallDayId");

-- CreateIndex
CREATE UNIQUE INDEX "bulk_windows_bulkDayId_seq_key" ON "bulk_windows"("bulkDayId", "seq");

-- CreateIndex
CREATE INDEX "reservations_driverId_status_idx" ON "reservations"("driverId", "status");

-- CreateIndex
CREATE INDEX "reservations_carrierId_status_reservedAt_idx" ON "reservations"("carrierId", "status", "reservedAt");

-- CreateIndex
CREATE INDEX "reservations_hallDayId_idx" ON "reservations"("hallDayId");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_tenantId_permitNo_key" ON "reservations"("tenantId", "permitNo");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_driverId_idempotencyKey_key" ON "reservations"("driverId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "cancel_requests_carrierId_status_idx" ON "cancel_requests"("carrierId", "status");

-- CreateIndex
CREATE INDEX "queue_events_hallDayId_seq_idx" ON "queue_events"("hallDayId", "seq");

-- CreateIndex
CREATE INDEX "queue_events_carrierId_seq_idx" ON "queue_events"("carrierId", "seq");

-- CreateIndex
CREATE INDEX "queue_events_type_idx" ON "queue_events"("type");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "carriers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carriers" ADD CONSTRAINT "carriers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carrier_quotas" ADD CONSTRAINT "carrier_quotas_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "carriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cities" ADD CONSTRAINT "cities_provinceId_fkey" FOREIGN KEY ("provinceId") REFERENCES "provinces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "destinations" ADD CONSTRAINT "destinations_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "halls" ADD CONSTRAINT "halls_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hall_schedules" ADD CONSTRAINT "hall_schedules_hallId_fkey" FOREIGN KEY ("hallId") REFERENCES "halls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hall_days" ADD CONSTRAINT "hall_days_hallId_fkey" FOREIGN KEY ("hallId") REFERENCES "halls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_policies" ADD CONSTRAINT "queue_policies_hallId_fkey" FOREIGN KEY ("hallId") REFERENCES "halls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_files" ADD CONSTRAINT "daily_files_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "carriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "carriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_penalties" ADD CONSTRAINT "driver_penalties_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "carriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_hallDayId_fkey" FOREIGN KEY ("hallDayId") REFERENCES "hall_days"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_units" ADD CONSTRAINT "load_units_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "announcements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_unit_allocation_changes" ADD CONSTRAINT "load_unit_allocation_changes_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "load_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bag_turns" ADD CONSTRAINT "bag_turns_hallDayId_fkey" FOREIGN KEY ("hallDayId") REFERENCES "hall_days"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bag_turns" ADD CONSTRAINT "bag_turns_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bag_priorities" ADD CONSTRAINT "bag_priorities_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "bag_turns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bag_priorities" ADD CONSTRAINT "bag_priorities_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "announcements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_runs" ADD CONSTRAINT "allocation_runs_hallDayId_fkey" FOREIGN KEY ("hallDayId") REFERENCES "hall_days"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_groups" ADD CONSTRAINT "bulk_groups_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "carriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_group_members" ADD CONSTRAINT "bulk_group_members_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "bulk_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_group_members" ADD CONSTRAINT "bulk_group_members_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_days" ADD CONSTRAINT "bulk_days_hallDayId_fkey" FOREIGN KEY ("hallDayId") REFERENCES "hall_days"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_windows" ADD CONSTRAINT "bulk_windows_bulkDayId_fkey" FOREIGN KEY ("bulkDayId") REFERENCES "bulk_days"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "load_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_hallDayId_fkey" FOREIGN KEY ("hallDayId") REFERENCES "hall_days"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_bulkWindowId_fkey" FOREIGN KEY ("bulkWindowId") REFERENCES "bulk_windows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancel_requests" ADD CONSTRAINT "cancel_requests_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancel_requests" ADD CONSTRAINT "cancel_requests_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

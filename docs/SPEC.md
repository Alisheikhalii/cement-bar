# SPEC — مشخصات فنی سالن اعلام بار مجازی

> نسخه ۱.۰ | وضعیت: **پیش‌نویس — در انتظار تأیید مالک** | مکمل `docs/PRD.md`
> این سند تصمیمات معماری، مدل داده، الگوریتم‌ها، API و نقشه UI را **قطعی** می‌کند. هر تغییری از این سند باید در `docs/DECISIONS.md` ثبت شود.

---

## ۱. معماری

```
                ┌──────────── Nginx (TLS, gzip, rate-limit L7, static cache) ────────────┐
Browser/PWA ──► │  /            → web (Next.js, SSR + client)                            │
                │  /api/*       → api (NestJS REST)                                      │
                │  /api/events  → api (SSE stream)                                       │
                └──────────────────────────────────────────────────────────────────────────┘
                         api ──► PostgreSQL 16 (source of truth, row locks, unique constraints)
                         api ──► Redis 7 (sessions, rate-limit, pub/sub for SSE, BullMQ jobs)
                         worker (same api image, WORKER=1) ──► BullMQ: window ticks, allocation, hall-day lifecycle
```

- **Modular Monolith:** یک سرویس NestJS با ماژول‌هایی که مرزشان مشخص است، به‌علاوه یک پروسه worker از همان Image.
- **Same-origin:** وب و API هر دو پشت یک دامنه‌اند، پس CORS لازم نیست و کوکی‌ها `SameSite=Strict` هستند.
- **منبع حقیقت دیتابیس است.** Redis فقط cache، lock کمکی و pub/sub است. با از دست رفتن Redis هیچ داده‌ای از بین نمی‌رود.

### ۱.۱ Stack (نسخه‌ها pin می‌شوند)
| لایه | انتخاب |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| زبان | TypeScript 5 (strict) |
| Frontend | Next.js 15 (App Router) + React 19، Tailwind CSS 3.4، Radix UI primitives، TanStack Query، TanStack Table، React Hook Form + Zod، `lucide-react`، `@fontsource/vazirmatn` (self-host)، `react-multi-date-picker` (شمسی)، `next-pwa`/Serwist |
| Backend | NestJS 10، Prisma 5 (PostgreSQL)، `@nestjs/throttler` با Redis storage، BullMQ، `argon2`، `pino`، `exceljs`، `helmet`، `zod` (ورودی‌ها با schemaهای مشترک) |
| Shared | `packages/shared`: schemaهای Zod، enumها، توابع تاریخ (`date-fns-jalali`)، اعتبارسنجی کد ملی، شبا و پلاک، و **هسته الگوریتم‌ها به‌صورت pure** (`packages/engine`) |
| تست | Vitest (unit و الگوریتم)، Jest یا Vitest + Testcontainers/Postgres (integration API)، Playwright (E2E)، k6 (بار)، OWASP ZAP baseline (امنیت) |
| زیرساخت | Docker Compose (dev و prod)، Nginx، GitHub Actions، GHCR |

### ۱.۲ ساختار ریپو
```
cement-bar/
├─ CLAUDE.md                 # قوانین ایجنت (اجباری برای خواندن)
├─ apps/
│  ├─ web/                   # Next.js — route groups: (auth), factory, carrier, driver
│  └─ api/                   # NestJS — src/modules/<module>, src/common, prisma/
├─ packages/
│  ├─ shared/                # zod schemas, enums, jalali, validators, api types
│  ├─ engine/                # pure queue algorithms (bag allocation, bulk rotation) — zero I/O
│  └─ ui/                    # design tokens + 3D components (Button3D, Card, DataTable, Modal...)
├─ infra/
│  ├─ docker/                # Dockerfiles, compose.dev.yml, compose.prod.yml
│  ├─ nginx/                 # nginx.conf, security headers
│  ├─ k6/                    # load scenarios
│  ├─ zap/                   # baseline config
│  └─ scripts/               # deploy.sh, backup.sh, restore.sh, seed
├─ docs/  (PRD, SPEC, GUIDELINES, PLAN, DECISIONS, RUNBOOK, SECURITY-REPORT, BENCHMARK-REPORT, source/, design/)
└─ .github/workflows/        # ci.yml, release.yml
```

---

## ۲. مدل داده (Prisma — سطح موجودیت)

همه جداول این ستون‌ها را دارند: `id (uuid v7)`، `tenant_id`، `created_at`، `updated_at`، `created_by`. برای داده‌های عملیاتی `deleted_at` (soft-delete) هم اضافه می‌شود. زمان‌ها `timestamptz` (UTC) هستند و مبالغ `BIGINT` ریال.

### ۲.۱ هویت و دسترسی
| جدول | ستون‌های کلیدی |
|---|---|
| `tenants` | name, timezone=`Asia/Tehran` |
| `users` | role (`FACTORY_OPERATOR`/`CARRIER_OPERATOR`/`DRIVER`), username? (unique), mobile? (unique), password_hash (argon2id), status, carrier_id? (برای اپراتور باربری), failed_logins, locked_until, last_login_at |
| `sessions` | user_id, refresh_token_hash, family_id, device_info, ip, created_at, expires_at, revoked_at, revoke_reason. **برای راننده: حداکثر یک session فعال** (ایجاد session جدید، sessionهای قبلی را revoke می‌کند) |
| `audit_logs` | actor_id, actor_role, action, entity, entity_id, before (jsonb), after (jsonb), reason?, ip, user_agent, request_id. **Append-only** (بدون UPDATE و DELETE، با trigger) |

### ۲.۲ ساختار سازمانی و داده‌های پایه
| جدول | ستون‌ها |
|---|---|
| `carriers` | code (unique), name, phone, address, status (`ACTIVE`/`SUSPENDED`), national_id? |
| `carrier_quotas` | carrier_id, year_month (`1405-09`)، tonnage_limit (به کیلوگرم، BIGINT)، unique(carrier_id, year_month) |
| `provinces`, `cities` | seed استان‌ها و شهرهای ایران |
| `destinations` | city_id, title, active, sort_order |
| `loader_types` | title (تریلی کفی، تریلی لبه‌دار، بنکر، …), code, active |
| `packaging_types` | title (کیسه ۵۰ کیلویی، فله، جامبوبگ، …), category (`BAG`/`BULK`) |
| `products` | title (سیمان تیپ ۲، …) |
| `halls` | title, category (`BAG`/`BULK`), default_allocation (`TIMED`/`GROUP`), active |
| `hall_schedules` | hall_id, weekday (0..6), t0, priority_end?, hall_end, head_minutes?, free_minutes?, active. (برنامه هفتگی) |
| `hall_days` | hall_id, date (تاریخ محلی), t0_at, priority_end_at?, hall_end_at, status (`SCHEDULED`/`OPEN`/`ALLOCATING`/`CLOSED`/`HALTED`/`CANCELLED`), policy_snapshot (jsonb), unique(hall_id, date) |
| `queue_policies` | hall_id, strategy (`TIMED_PRIORITY_RESERVATION`/`BULK_GROUP_ROTATION`/`FREE_FIRST_COME`), version, params (jsonb validated by zod), active_from, created_by |
| `parties` (فرستنده/گیرنده) | carrier_id, title, name, national_id_enc, economic_code, addresses (jsonb) |
| `goods_owners` | carrier_id, name, national_id_enc, phone, mobile, other_info |
| `loading_locations` | carrier_id?, warehouse_type, name, national_code, nature, city_id, address, phone |
| `cargo_descriptions` | carrier_id?, text |
| `loading_conditions` | carrier_id?, name, condition |
| `daily_files` | carrier_id, for_date, file_key, original_name, size, sha256, note, uploaded_by, seen_at?, seen_by? |

### ۲.۳ راننده
| جدول | ستون‌ها |
|---|---|
| `drivers` | user_id (1:1), carrier_id, status (`PENDING`/`APPROVED`/`REJECTED`/`BLOCKED`), first_name, last_name, national_id_enc + national_id_hash (unique), license_no, license_issue_date, birth_city_id, birth_date?, residence_city_id?, address?, postal_code?, phone?, bank_name?, account_no?, sheba_enc?, health_card_expiry, blocked_until?, block_reason? |
| `vehicles` | driver_id (یک خودروی فعال)، smart_card_no (unique)، plate (ساختاریافته: دو رقم + حرف + سه رقم + ایران دو رقم، unique)، loader_type_id، status (`APPROVED`/`PENDING_CHANGE`)، smart_card_expiry، inspection_expiry |
| `driver_penalties` | driver_id, reason (`CANCEL_APPROVED`/`MANUAL`), until, source_reservation_id |

### ۲.۴ اعلام بار و واحدها
| جدول | ستون‌ها |
|---|---|
| `announcements` | carrier_id, hall_id, hall_day_id?, number (ترتیبی به‌ازای tenant)، status (`DRAFT`/`ACTIVE`/`COMPLETED`/`CANCELLED`/`ARCHIVED`)، announce_date, announce_time, order_code?, contract_no?, unload_code?، **فرستنده:** sender_party_id?, sender_name, sender_national_id_enc, origin_city_id, sender_postal, sender_address، **گیرنده:** receiver_* + dest_city_id + destination_id?، **محموله:** product_id, cargo_description_id?, packaging_type_id, cargo_value (BIGINT), cargo_count?، **بارگیری:** loading_location_id, warehouse_name?, loading_date?, loading_end_date?, loading_from?, loading_to?, loading_place_text?، **وزن و کرایه:** fare_calc (`PER_TRUCK`/`PER_TON`), loader_type_id, loader_type2_id?, truck_count, loader_length?, requested_truck_type?, weight_from_kg, weight_to_kg, dest_fare_type, fare_per_truck?, rate_per_ton?، **سایر:** goods_owner_id?, waybill_note?, description، `is_free_outside_destinations`، `extra` (jsonb: تسهیم، تجمیع، بومی، رگولاتوری و سایر ستون‌های نادر سند)، cancel_reason? |
| `load_units` | announcement_id, seq (1..N), allocation (`GROUP`/`TIMED`/`FREE`), state (`OPEN`/`RESERVED`/`CONSUMED`/`CANCELLED`/`HELD`), current_reservation_id?, version (optimistic) |
| `load_unit_allocation_changes` | unit_id, from, to, reason, actor (تاریخچه BR-10) |

> **تفکیک «ستون جدول» از «فیلد مدل»:** فهرست حدود ۶۰ ستون نمایش در سند مشخصات (`docs/source/System-Specification.md` §۴.۲) در یک فایل پیکربندی ستون‌ها نگهداری می‌شود (`packages/shared/src/columns/announcements.ts`). این فایل برای هر ستون مشخص می‌کند از کدام فیلد مدل، از کدام فیلد محاسبه‌شده (مثل «مانده»، «تعداد مجوز صادر» و «وضعیت جذب») یا از کدام کلید `extra` خوانده شود. ستون‌های مجوز (§۴.۶ سند) هم همین الگو را دارند.

### ۲.۵ نوبت‌دهی
| جدول | ستون‌ها |
|---|---|
| `bag_turns` | hall_day_id, driver_id, turn_no (int), registered_at (clock_timestamp)، status (`WAITING`/`ALLOCATED`/`NOT_ALLOCATED`/`CANCELLED`)، unique(hall_day_id, driver_id)، unique(hall_day_id, turn_no) |
| `bag_priorities` | turn_id, rank (1..3), announcement_id, unique(turn_id, rank), unique(turn_id, announcement_id) |
| `allocation_runs` | hall_day_id (**unique**: مانع اجرای دوباره)، input (jsonb)، output (jsonb)، input_hash, output_hash, started_at, finished_at, engine_version |
| `bulk_groups` | carrier_id, hall_id, title, sort_order, active, deleted_at? |
| `bulk_group_members` | group_id, driver_id, effective_from (date), effective_to? (date)، **قید:** یک عضویت فعال برای هر راننده در هر تاریخ (exclusion constraint روی daterange) |
| `bulk_rotation_state` | carrier_id, hall_id, **unique(carrier, hall)**، next_head_group_id, cursor_group_id, cursor_remaining (uuid[])، cursor_initialized (bool)، version |
| `bulk_days` | carrier_id, hall_day_id, head_group_id, members_snapshot (jsonb: groupId → driverIds به ترتیب گروه‌ها)، state_before (jsonb)، state_after (jsonb)، status، unique(carrier_id, hall_day_id) |
| `bulk_windows` | bulk_day_id, seq (int)، kind (`HEAD`/`FREE`)، round (int)، group_id, eligible (uuid[])، opens_at, closes_at (برنامه‌ریزی‌شده)، closed_at?, close_reason? (`TIME`/`EXHAUSTED`/`ALL_RESERVED`/`MANUAL`/`HALL_END`/`HALTED`)، burned (uuid[])، carried (uuid[])، **unique(bulk_day_id, seq)** |
| `reservations` (= مجوز) | permit_no (ترتیبی)، unit_id, driver_id, carrier_id (صاحب بار)، source (`TIMED`/`GROUP`/`FREE`/`MANUAL`)، hall_day_id, bulk_window_id?, allocation_run_id?, status (طبق PRD §۵.۵)، reserved_at, arrived_at?, loaded_at?, exited_at?, return_reason?, ip, user_agent، **unique partial index (unit_id) WHERE status IN active-set** |
| `cancel_requests` | reservation_id, driver_id, reason, status (`PENDING`/`APPROVED`/`REJECTED`)، decided_by, decided_at, decision_note، unique partial (reservation_id) WHERE PENDING |
| `queue_events` | hall_day_id?, carrier_id?, type، payload (jsonb)، actor_id?، at (clock_timestamp)، seq (bigserial). **Append-only.** انواع رخداد: `TURN_REGISTERED`، `PRIORITIES_SET`، `ALLOCATION_RUN`، `WINDOW_OPENED`، `WINDOW_CLOSED`، `TURN_BURNED`، `CURSOR_MOVED`، `HEAD_ADVANCED`، `RESERVED`، `RESERVE_REJECTED`، `UNIT_FREED`، `UNIT_REGROUPED`، `CANCEL_*`، `GROUP_*`، `MANUAL_*`، `HALL_HALTED` |
| `notifications` | user_id, type, title, body, data, read_at |

### ۲.۶ جای خالی ماژول‌های آینده (فقط Interface و enum، بدون جدول عملیاتی)
`WalletProvider`، `PaymentGateway`، `SmsProvider`، `WaybillProvider`، `RegulatorSyncProvider`، `FareInquiryProvider`: همه در `apps/api/src/integrations/*` با پیاده‌سازی `Noop*` و Feature Flag خاموش.

---

## ۳. موتور نوبت‌دهی

### ۳.۱ Interface استراتژی
```ts
interface QueueStrategy {
  readonly code: StrategyCode;
  /** آیا driver اکنون (serverNow) مجاز به رزرو unit است؟ — فقط خواندن، بدون side-effect */
  canReserve(ctx: ReserveContext): Decision;           // {ok:true} | {ok:false, code, message}
  /** پس از رزرو موفق در همان تراکنش */
  onReserved(tx, ctx): Promise<void>;
  /** tick دوره‌ای یا lazy — idempotent */
  advance(tx, hallDayId, serverNow): Promise<void>;
  onCancelled(tx, reservation): Promise<void>;
}
```
پیاده‌سازی‌های v1: `FreeFirstComeStrategy`، `TimedPriorityStrategy` و `BulkGroupRotationStrategy`. `QueueEngineService` بر اساس `load_unit.allocation` استراتژی را انتخاب می‌کند (`GROUP → BULK`، `TIMED → TIMED`، `FREE → FREE`). **منطق محاسباتی** (ترتیب تخصیص و ماشین حالت پنجره‌ها) در `packages/engine` به‌صورت توابع pure قرار دارد تا تست جدولی و قطعی داشته باشد.

### ۳.۲ مسیر رزرو (مشترک برای همه استراتژی‌ها)
```
POST /api/driver/reservations { unitId? | announcementId, idempotencyKey }
1. Auth + session check (Redis) + rate-limit (5 req/s per driver)
2. Load driver (APPROVED, docs valid, not penalized, loaderType match)  → 403 با کد خطای مشخص
3. BEGIN (READ COMMITTED)
   a. strategy.advance(tx, hallDay, now)                ← lazy close/open of windows
   b. SELECT unit ... FOR UPDATE SKIP LOCKED             ← اگر announcementId داده شده: اولین unit OPEN سازگار
   c. strategy.canReserve(...)                           ← پنجره، عضویت، سقف روزانه، یک رزرو در پنجره
   d. INSERT reservation (unique partial index ضامن نهایی)  ; UPDATE unit state=RESERVED
   e. strategy.onReserved(tx)  ; INSERT queue_event RESERVED ; audit
   COMMIT
4. publish SSE: unit.reserved {announcementId, remaining}
```
- `idempotencyKey`: یک کلید Redis به‌مدت ۶۰ ثانیه، به‌علاوه unique روی (driver_id, idempotency_key) در جدول reservations. درخواست تکراری همان پاسخ قبلی را می‌گیرد.
- برخورد قید یکتا (P2002) به `409 UNIT_TAKEN` تبدیل می‌شود.

### ۳.۳ کیسه‌ای — جزئیات
- **ثبت نوبت:** `INSERT INTO bag_turns(..., turn_no) VALUES (..., nextval per hall-day)`. شماره از طریق ردیف شمارنده در `hall_days` با `UPDATE ... SET turn_seq = turn_seq + 1 RETURNING` در همان تراکنش گرفته می‌شود. این روش پیوستگی و یکتایی را تضمین می‌کند. `registered_at = clock_timestamp()`. ترتیب نهایی ترتیب `turn_no` است.
- **Job تخصیص:** BullMQ یک job با `jobId = alloc:<hallDayId>` در `priority_end_at` زمان‌بندی می‌کند (تکراری ساخته نمی‌شود). worker ابتدا `pg_advisory_xact_lock(hash(hallDayId))` می‌گیرد. اگر `allocation_runs` برای این روز وجود داشته باشد، خارج می‌شود. سپس snapshot ورودی را می‌سازد، تابع pure `allocateBag(input)` را اجرا می‌کند، reservationها را درج می‌کند و `allocation_runs` را می‌نویسد. همه این مراحل در **یک تراکنش** انجام می‌شوند.
- **تابع pure:**
  ```
  allocateBag({turns:[{turnNo, driverId, priorities:[annId...]}], stock:{annId: [unitId...]}})
    → sort turns by turnNo asc
    → for each turn: for p in priorities: if stock[p].length: assign stock[p].shift(); break
    → returns {assignments:[{driverId, unitId, rank}], notAllocated:[driverId]}
  ```
- **Lazy fallback:** اگر worker از کار افتاده باشد، اولین درخواست پس از `priority_end_at` مسیر `advance()` را صدا می‌زند و همان تابع با همان قفل و همان شرط یکتایی اجرا می‌شود.

### ۳.۴ فله — ماشین حالت
**ورودی تابع pure** `planBulk(state, day, events, now)`:
- `groups`: گروه‌های فعال مرتب (snapshot روز)، `members[groupId]`
- `state`: `{nextHeadGroupId, cursorGroupId, cursorRemaining[]}` در ابتدای روز
- `timeline`: رویدادهای رزرو، تمام شدن بار و اقدام‌های دستی تا `now`
- `config`: headMinutes، freeMinutes، maxLoadsPerDriverPerDay، hallEnd

**قوانین گذار (هر کدام یک تست واحد دارد):**
1. **شروع روز** (اولین `advance` پس از T0 برای carrier دارای واحد GROUP): `head = state.nextHeadGroupId`. پنجره `#1 HEAD` با `eligible = members[head]` و بازه `[T0, T0+head]` ساخته می‌شود. `bulk_days.state_before` ذخیره می‌شود.
2. **بستن پنجره** در اولین وقوع یکی از این‌ها: `now ≥ closes_at` (TIME)، تمام شدن واحدهای GROUP سازگار (EXHAUSTED)، رزرو همه eligibleها (ALL_RESERVED)، اقدام دستی (MANUAL) یا رسیدن `hallEnd` (HALL_END).
   - TIME یا MANUAL: هر eligible رزرونکرده‌ای که در لحظه بستن واحد سازگار داشت → `burned`. آن که سازگار نداشت → `skippedNoCompatible` (بدون جریمه، ولی از باقی‌مانده‌ها خارج می‌شود؛ تفسیر T4).
   - EXHAUSTED یا HALL_END: رزرونکرده‌ها → `carried` (در باقی‌مانده نشانگر می‌مانند).
   - اگر پنجره FREE باشد: `cursorRemaining -= (reserved ∪ burned ∪ skipped)`. اگر خالی شد، نشانگر به گروه فعال بعدی می‌رود (اعضای کامل).
3. **باز کردن پنجره بعدی** (فقط اگر واحد GROUP سازگار باقی باشد و `now < hallEnd` و سالن halt نباشد):
   - گروه هدف = `cursorGroupId`. اگر برابر `head` امروز باشد، رد می‌شود (BR-F7) و نشانگر بدون مصرف اعضا جلو می‌رود.
   - `eligible = cursorRemaining ∩ {drivers با loadsToday < max ∧ رزروی در این پنجره ندارند}`. اگر خالی شد، نشانگر جلو می‌رود و تکرار می‌شود (با گارد حلقه: حداکثر یک دور کامل بدون eligible ⇒ توقف).
   - عبور از آخرین گروه یعنی `round++`.
   - `opens_at = max(prev.closed_at, prev.opens_at)` و `closes_at = opens_at + freeMinutes` (پشت‌سرهم).
4. **بار جدید پس از EXHAUSTED:** اولین `advance` بعد از آن پنجره جدیدی برای همان نشانگر و باقی‌مانده‌ها باز می‌کند (تصمیم ۱۱).
5. **پایان روز (HALL_END):** `state.nextHeadGroupId` = گروه فعال بعد از head (فقط اگر روز برنامه‌دار بوده). نشانگر و باقی‌مانده‌ها همان‌طور که هستند ذخیره می‌شوند. واحدهای GROUP مانده طبق `leftoverAtHallEnd` به `FREE` تبدیل می‌شوند یا CARRY می‌مانند (به hall_day بعدی منتقل می‌شوند). `state_after` ذخیره می‌شود.
6. **مقداردهی اولیه:** با فعال‌سازی استراتژی، اپراتور گروه شروع سرنوبت را انتخاب می‌کند و نشانگر روی گروه بعد از آن قرار می‌گیرد (قابل ویرایش تا اولین روز).

**پایداری:** پنجره‌ها با `unique(bulk_day_id, seq)` درج می‌شوند و `advance` با `pg_advisory_xact_lock(carrier, hallDay)` اجرا می‌شود. worker هر ۵ ثانیه برای روزهای OPEN، `advance` را صدا می‌زند. هر درخواست رزرو یا وضعیت هم `advance` را lazy صدا می‌زند. در نتیجه اجرای دوباره یا restart هیچ اثر تکراری ندارد (AC-5).

**تست‌های مرجع:** فایل `packages/engine/test/bulk.reference.test.ts` جدول بخش ۱۱ سند فله را با ۲۰ گروه ۶ نفره شبیه‌سازی می‌کند، با فرض اینکه همه رانندگان در پنجره‌شان فوراً رزرو می‌کنند. برای روز ۲، «یک نفر» گروه ۱۵ به‌صورت قطعی اولین عضو در ترتیب ورودی در نظر گرفته می‌شود.

### ۳.۵ بار آزاد
`canReserve`: `now ∈ [hallDay.start, hallDay.end]`، بارگیر سازگار، و `activeFree < maxActiveFreeReservations`. هیچ پنجره‌ای ندارد.

---

## ۴. API (REST، پیشوند `/api`، JSON، ارقام لاتین، زمان ISO-8601 UTC)

قالب خطا: `{ "error": { "code": "WINDOW_CLOSED", "message": "<پیام فارسی>", "details"?: {} } }`. همه پاسخ‌ها هدر `X-Server-Time` دارند که برای هم‌گام‌سازی شمارش معکوس استفاده می‌شود.

| گروه | Endpoint (خلاصه) |
|---|---|
| Auth | `POST /auth/login`، `POST /auth/refresh`، `POST /auth/logout`، `POST /auth/register-driver`، `GET /auth/me`، `POST /auth/change-password` |
| Factory | `/factory/carriers` (CRUD + `/:id/users` + `/:id/quotas`)، `/factory/daily-files` (upload multipart، list)، `/factory/halls` + `/schedules` + `/days` (+ `/days/:id/halt`)، `/factory/destinations`، `/factory/loader-types`، `/factory/packaging-types`، `/factory/products`، `/factory/policies` (list، `POST` = نسخه جدید)، `/factory/drivers` (list، block/unblock)، `/factory/monitor/*`، `/factory/reports/*` (`?format=xlsx`)، `/factory/audit`، `/factory/sessions` (+revoke) |
| Carrier | `/carrier/dashboard`، `/carrier/daily-files` (+`/:id/download` که seen ثبت می‌کند)، `/carrier/announcements` (CRUD، `/:id/copy`، `/:id/cancel`، `/:id/units/:unitId/allocation`)، `/carrier/drivers` (approve/reject/block)، `/carrier/groups` (CRUD، `/reorder`، `/:id/members`)، `/carrier/bulk/settings`، `/carrier/bulk/live`، `/carrier/bulk/halt`، `/carrier/bulk/windows/:id/close`، `/carrier/cancel-requests` (+approve/reject)، `/carrier/permits` (+`/:id/arrive|load|exit|no-show|return`، `POST /manual`)، `/carrier/master/{parties,goods-owners,loading-locations,cargo-descriptions,loading-conditions}`، `/carrier/reports/*` |
| Driver | `/driver/dashboard`، `/driver/halls/today`، `/driver/bag/turn` (POST ثبت نوبت، GET)، `/driver/bag/priorities` (PUT)، `/driver/bulk/status`، `/driver/loads/cities`، `/driver/loads` (فیلترها)، `/driver/loads/:announcementId`، `/driver/reservations` (POST, GET)، `/driver/reservations/:id/cancel-request`، `/driver/history`، `/driver/profile` (+vehicle)، `/driver/companies` |
| Realtime | `GET /events` (SSE، احراز هویت با کوکی). کانال‌ها: `hall:<id>` (unit.reserved، unit.freed، window.changed)، `user:<id>` (notification) |
| Ops | `GET /healthz`، `GET /readyz`، `GET /metrics` (فقط شبکه داخلی) |

Scoping: هر handler باربری `carrierId` را **فقط از session** می‌خواند و هرگز از ورودی نمی‌گیرد. هر handler راننده هم `driverId` را از session می‌گیرد.

---

## ۵. UI

### ۵.۱ منبع الهام
سه فایل `docs/design/{operator,carrier,driver}-panel.html` به‌همراه `docs/source/UI-UX-3D-Design-System.md`. ساختار پوسته (Shell) از HTMLها گرفته می‌شود:
- **هدر** ثابت `h-16` با گرادیان `from-primary-container (#1E40AF) to-tertiary-container (#2C4696)` و لوگو، نام «سیمان خاکستری نی‌ریز»، زیرعنوان «سالن اعلام بار مجازی»، جستجو، زنگوله اعلان و کاربر.
- **سایدبار راست** `w-72` با نوار وضعیت سالن («سالن نوبت‌دهی: فعال»)، گروه‌بندی منو و آیتم فعال `bg-primary-container text-white shadow`. در موبایل Drawer با پس‌زمینه blur است.
- **Bottom Nav** ۴ آیتمی در موبایل.
- **کارت KPI** با نوار رنگی ۱٫۵px بالا، آیکون در مربع گرد و عدد `display-hero`.
- **جدول** با هدر `surface-container-low`، hover با `inset 3px 0 0 primary` (RTL)، و در موبایل به کارت‌های عمودی با نوار رنگی راست تبدیل می‌شود.
- **دکمه‌های دایره‌ای سه‌بعدی** `shadow-[0_4px_0_<bevel>]` با active برابر `translate-y-1`.
- **مودال** با هدر گرادیان، فرم بخش‌بندی‌شده با نقطه رنگی و فوتر شامل دکمه Primary سه‌بعدی.
- **کارت بار** (پنل راننده) شامل بج وضعیت، مسیر مبدا ← مقصد، شبکه ۲×۲ مشخصات، کرایه و CTA تمام‌عرض. **تگ قرمز «رزرو شده»** روی همین کارت نمایش داده می‌شود.
- **کارت مدارک** با نوار رنگی، روز مانده و نوار پیشرفت (سبز بیش از ۶۰ روز، نارنجی ۱۵ تا ۶۰، قرمز کمتر از ۱۵).

**حذف‌ها نسبت به HTMLها:** تصاویر googleusercontent، CDN Tailwind، Google Fonts و Material Symbols از CDN حذف می‌شوند. به‌جایشان آیکون `lucide-react` و فونت self-host استفاده می‌شود. ویجت‌های نمایشی بدون داده واقعی (رادار ژئوفنس، باسکول، RFID و «۲۸۴ کامیون») هم حذف می‌شوند. **اصل «سادگی و خلوتی» سند مشخصات بر شلوغی HTMLها مقدم است.**

### ۵.۲ Design Tokens
در `packages/ui/tokens.ts` و `tailwind.config` مشترک تعریف می‌شوند و نام‌هایشان همان نام‌های HTML است (`primary #00288E`، `primary-container #1E40AF`، `secondary #0058BE`، `status-success #059669`، `status-warning #D97706`، `status-danger #DC2626`، `status-info #0891B2`، `accent-purple #7C3AED`، سطح‌های `surface*`، `text-primary #0F172A`، `text-secondary #475569`، `text-muted #94A3B8`، `border-subtle #E2E8F0`). مقیاس فونت‌ها هم همان مقیاس HTML است (`display-hero 30`، `headline-lg 24`، `headline-md 18`، `headline-sm 16`، `body-md 14`، `label-md 12`، …). سایه‌ها کلاس‌های `elevation-1..4` سند Design System هستند.

### ۵.۳ نقشه صفحات
- **(auth):** `/login` (سه تب کارخانه، باربری و راننده؛ همه یک endpoint دارند)، `/register`
- **factory:** dashboard، carriers، daily-files، halls، master-data (تب‌ها)، policies، drivers، monitor، reports، audit
- **carrier:** dashboard، daily-files، announcements (+ modal ۷ بخشی، drawer جزئیات واحدها)، drivers، groups، bulk-live، cancel-requests، permits، master-data (تب‌ها)، reports
- **driver:** dashboard، bag-hall، bulk-hall، loads (cities → list → detail)، reservations، history، hall-hours، profile (driver، vehicle، password)، companies

---

## ۶. امنیت (خلاصه‌ای که الزام است؛ جزئیات در GUIDELINES §۴)
- **رمز عبور:** argon2id (m=19MiB, t=2)، حداقل ۸ کاراکتر. قفل موقت پس از ۵ ورود ناموفق در ۱۵ دقیقه.
- **توکن‌ها:** Access JWT با عمر ۱۰ دقیقه (کوکی `__Host-at`, HttpOnly, Secure, SameSite=Strict). Refresh با عمر ۷ روز و چرخشی، با تشخیص reuse که در صورت وقوع کل family را revoke می‌کند. `sid` در JWT هر درخواست در Redis بررسی می‌شود (BR-04).
- **CSRF:** SameSite=Strict به‌علاوه بررسی هدر `Origin` و هدر سفارشی `X-CSRF` (double-submit) برای همه متدهای غیر GET.
- **Rate limiting:** برای login ۵ درخواست در دقیقه به‌ازای هر IP و نام کاربری. برای ثبت نوبت و رزرو ۵ درخواست در ثانیه به‌ازای هر راننده. سقف عمومی ۱۰۰ درخواست در ثانیه به‌ازای هر IP است (در Nginx و Nest).
- **Validation:** همه ورودی‌ها با Zod و حالت strict (کلیدهای ناشناخته رد می‌شوند). آپلود فقط xlsx است (بررسی magic bytes)، حداکثر ۱۰MB، با نام تصادفی ذخیره می‌شود و مسیر از کاربر گرفته نمی‌شود.
- **هدرها:** helmet، CSP سخت‌گیر (`default-src 'self'`، بدون مبدأ خارجی)، HSTS، `X-Content-Type-Options` و `frame-ancestors 'none'`.
- **Secrets:** فقط از env. `.env` در `.gitignore` است و ریپو عمومی است.

---

## ۷. تفسیرها و فرض‌هایی که نیاز به تأیید مالک دارند
| # | موضوع | تفسیر انتخاب‌شده |
|---|---|---|
| T1 | تخصیص کیسه‌ای | تخصیص مستقیماً «رزرو» است و مرحله تأیید جداگانه راننده ندارد. پارامتر `acceptTimeoutMinutes` بعداً اضافه می‌شود |
| T2 | بار کیسه‌ای بین باربری‌ها | راننده باربری A می‌تواند بار کیسه‌ای باربری B را بگیرد. لغو را باربری B تأیید می‌کند |
| T3 | مانده کیسه‌ای پس از تخصیص | پیش‌فرض `KEEP` است، یعنی باربری خودش آزاد می‌کند. کارخانه می‌تواند Policy را روی `AUTO_FREE` بگذارد |
| T4 | عضو بدون بار سازگار در پنجره فله | نمی‌سوزد (جریمه ندارد)، ولی نوبتش در این دور مصرف‌شده حساب می‌شود تا نشانگر گیر نکند |
| T5 | بستن زودهنگام پنجره | اگر همه eligibleها رزرو کرده باشند، پنجره بلافاصله بسته و پنجره بعدی باز می‌شود |
| T6 | ساعت سالن فله | T0 و پایان سالن و مدت پنجره‌ها را کارخانه تعیین می‌کند (D5). سقف روزانه و رفتار مانده پایان سالن تنظیمات باربری است |
| T7 | تأیید ثبت‌نام راننده | تغییر نوع بارگیر یا پلاک وضعیت خودرو را `PENDING_CHANGE` می‌کند. تا تأیید باربری، راننده با مشخصات قبلی کار می‌کند |
| T8 | ثبت حضور، بارگیری و خروج | این وضعیت‌ها را اپراتور باربری (یا کارخانه) دستی ثبت می‌کند. اتصال به باسکول یا ERP در v1 وجود ندارد |
| T9 | نام محصول در UI | «سیمان خاکستری نی‌ریز — سالن اعلام بار مجازی». نام‌های «سریع‌بار» و «BitaBar» استفاده نمی‌شوند |

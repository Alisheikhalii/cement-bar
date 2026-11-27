# GUIDELINES — استانداردهای مهندسی پروژه

> برای همه ایجنت‌ها و توسعه‌دهندگان **الزامی** است. هرجا این سند با کد در تضاد باشد، این سند درست است و کد باید اصلاح شود.

---

## ۱. کد

### ۱.۱ عمومی
- TypeScript در حالت `strict`. `any` ممنوع است، مگر با کامنت `// eslint-disable-next-line` و دلیل مشخص. `ts-ignore` ممنوع است.
- ESLint (شامل `@typescript-eslint`، `eslint-plugin-security`، `import/order`) و Prettier اجرا می‌شوند و CI با هر warning شکست می‌خورد.
- نام‌گذاری: کد، نام‌ها و کامنت‌ها **انگلیسی** هستند. متن‌های UI، پیام‌های خطا برای کاربر و مستندات **فارسی** هستند.
- متن‌های فارسی UI در کد پراکنده نمی‌شوند و در `apps/web/src/i18n/fa.ts` متمرکزند. پیام‌های خطای API در `packages/shared/src/errors.ts` با کد ثابت تعریف می‌شوند.
- هر تابع حداکثر حدود ۶۰ خط و هر فایل حداکثر حدود ۴۰۰ خط باشد. در غیر این صورت باید شکسته شود.
- هیچ مقدار جادویی (magic number) مجاز نیست. پارامترهای کسب‌وکار در Policy یا config قرار می‌گیرند.
- زمان: همیشه از `ClockService` (backend) یا `useServerClock` (frontend) استفاده شود. فراخوانی مستقیم `Date.now()` در منطق کسب‌وکار **ممنوع** است، چون تست‌پذیری زمان مهم است.
- مبالغ ریال `bigint` و وزن‌ها کیلوگرم `int` هستند. Float برای پول یا وزن ممنوع است.

### ۱.۲ Backend (NestJS)
- ساختار هر ماژول: `*.module.ts`، `*.controller.ts` (لایه نازک)، `*.service.ts` (منطق)، `*.repository.ts` (فقط اگر Prisma query پیچیده باشد)، `dto/` (zod)، و `*.spec.ts`.
- Controller هیچ منطق کسب‌وکاری ندارد و `tenantId`، `carrierId` و `driverId` را **فقط** از `@CurrentUser()` می‌گیرد.
- هر query روی داده‌های Tenant یا Carrier از helperهای `scoped(user)` می‌گذرد. Review در PRها روی این مورد سخت‌گیر است.
- تراکنش‌ها با `prisma.$transaction` و timeout مشخص اجرا می‌شوند. داخل تراکنش I/O خارجی (Redis publish یا HTTP) انجام نمی‌شود و publish **بعد از commit** صورت می‌گیرد.
- همه نوشتن‌های عملیاتی یک ردیف `audit_logs` و در صورت نیاز یک ردیف `queue_events` دارند.
- Raw SQL فقط با `Prisma.sql` و پارامتر مجاز است. الحاق رشته (string concat) ممنوع است.
- خطاها با `DomainError(code)` پرتاب و با یک Exception filter به قالب استاندارد تبدیل می‌شوند. stack trace به کلاینت نمی‌رود.

### ۱.۳ Frontend (Next.js)
- Server Components برای پوسته و Client Components برای تعامل استفاده می‌شوند. داده‌ها با TanStack Query و یک کلاینت API تایپ‌شده از `packages/shared` خوانده می‌شوند.
- فرم‌ها با React Hook Form و zodResolver ساخته می‌شوند و از **همان schema** سرور استفاده می‌کنند.
- استایل فقط با Tailwind و tokenهای `packages/ui` است. رنگ hex مستقیم در کامپوننت‌ها ممنوع است.
- کامپوننت‌های پایه فقط از `packages/ui` می‌آیند: `Button3D`، `IconButton3D`، `Card`، `KpiCard`، `DataTable`، `Modal`، `FormSection`، `Badge`، `Countdown`، `EmptyState`، `Skeleton`، `JalaliDatePicker`، `LoadCard` و `CredentialCard`. ساختن نسخه تکراری ممنوع است.
- RTL: از `dir="rtl"` و logical properties استفاده شود (`ps-`/`pe-`/`ms-`/`me-`/`start`/`end`). `left` و `right` فیزیکی فقط برای سایه‌های جهت‌دار مجاز است.
- هر صفحه سه حالت loading (Skeleton)، empty (EmptyState) و error دارد.
- هیچ منبع خارجی در runtime مجاز نیست: نه CDN، نه Google Fonts، نه تصویر خارجی. CSP این را enforce می‌کند.

---

## ۲. داده و Migration
- Prisma migrate برای هر تغییر اسکیما یک migration نام‌دار می‌سازد.
- **Migration مخرب** (DROP، حذف ستون یا تغییر نوع با از دست رفتن داده) فقط با تأیید صریح مالک مجاز است و قبل از v1 release هم باید در `DECISIONS.md` ثبت شود.
- قیدهای حیاتی در خود دیتابیس تعریف می‌شوند و فقط به کد سپرده نمی‌شوند: unique partial برای رزرو فعال، exclusion برای عضویت گروه، trigger append-only برای `audit_logs` و `queue_events`. این قیدها در migration با SQL خام نوشته می‌شوند.
- Seed: `pnpm db:seed` داده دمو قابل‌تکرار می‌سازد شامل کارخانه، ۳ باربری، ۲ سالن، ۱۲ مقصد، ۶ نوع بارگیر و ۱۲۰ راننده در ۲۰ گروه. داده واقعی افراد هرگز در seed قرار نمی‌گیرد.

---

## ۳. تست

| لایه | ابزار | الزام |
|---|---|---|
| الگوریتم (`packages/engine`) | Vitest | **پوشش خط ۱۰۰٪**. تست‌های جدولی مثال‌های مرجع فله (۴۸، ۴۳، ۴۱، ۱۳۰/۱۲۰)، determinism تخصیص کیسه‌ای و property-based (fast-check) برای عدم overbooking |
| سرویس‌ها و API | Vitest + Postgres واقعی (Testcontainers یا سرویس CI) | هر endpoint حداقل یک مسیر موفق و یک مسیر رد مجوز دارد. پوشش کلی api حداقل ۸۰٪ |
| هم‌زمانی | Integration | ۵۰ رزرو موازی روی یک واحد ⇒ دقیقاً یک موفقیت. ۲۰۰ ثبت نوبت موازی ⇒ شماره‌های یکتا و پیوسته. اجرای دوباره Job و advance ⇒ بدون تکرار |
| امنیت | Integration | مجموعه IDOR (باربری A در برابر B، راننده در برابر راننده)، تست نقش‌ها روی همه endpointها (ماتریس خودکار)، نشست دوم، rate limit |
| E2E | Playwright | سناریوهای طلایی: ثبت باربری و راننده و تأیید، روز کیسه‌ای کامل، روز فله کامل، چرخه لغو |
| بار | k6 | `infra/k6/hall-open.js` (۱۰۰۰ VU در T0)، `browse.js`، `reserve-storm.js` |

- **TDD برای موتور نوبت‌دهی:** اول تست مثال مرجع نوشته می‌شود و بعد پیاده‌سازی.
- هیچ تستی skip نمی‌شود، مگر با issue و دلیل در کامنت.
- تست‌ها به ساعت واقعی وابسته نیستند و `FakeClock` تزریق می‌شود.

---

## ۴. چک‌لیست امنیت (مبنا: OWASP ASVS L2 و Top 10)

| حوزه | کنترل | چگونه اثبات می‌شود |
|---|---|---|
| A01 Broken Access Control | scoping سرویس، ماتریس نقش‌ها، IDOR suite | تست خودکار |
| A02 Crypto | argon2id، AES-256-GCM برای کد ملی و شبا (کلید از env)، TLS 1.2+ و HSTS | بازبینی کد و تست رمزنگاری |
| A03 Injection | Prisma پارامتری، Zod strict، بدون `dangerouslySetInnerHTML`، escape در اکسل (formula injection: پیشوند `'` برای `=+-@`) | تست و semgrep/eslint-security |
| A04 Insecure Design | قیدهای دیتابیس، ساعت سرور، idempotency | تست هم‌زمانی |
| A05 Misconfiguration | helmet، CSP، غیرفعال بودن `x-powered-by`، کاربر غیر root در کانتینر، فایل‌سیستم read-only در prod | ZAP baseline |
| A06 Vulnerable Components | `pnpm audit --prod` و osv-scanner در CI، lockfile، Renovate/Dependabot | CI |
| A07 AuthN | قفل حساب، rate limit، چرخش refresh، تک‌نشست راننده | تست |
| A08 Integrity | CI روی main محافظت‌شده، Image با digest، `npm ci --ignore-scripts` در صورت امکان | CI |
| A09 Logging | audit append-only، لاگ ساخت‌یافته بدون PII (ماسک کد ملی، موبایل و شبا) | تست لاگ |
| A10 SSRF | API هیچ fetch خارجی‌ای به URL ورودی کاربر ندارد | بازبینی |

خروجی فاز امنیت `docs/SECURITY-REPORT.md` است: یافته‌ها، شدت، وضعیت اصلاح و نتیجه ابزارها.

---

## ۵. کارایی
- هر query لیستی صفحه‌بندی سمت سرور و ایندکس متناسب دارد و `EXPLAIN` آن بررسی می‌شود.
- مسیر داغ (فهرست بارها و وضعیت پنجره) cache کوتاه Redis (۱ تا ۲ ثانیه) دارد که با رویداد invalidate می‌شود.
- SSE برای وضعیت زنده استفاده می‌شود و polling فقط fallback است (حداقل ۵ ثانیه).
- Bundle: هر route group lazy بارگذاری می‌شود. JS اولیه پنل راننده باید کمتر از ۲۰۰KB gzip باشد.
- خروجی فاز بنچمارک `docs/BENCHMARK-REPORT.md` است: سناریو، سخت‌افزار، p50/p95/p99، خطاها، گلوگاه‌ها و اصلاحات.

---

## ۶. UI/UX
- منبع طراحی: `docs/design/*.html` و `docs/source/UI-UX-3D-Design-System.md` (جزئیات در SPEC §۵).
- **سادگی مقدم است:** هر صفحه یک هدف اصلی و حداکثر ۴ KPI دارد و ویجت تزئینی بدون داده ممنوع است.
- انیمیشن فقط با `transform` و `opacity` (حداکثر ۳۰۰ms) و با رعایت `prefers-reduced-motion`.
- موبایل (پنل راننده): هدف لمسی حداقل ۴۴px، CTA تمام‌عرض در پایین، Bottom Nav. در ۳۶۰px نباید اسکرول افقی وجود داشته باشد.
- اعداد در UI با ارقام فارسی و جداکننده هزارگان نمایش داده می‌شوند. ورودی عددی ارقام فارسی و لاتین را می‌پذیرد و به لاتین نرمال می‌کند.
- همه تاریخ‌ها شمسی (`۱۴۰۵/۰۹/۰۵`) و ساعت‌ها ۲۴ساعته (`۰۶:۳۰`) هستند.

---

## ۷. Git و CI
- شاخه‌ها: `main` (همیشه سبز) و شاخه هر فاز `phase/<n>-<slug>`. در پایان فاز merge با `--no-ff` و تگ `v0.<n>.0` انجام می‌شود.
- Commitها از Conventional Commits پیروی می‌کنند (`feat(engine): ...`، `fix(api): ...`، `test: ...`، `docs: ...`، `chore: ...`). هر commit یک واحد منطقی است.
- **قبل از هر push:** `pnpm lint && pnpm typecheck && pnpm test` باید سبز باشد.
- CI (`.github/workflows/ci.yml`) شامل این مراحل است: install، lint، typecheck، unit، integration (سرویس postgres و redis)، build، audit و E2E (روی main). Release هم Imageهای `web` و `api` را می‌سازد و به GHCR push می‌کند.
- **ریپو عمومی است:** هیچ secret، کلید، دامنه خصوصی یا داده واقعی commit نمی‌شود. قبل از push، `git diff --cached` برای الگوهای secret اسکن می‌شود (gitleaks در CI).

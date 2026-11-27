# cement-bar · سالن اعلام بار مجازی

> **فارسی** · [English below](#english)

سامانه **سالن اعلام بار مجازی سیمان خاکستری نی‌ریز** با سه پنل **کارخانه**، **باربری** و **راننده**. هسته سامانه یک موتور نوبت‌دهی منصفانه است: تخصیص کیسه‌ای زمانی با ۳ اولویت، چرخش گروهی فله و بار آزاد. همه کنترل‌ها (پنجره زمانی، سقف، تطبیق بارگیر، مجوز) در سرور و با ساعت سرور انجام می‌شوند.

## پشته فنی
| لایه | انتخاب |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| Frontend | Next.js 15 (App Router)، React 19، Tailwind CSS، Radix UI، TanStack Query/Table، فونت Vazirmatn (self-host) |
| Backend | NestJS 10، Prisma 5، PostgreSQL 16، Redis 7، BullMQ، argon2، pino |
| مشترک | `packages/shared` (Zod، enum، تاریخ شمسی)، `packages/engine` (الگوریتم‌های pure)، `packages/ui` (Design System) |
| زیرساخت | Docker Compose، Nginx، GitHub Actions، GHCR |

## شروع سریع (توسعه)
پیش‌نیاز: Node.js 22+، pnpm 11 (`corepack enable`)، Docker.

```bash
cp .env.example .env                                     # هرگز commit نشود (ریپو عمومی است)
pnpm i
docker compose -f infra/docker/compose.dev.yml up -d     # postgres + redis
pnpm db:migrate && pnpm db:seed
pnpm dev                                                 # web :3000 · api :4000
```

## دستورات
| دستور | کار |
|---|---|
| `pnpm dev` | اجرای web و api در حالت توسعه |
| `pnpm build` | build همه پکیج‌ها |
| `pnpm lint && pnpm typecheck && pnpm test` | gate قبل از هر commit |
| `pnpm test:engine` | تست‌های مرجع الگوریتم نوبت‌دهی |
| `pnpm test:int` | تست integration (نیازمند postgres و redis) |
| `pnpm e2e` | Playwright |
| `pnpm db:migrate` / `pnpm db:seed` | migration و داده نمونه |

## مستندات
| فایل | محتوا |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | قوانین ایجنت‌ها و نقشه کد |
| [`docs/PRD.md`](docs/PRD.md) | نیازمندی‌ها و تصمیمات مالک |
| [`docs/SPEC.md`](docs/SPEC.md) | معماری، مدل داده، الگوریتم‌ها و API |
| [`docs/GUIDELINES.md`](docs/GUIDELINES.md) | استانداردهای کد، تست، امنیت و Git |
| [`docs/PLAN.md`](docs/PLAN.md) | فازها و محدوده ساب‌ایجنت‌ها |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | تصمیم‌ها، پرسش‌های باز و گزارش فازها |
| `docs/RUNBOOK.md` | راهنمای عملیات و استقرار (فاز P4) |

## استقرار (Production)
- Imageها در GitHub Actions (`release.yml` با push تگ `v*`) ساخته و در GHCR منتشر می‌شوند. چون سرور ممکن است به Docker Hub یا GHCR دسترسی نداشته باشد، خروجی `docker save` هم به‌صورت artifact و asset در Release قرار می‌گیرد (`cement-bar-images-<tag>.tar.gz` و `cement-bar-base-images-<tag>.tar.gz`).
- روی سرور:
  ```bash
  infra/scripts/gen-secrets.sh --domain <دامنه> --tag v0.1.0 > infra/docker/.env.prod && chmod 600 infra/docker/.env.prod
  infra/scripts/deploy.sh --load cement-bar-base-images-v0.1.0.tar.gz --load cement-bar-images-v0.1.0.tar.gz
  infra/scripts/deploy.sh --init-cert admin@<دامنه>      # اولین گواهی TLS
  ```
- Rollback: `infra/scripts/deploy.sh --tag <تگ قبلی>`. بک‌آپ: `infra/scripts/backup.sh` (cron روزانه، نگه‌داری ۱۴ روز). بازیابی: `infra/scripts/restore.sh`.
- جزئیات کامل در `docs/RUNBOOK.md` (P4).

---

<a id="english"></a>
## English

**cement-bar** is a virtual freight-announcement hall for the Neyriz grey-cement factory, with three panels: **factory**, **carrier (freight company)** and **driver**. Its core is a fair queueing engine: time-boxed bagged-cement allocation with 3 priorities, rotating bulk groups, and free loads. Every rule (windows, quotas, trailer matching, permissions) is enforced server-side using the server clock.

### Stack
pnpm + Turborepo monorepo · Next.js 15 / React 19 / Tailwind · NestJS 10 / Prisma 5 / PostgreSQL 16 / Redis 7 / BullMQ · Docker Compose, Nginx, GitHub Actions, GHCR.

### Quick start (development)
Requires Node.js 22+, pnpm 11 (`corepack enable`) and Docker.
```bash
cp .env.example .env            # never commit it — this repository is public
pnpm i
docker compose -f infra/docker/compose.dev.yml up -d
pnpm db:migrate && pnpm db:seed
pnpm dev                        # web :3000, api :4000
```

### Commands
`pnpm dev` · `pnpm build` · `pnpm lint && pnpm typecheck && pnpm test` (pre-commit gate) · `pnpm test:engine` · `pnpm test:int` · `pnpm e2e` · `pnpm db:migrate` · `pnpm db:seed`

### Docs
`CLAUDE.md` (agent rules) · `docs/PRD.md` · `docs/SPEC.md` · `docs/GUIDELINES.md` · `docs/PLAN.md` · `docs/DECISIONS.md` · `docs/RUNBOOK.md` (P4).

### Deployment
Images are built by `.github/workflows/release.yml` on `v*` tags, pushed to GHCR, and also exported with `docker save` (release asset + workflow artifact) for servers without registry access. On the server: generate `infra/docker/.env.prod` with `infra/scripts/gen-secrets.sh`, then run `infra/scripts/deploy.sh --load <tarballs>` (or `--pull`), and `--init-cert <email>` once for Let's Encrypt. Production topology: Nginx (TLS, rate limits, security headers) → web (Next.js) and api (NestJS) + worker, PostgreSQL and Redis on an internal-only network. See `infra/docker/compose.prod.yml`.

### Security
No secrets in the repository: only `.env.example` is committed, and CI runs gitleaks, `pnpm audit` and osv-scanner on every push. Report vulnerabilities privately to the repository owner.

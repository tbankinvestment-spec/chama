# Chama — Group Savings Platform

> **MVC-structured Node.js + Express + Handlebars + MongoDB** app for managing
> Chamas (group savings), merry-go-rounds, and table banking.
>
> This README documents **every folder and file** in the project. Use the
> table of contents below to jump to a specific area.

---

## 📑 Table of Contents

1. [Quick Start](#-quick-start)
2. [Tech Stack](#-tech-stack)
3. [Project Structure (high-level map)](#-project-structure-high-level-map)
4. [Root-Level Files](#root-level-files)
5. [`config/` — App-wide setup](#config--app-wide-setup)
6. [`routes/` — URL → controller wiring](#routes--url--controller-wiring)
7. [`controllers/` — Route handlers / "business logic glue"](#controllers--route-handlers--business-logic-glue)
8. [`middlewares/` — Cross-cutting pipeline functions](#middlewares--cross-cutting-pipeline-functions)
9. [`models/` — Mongoose schema & data layer](#models--mongoose-schema--data-layer)
10. [`services/` — Pure data providers](#services--pure-data-providers)
11. [`utils/` — Shared formatting helpers](#utils--shared-formatting-helpers)
12. [`views/` — Handlebars templates](#views--handlebars-templates)
13. [`public/` — Static assets (CSS, JS, images)](#public--static-assets-css-js-images)
14. [`work-record/` — Dev progress log](#work-record--dev-progress-log)
15. [`login-app/` — Standalone React frontend (optional)](#login-app--standalone-react-frontend-optional)
16. [Request Flow — what happens when a user clicks a link](#request-flow--what-happens-when-a-user-clicks-a-link)
17. [How to add a new feature (walkthrough)](#how-to-add-a-new-feature-walkthrough)

---

## 🚀 Quick Start

```bash
# 1. Install (already done — node_modules exists)
npm install

# 2. Verify your .env has:
#    MONGODB_URI, SESSION_SECRET, (optional) PORT

# 3. Run the server:
npm start          # production: node server.js
npm run dev        # development: nodemon server.js

# 4. Open:
#    http://localhost:3000/          Home (landing page)
#    http://localhost:3000/login     Login form
#    http://localhost:3000/register  Register form
#    http://localhost:3000/dashboard Dashboard (requires login)
#
#    Demo login: submit ANY email + password (logs in as Jane Mwangi)
```

---

## 🛠 Tech Stack

| Layer               | Package                         | Purpose                                                              |
| ------------------- | ------------------------------- | -------------------------------------------------------------------- |
| Runtime             | Node.js                         | Everything runs here.                                                |
| Web framework       | `express@^5`                    | HTTP server, routing, middleware pipeline.                           |
| View engine         | `express-handlebars@^8` (`.hbs`)| Server-rendered HTML templating.  Layouts in `views/layouts/main.hbs`. |
| Sessions            | `express-session@^1`            | In-memory session store for login state (swap for `connect-mongo`).  |
| Database ODM        | `mongoose@^9`                   | Schema-based layer on top of MongoDB Atlas (`MONGODB_URI`).          |
| Config              | `dotenv@^18`                    | Loads secrets from `.env` (never commit `.env` to git).              |
| Dev reload          | `nodemon@^3` (dev)              | Auto-restarts `node server.js` when `.js/.json` files change.        |

---

## 🗺 Project Structure (high-level map)

```
chama/                                    ←  project root
│
├── server.js                             ←  THIN entry point (loads env + imports modules)
├── package.json                          ←  deps + "start" / "dev" scripts
├── package-lock.json
├── .env                                  ←  SECRETS (MONGODB_URI, SESSION_SECRET, PORT)
├── .gitignore
├── README.md                             ←  THIS FILE (full docs)
│
├── config/                               ←  HOW Express / Mongo / sessions are wired
│   ├── app.js                            ←  builds the express() app (body parser, static, views, hbs, sessions, userLocals)
│   ├── hbs.js                            ←  Handlebars engine + helpers (via utils/formatters.js)
│   ├── session.js                        ←  express-session config (cookie, secret, maxAge)
│   └── db.js                             ←  Mongoose connection (connectDB, exports mongoose instance)
│
├── routes/                               ←  WHICH URL → WHICH controller handler
│   ├── home.js                           ←  GET "/" → homeController.showHome
│   ├── auth.js                           ←  GET/POST /login, GET/POST /register, GET /logout
│   └── dashboard.js                      ←  GET "/dashboard" (guarded by authGuard middleware)
│
├── controllers/                          ←  CODE that runs for a route (read req, write res)
│   ├── homeController.js                 ←  showHome(): renders views/home.hbs
│   ├── authController.js                 ←  showLogin / handleLogin / showRegister / handleRegister / handleLogout
│   └── dashboardController.js            ←  showDashboard(): assembles stats + txns + members, then renders dashboard.hbs
│
├── middlewares/                          ←  Functions that run BETWEEN routes (pipeline stages)
│   ├── userLocals.js                     ←  GLOBAL: sets res.locals.user = req.session.user for templates
│   └── authGuard.js                      ←  ROUTE-LEVEL: blocks unauthenticated requests to /dashboard, redirects → /login
│
├── models/                               ←  Mongoose schemas (what a record looks like in MongoDB)
│   ├── index.js                          ←  Barrel: re-exports all 5 models in one require()
│   ├── User.js                           ←  name, email, passwordHash, group, role, phone, timestamps
│   ├── Group.js                          ←  name, contribution, meeting schedule, officials refs, member refs
│   ├── Transaction.js                    ←  deposit / withdrawal / fee with group/user/loan refs
│   ├── Loan.js                           ←  principal, interest, balance, due date, status enum
│   └── Contribution.js                   ←  per-member per-period (e.g. "2026-09") due vs paid
│
├── services/                             ←  "Where does the data come from?" layer
│   └── chamaData.js                      ←  buildDemoUser(), dashboardStats(), recentTransactions(), groupMembers()
│                                           (currently hard-coded samples; swap each fn for a Mongoose query later)
│
├── utils/                                ←  Pure helper functions (no side effects)
│   └── formatters.js                     ←  gt(), eq(), initial(), emailName(), formatKES(), signedKES()
│                                           used by: Handlebars templates (as helpers) + controllers
│
├── views/                                ←  Handlebars .hbs templates
│   ├── layouts/
│   │   └── main.hbs                      ←  DEFAULT layout — header + {{{body}}} + footer.  Every page wraps with this.
│   ├── partials/                         ←  Reusable snippets ({{> _name}})
│   │   └── README.txt                    ←  "how to add partials" guide
│   ├── home.hbs                          ←  Landing page (hero + 3 features + CTA banner)
│   ├── login.hbs                         ←  DUAL: renders login OR register depending on {{#if isRegister}}
│   └── dashboard.hbs                     ←  4 stat cards + transactions + upcoming sidebar + members table
│
├── public/                               ←  Served literally via express.static()
│   ├── login.js                          ←  (legacy) client-side JS at /login.js
│   ├── css/
│   │   └── login.css                     ←  Auth card styles + layout primitives + badge classes + table styles
│   └── js/
│       └── login.js                      ←  (legacy) client-side JS at /js/login.js
│
├── work-record/                          ←  Day-by-day dev log
│   └── README.md                         ←  Task checklist, completed items, next steps
│
└── login-app/                            ←  SEPARATE React + TS + Vite project (NOT wired to Express)
    └── (its own package.json, vite.config, src/, etc.)
```

---

## Root-Level Files

### `server.js`
**Purpose:** Thin entry point. Only 4 things happen here:
1. Loads `.env` via `require("dotenv").config()`.
2. Calls `createApp()` from `config/app.js` — this is where middleware/views/hbs live.
3. **Mounts the 3 routers** (home, auth, dashboard) onto the app. This is the URL map.
4. Calls `connectDB()` (background) and then `app.listen(PORT)`.

**Why thin?** Easy to scan. To add a new URL, you add *two lines* here:
```js
const featureRoutes = require("./routes/feature");   // line 1
app.use(featureRoutes);                               // line 2
```
and the actual code lives in its own folders.

---

### `package.json`
Key contents:
- `"main": "server.js"` — fixes the earlier "nodemon falls back to index.js" bug.
- Scripts:
  - `npm start` → `node server.js`
  - `npm run dev` → `nodemon server.js`
  - `npm test` → placeholder
- Dependencies: `express, express-handlebars, express-session, mongoose, dotenv`
- Dev: `nodemon`

---

### `.env`
Git-ignored. Contains:
```
MONGODB_URI=mongodb+srv://...     (MongoDB Atlas credentials)
SESSION_SECRET=cb57...            (64-char hex, used by express-session)
PORT=3000                         (optional, defaults to 3000)
```

---

### `.gitignore`
Ignores `node_modules`, `.env`, logs, OS files.

---

## `config/` — App-wide setup

*"How does Express get built?"*

### `config/app.js` — `createApp()`
Builds one fully-configured Express app. Ordering matters here:
1. `express()` → raw app.
2. Body parsers (`express.json`, `express.urlencoded`) — for forms + JSON.
3. `express.static(public/)` — serves `/css/login.css`, `/login.js`, etc.
4. **Session middleware** (`config/session.js`) — must run before auth.
5. **Handlebars engine** (`config/hbs.js`) → sets `view engine`, `views`.
6. **userLocals middleware** (global) — so `views/layouts/main.hbs` always knows `{{#if user}}`.

**Returns:** the fully-built `app`. `server.js` mounts routes onto it.

---

### `config/hbs.js` — `createHbsEngine()`
Creates the `express-handlebars` engine object with:
- File extension `.hbs`
- `layoutsDir = views/layouts` → layout wrappers live there
- `partialsDir = views/partials` → reusable snippets (empty so far)
- `defaultLayout = "main"` → every template automatically wraps with `layouts/main.hbs`
- **`helpers`** — the set exported from `utils/formatters.js` (`gt`, `eq`, `initial`, `formatKES`, etc.)

---

### `config/session.js`
Exports a ready-to-use `express-session()` instance:
| Option         | Value                                      | Meaning                                              |
| -------------- | ------------------------------------------ | ---------------------------------------------------- |
| `secret`       | `process.env.SESSION_SECRET` (fallback)    | Signs cookies so clients can't fake a session.       |
| `resave`       | false                                      | Official recommendation.                             |
| `saveUninit`   | false                                      | Don't store empty sessions (saves memory).           |
| `cookie.httpOnly` | true                                   | Browser JS can't read the session cookie (XSS-safe). |
| `cookie.maxAge` | 1 day                                     | Session expires after 24h regardless of activity.    |

⚠️ **Production TODO:** swap `MemoryStore` for `connect-mongo` + add `cookie.secure = true` + `sameSite = 'lax'` behind HTTPS.

---

### `config/db.js` — `connectDB()`
Exports:
- `connectDB()` — calls `mongoose.connect(MONGODB_URI)`. On success → logs `"[DB] MongoDB connected"`. **On failure → logs a warning, does NOT crash.** This is deliberate: the demo data in `services/chamaData.js` still lets you build/test the UI even when offline or without Atlas.
- `mongoose` — the connected mongoose instance, imported by every `models/*.js` file.

---

## `routes/` — URL → controller wiring

*"What URL maps to what function?"*
Each file is a single `express.Router()` that lists HTTP verbs + paths and calls a controller. **No business logic lives here.**

### `routes/home.js`
```
GET /  →  homeController.showHome
```

### `routes/auth.js`
```
GET  /login     → authController.showLogin
POST /login     → authController.handleLogin
GET  /register  → authController.showRegister
POST /register  → authController.handleRegister
GET  /logout    → authController.handleLogout
```

### `routes/dashboard.js`
Notice the **2nd arg** to `router.get`:
```
GET /dashboard  → authGuard middleware (CHECK) → dashboardController.showDashboard
```
If `req.session.user` is missing, `authGuard` redirects to `/login` and the controller never runs.

---

## `controllers/` — Route handlers / "business logic glue"

Controllers live between routes (which know *what URL*) and models/services (which know *where data is from*).
**Rule:** they don't do DB queries directly — they call services/models.
**Signature:** `(req, res) => { ... res.render(...) or res.redirect(...) }`

### `controllers/homeController.js`
- **`showHome(req, res)`** — simplest controller. `res.render("home", { title: "Home" })`. Wraps with `layouts/main.hbs` automatically.

### `controllers/authController.js`
Five handlers. All currently **demo-mode** (no DB lookups, no bcrypt):

| Handler             | What it does                                                                |
| ------------------- | --------------------------------------------------------------------------- |
| `showLogin`         | If already logged in → skips to /dashboard. Else → renders `login.hbs`.    |
| `handleLogin`       | Reads `{email,password}` from form. Ignores password; sets session to Jane Mwangi + the email entered. Redirects /dashboard. |
| `showRegister`      | Skips if logged in; else renders `login.hbs` with `isRegister:true` flag.  |
| `handleRegister`    | Sets session directly from form fields (`name,email,group`). Role = Member. Redirects /dashboard. |
| `handleLogout`      | `req.session.destroy()` → redirect `/`.                                     |

**TODO (prod):** `handleLogin` → `User.findOne({email}) + bcrypt.compare`. `handleRegister` → `bcrypt.hash + User.create(...) + store user._id only`.

### `controllers/dashboardController.js`
- **`showDashboard(req, res)`** — Assembles the three dashboard data groups:
  1. `dashboardStats()` → 4 KPI numbers + nextMeeting.
  2. `recentTransactions()` → 5 latest rows.
  3. `groupMembers()` → 6 sample members with role / contributed / status.
- Passes them all + `req.session.user` into `res.render("dashboard", {...})`.

---

## `middlewares/` — Cross-cutting pipeline functions

### `middlewares/userLocals.js`
Registered **globally** in `config/app.js` AFTER session, BEFORE routes.
Sets `res.locals.user = req.session.user || null`.
Why is this important? `views/layouts/main.hbs` contains:
```hbs
{{#if user}} <a href="/dashboard">Dashboard</a> <a href="/logout">Logout</a>
{{else}}     <a href="/login">Login</a>        <a href="/register">Register</a>
{{/if}}
```
Without this middleware, every single route would have to manually pass `{user: req.session.user}` to `res.render()` — easy to forget, easy to desync.

### `middlewares/authGuard.js`
Registered **per-route** (only in `routes/dashboard.js` today).
Stops unauthenticated requests dead. Pattern to protect any new route:
```js
const authGuard = require("../middlewares/authGuard");
router.get("/members", authGuard, (req, res) => { /* safe zone */ });
```

---

## `models/` — Mongoose schema & data layer

Each file has three things at the top:
1. A comment explaining *what real-world Chama concept it represents*.
2. A `mongoose.Schema(...)` with `required`, `enum`, `unique`, `default`, indexes, `ref: "ModelName"` for relationships.
3. A guard `mongoose.models.X || mongoose.model("X", schema)` so hot-reload doesn't throw "Cannot overwrite model".

### `models/index.js`
**Barrel export.** Use it for convenience:
```js
const { User, Group, Transaction, Loan, Contribution } = require("../models");
```

### Individual Models

| File               | Key fields                                                                 | Used by dashboard for... |
| ------------------ | -------------------------------------------------------------------------- | ------------------------ |
| `User.js`          | name, email, passwordHash, group, role (`Member/Treasurer/...`), phone    | Greeting line, members table |
| `Group.js`         | name, monthlyContribution, meetingDay/Location, yearlyGoal, officials[chair/treas/sec], members[], status | Month target, yearly progress |
| `Transaction.js`   | group FK, date, type (`Deposit/Withdrawal/Fee/Interest/MerryGoRound`), amount, description, by, member FK, relatedLoan FK | Transactions table |
| `Loan.js`          | group FK, borrower FK, principal, interestRate, totalOwed, balanceOutstanding, disbDate, dueDate, purpose, status enum | Loans stat cards |
| `Contribution.js`  | group FK, member FK, period ("2026-09"), dueDate, expected vs paid amount, status enum, paidAt | Monthly progress bar, "this month" KPI |

---

## `services/` — Pure data providers

### `services/chamaData.js`
**Right now:** returns hard-coded demo objects (same values that used to be inlined in old server.js).
**Later:** each function becomes a real Mongoose query without changing its signature. This is the **seam** between demo-mode and production-mode.

| Function                 | Returns                                                           |
| ------------------------ | ----------------------------------------------------------------- |
| `buildDemoUser(overrides)`| Defaults to Jane Mwangi, Treasurer. Auth controllers pass overrides. |
| `dashboardStats()`       | `{totalSavings, monthlyTarget, thisMonthDeposits, activeLoans, outstandingLoans, memberCount, nextMeeting}` |
| `recentTransactions()`   | Array of 5 `{date,type,amount,description,by}` rows.              |
| `groupMembers()`         | Array of 6 `{name,role,contributed,status}` rows.                 |

---

## `utils/` — Shared formatting helpers

### `utils/formatters.js`
Pure functions. No DB, no req/res.
Dual-used: (a) imported directly by controllers if needed, (b) registered as Handlebars helpers in `config/hbs.js` so templates can call them with `{{helper arg}}` syntax.

| Helper       | Input example          | Output               | Template use                                              |
| ------------ | ---------------------- | -------------------- | --------------------------------------------------------- |
| `gt a b`     | `gt amount 0`          | `true/false`         | `{{#if (gt amount 0)}} deposit color {{else}} wd color {{/if}}` |
| `eq a b`     | `eq status 'Active'`   | `true/false`         | `{{#if (eq status 'Active')}} green badge {{/if}}`        |
| `initial`    | `"Jane Mwangi"`        | `"J"`                | Circular avatar letter.                                   |
| `emailName`  | `"Jane Mwangi"`        | `"jane.mwangi"`      | Fake email display in members table.                      |
| `formatKES`  | `388000`               | `"KSh 388,000"`      | All KPI card amounts.                                     |
| `signedKES`  | `-2000` / `5000`       | `"-KSh 2,000"` / `"+KSh 5,000"` | Transactions amount column.                  |

Also exports `{helpers}` as a ready-to-plug object containing all 6 fns.

---

## `views/` — Handlebars templates

### `views/layouts/main.hbs` — Shared shell
**Every page renders inside this wrapper** (it's `defaultLayout: "main"`). Content:
- `<head>` → meta, dynamic `<title>{{title}} - Chama...</title>`, `/css/login.css` link, inline global reset + header/footer styles.
- `<body>` → `<header>` with gradient + logo "Chama" + **conditional nav** (the `{{#if user}}` block powered by userLocals middleware).
- `<main>{{{body}}}</main>` — **triple braces** because body is HTML, not escaped text.
- `<footer>` copyright.
- `<script src="/login.js">` — legacy client file.

> 💡 Every `<h1>` / paragraph you write in `home.hbs`, `login.hbs`, `dashboard.hbs` goes into that `{{{body}}}` slot.

### `views/partials/README.txt`
Currently just a guide, no HTML partials yet. Suggested snippets to add later:
- `_stat_card.hbs` — 4 identical dashboard stat cards.
- `_flash.hbs` — one-time form-error alerts.
- `_navbar.hbs` / `_footer.hbs` — refactor them out of main.hbs.

### `views/home.hbs`
Pure marketing landing page:
1. **Hero** — social-proof chip, gradient headline ("Save Together. Grow Together."), dual CTAs.
2. **How it works** — 3 feature cards (Create Group / Track Every Shilling / Loans & Rotations).
3. **CTA banner** — dark gradient, "Ready to modernize your Chama?" + free start button.

No inline JS. No forms.

### `views/login.hbs`
Dual template driven by `isRegister` boolean (set by authController):
- **Header text** swaps "Welcome Back / Create Account" + subtitle.
- **Login mode** → 2 fields (email, password), forgot-password, remember me, "Create account" link.
- **Register mode** → 4 fields (name, email, chama group name, password), "Sign in" link back.
- All inline focus-styles + button hover animations. Focus effect classes (`auth-field__input:focus`) also exist in `public/css/login.css` for future extraction.

### `views/dashboard.hbs`
The main logged-in experience. 5 sections, all powered by the controller's data:

1. **Top greeting row** — "Welcome, Jane Mwangi 👋 / Mountain View Chama · Treasurer" + 2 action buttons.
2. **4 Stat cards grid** (CSS Grid auto-fit):
   - Total Savings (green icon + 12.4% delta)
   - This Month (blue icon, 66% progress bar vs target)
   - Group Members (purple icon, 11 active · 1 pending)
   - Outstanding Loans (red icon, 2 active loans)
3. **Transactions 2-col grid**:
   - Left: Recent Transactions table (type badge green/red, signed KSh column colored).
   - Right: Upcoming sidebar → monthly meeting card + contribution-due reminder + yearly-goal progress (64.7%).
4. **Members table**: avatar initial + name + fake email, role, `formatKES(contributed)`, status badge, View action.

All helpers use the 6 `utils/formatters.js` fns registered in config.

---

## `public/` — Static assets (CSS, JS, images)

Served from root via `express.static(path.join(__dirname, "..", "public"))`.
A file at `public/css/login.css` is reachable at URL `/css/login.css`.

### `public/css/login.css`
Documented with section headers. Split into 4 parts:

| Section # | Title                        | Covers                                                                 |
| --------- | ---------------------------- | ---------------------------------------------------------------------- |
| 1         | LOGIN / REGISTER CARD        | `.auth-card*`, `.auth-field*`, `.auth-btn`, `.auth-divider`, `.auth-switch`, `.auth-legal` classes. |
| 2         | LAYOUT HELPERS               | `.chama-container` (1280px centered), `.chama-btn`, `.chama-btn--primary/--ghost`. |
| 3         | BADGES                       | `.badge`, `.badge--success/danger/warn` (status chip & type chip colors). |
| 4         | DASHBOARD TABLES             | `.dash-table*`, `.text-right`, `.amount-pos/neg` classes, future table extraction target. |

👉 **Currently** templates still use inline styles for most things. Over time, refactor them by adding a class here and removing the inline style — this keeps templates short and semantic.

### `public/login.js` + `public/js/login.js`
Legacy placeholder files. `main.hbs` loads `/login.js`. Expand them with client-side validation / interactions as needed.

---

## `work-record/` — Dev progress log

### `work-record/README.md`
Human-readable log. Contains:
- Project overview + structure snapshot + last-updated date.
- Dep table, port, status.
- Server bug fixes applied (views → views, cookie options typo, etc.)
- Helpers list, routes table.
- Per-view descriptions.
- **Render verification results table** (all 6 scenarios pass, char counts).
- **Completed Tasks** list (19 items as of today).
- **Next Steps** checklist: Mongoose hookups, bcrypt, CSRF, split styles, React wiring.
- Notes: port 3000, `.hbs` extension, demo auth caveat.

---

## `login-app/` — Standalone React frontend (optional)

Separate project. Has its own `package.json` (React, TS, Vite, Tailwind, a **massive** set of pre-built UI components under `src/components/ui/` — accordion, alert, button, calendar, card, dialog, dropdown, form, input, table, tooltip, etc.).
**Not connected to the Express server today.** To wire it up:
1. Run `npm run dev` inside `login-app/` (Vite dev server, separate port, e.g. 5173).
2. Add a `routes/api/` folder in Express (JSON, no res.render).
3. Call those endpoints from Vite app via fetch / axios.
4. For production: run `vite build` → copy `dist/` into Express `public/` or host separately.

(Details on this sub-project are in its own `login-app/README.md`.)

---

## 🔁 Request Flow — what happens when a user clicks a link

*Example: user types `http://localhost:3000/dashboard` into the URL bar while NOT logged in.*

```
1. browser → GET http://localhost:3000/dashboard
2. server.js (entry)
     │
3. ├─ app = createApp() runs middlewares in order:
     │  ├─ express.urlencoded (parses body if any)
     │  ├─ express.static (no static file at /dashboard → pass through)
     │  ├─ express-session → req.session = {} (empty, no cookie)
     │  ├─ userLocals middleware → res.locals.user = null
     │
4. Router matching:
     │  ├─ routes/home.js     → no match
     │  ├─ routes/auth.js     → no match
     │  └─ routes/dashboard.js→ MATCHES GET /dashboard
     │       │
     │       └─ pipeline: authGuard runs FIRST
     │               │
     │               └─ checks: req.session.user ?
     │                  └─ undefined → authGuard writes res.redirect("/login")
     │                     Controller NEVER runs.
     │
5. Browser receives 302 Location: /login → redirects.

6. GET /login:
     routes/auth.js → authController.showLogin → res.render("login", {title:"Login"})
       └─ render wraps with layouts/main.hbs:
            res.locals.user = null → nav shows "Home · Login · Register"
       └─ browser sees the login card.
```

*If user IS logged in and visits /dashboard:*
```
authGuard passes → dashboardController.showDashboard:
    → chamaData.dashboardStats() + recentTransactions() + groupMembers()
    → res.render("dashboard", { user, stats, txns, members })
       └─ layout shows "Home · Dashboard · Logout" in header.
```

---

## 🧭 How to add a new feature (walkthrough)

**Goal:** add a protected `/members` page listing all members.

### Step 1 — Controller
Create `controllers/memberController.js`:
```js
const { groupMembers } = require("../services/chamaData");
exports.showMembers = (req, res) => {
  res.render("members", { title: "Members", members: groupMembers() });
};
```

### Step 2 — View
Create `views/members.hbs` (uses `{{#each members}}` + helpers).

### Step 3 — Route
Create `routes/members.js`:
```js
const router = require("express").Router();
const authGuard = require("../middlewares/authGuard");
const ctl = require("../controllers/memberController");
router.get("/members", authGuard, ctl.showMembers);
module.exports = router;
```

### Step 4 — Mount (in `server.js`):
```js
const memberRoutes = require("./routes/members");
app.use(memberRoutes);
```

### Step 5 — Update work-record/README.md completed tasks.

Done. 5 tiny edits — each in the folder that owns that concern. No 500-line "god file" to touch.

---

## ✅ Verified Working

- All 6 HBS template render scenarios pass.
- All 4 routes return expected status codes (`/` → 200, `/login` → 200, `/register` → 200, `/dashboard` anon → 302 redirect to `/login`).
- Integration test exits with code **0** ✅.
- Modular `server.js` starts cleanly, uses correct port 3000.

---

*End of README — search for file names inside this doc to jump directly to their purpose.*

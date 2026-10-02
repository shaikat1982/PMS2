# Instacall PM

A self-hosted project management app, similar to ClickUp, for software development, SEO, digital marketing and operations teams.

## Features

- **Spaces → Projects → Tasks → Subtasks.** Four spaces are created by default: Software Development, SEO, Digital Marketing and Operations. Add more at any time.
- **Tasks** have:
  - a status: To Do, In Progress, In Review, Blocked or Done
  - a priority: Urgent, High, Normal or Low
  - more than one assignee, plus start and due dates
  - an hour estimate, tags, a description, subtasks, a checklist, time logs, comments with @mentions, and a full activity history
- **Views:**
  - **List:** group by status, priority, due date, assignee or project, and edit fields inline.
  - **Board:** Kanban view. Drag cards to change a task's status or priority.
  - **Calendar:** month or week view. Drag tasks to reschedule them, or drag tasks that have no date onto a day.
- **Dashboard:**
  - KPIs: open, in progress, overdue, due this week and completed tasks
  - Charts: tasks by status, open tasks by priority, and created vs. completed tasks over the last 14 days
  - Lists: my tasks, overdue tasks, upcoming deadlines, progress for each space and project, team workload and recent activity
  - Filter everything by space.
- **My Tasks:** everything assigned to you, grouped into Overdue, Today, Next 7 days, Later and No date.
- **Team management:**
  - Members, with three roles: admin, manager and member
  - Teams (Engineering, SEO, Marketing, Operations)
  - A workload view showing open, overdue and high-priority tasks and estimated hours for each person
  - Deactivate an account instead of deleting it.
- **Inbox:** you get a notification when someone assigns you, @mentions you, comments on your task, changes its status, priority or due date, or attaches a file, plus a reminder the day before a task is due and an alert when it becomes overdue. Each person chooses which of these they get in-app and by email (**Inbox → Notification settings**).
- **Attachments:** drag files onto a task (or click Upload). Images, PDFs, text, audio and video preview in the app; everything can be downloaded. Uploads show in the task's activity history.
- **Global search** (Ctrl+K). A task you open gets a shareable link (`?task=123`). The app supports dark mode and works on phones.

### Software Development projects

A project is either **General** or **Software Development** (set when you create or edit it). Every project gets these tabs:

| Tab | What it shows |
|-----|---------------|
| Overview | Overall progress, progress for each phase, milestones, releases, overdue and delayed items, open bugs |
| Tasks | The List, Board and Calendar views |
| Timeline | A Gantt chart of phases, milestones, releases and key tasks, with dependency arrows. Drag a bar to move it, or drag either end to resize it. |
| Planning | Phases, milestones and releases, with planned dates, actual dates and how far off plan each one is |
| Development | Connected Git repositories, plus their commits, pull requests and branches *(Software Development projects only)* |
| Reports | Progress (planned vs actual), Bugs *(Software Development projects only)* and Team workload. You can print any report or save it as a PDF. |

- **Task types:** Task, Feature, Bug and User Story. A bug also has a severity, environment, affected version, steps to reproduce, expected result and actual result.
- **Phases:** use phases instead of sprints. New Software Development projects start with Planning → Development → Testing → Deployment → Maintenance, linked finish-to-start. If the project has a start and due date, the phases are spread across that period.
- **Milestones:** each milestone has a target date, a completion date, an owner, a status, progress and a weight. Milestone owners are alerted when a milestone is overdue.
- **Releases:** releases are versions such as v2.0.0. Link tasks and bugs to a release to track its progress.
- **Progress:** each phase or milestone either calculates its progress from its linked tasks or lets you set it by hand. Overall project progress is either the share of tasks that are done or the weighted average of milestone progress.
- **States:** everything shows as Completed, In progress, Delayed or Not started, the same way everywhere. Delayed means the planned end date has passed without the item being completed.
- **References and links:** phases, milestones, releases and tasks have IDs like `PH-2`, `MS-5`, `REL-1` and `TASK-42`. Each one has a link, for example `/projects/1?tab=planning&item=MS-5`. You can also search for a task by typing `TASK-42`.
- **Dependencies:** any two items can be linked finish-to-start or start-to-start. When an item moves later, everything that depends on it moves later too and keeps its length. The app rejects dependencies that would form a loop.
- **Key tasks:** star a task to show it on the timeline. You can also switch the timeline to show every task that has dates.

#### Git integration (GitHub, GitLab, Bitbucket)

1. On a project's **Development** tab, choose **Connect repository** and paste the repository URL. An access token is optional; you need one for private repositories and for **Sync**. Only read access is required. Tokens are stored encrypted.
2. Choose **Webhook setup** and add the payload URL and secret to the repository's webhook settings. This sends pushes, new branches and pull/merge requests to the app as they happen. Webhooks only work if the provider can reach your server. Without webhooks, use **Sync** to pull in recent history.
3. To link Git activity to a task, mention `TASK-42` (or `task-42`) in a branch name, commit message or pull request title. You can also paste a branch, commit or pull request URL into the task's **Development** section. Linked activity appears inside the task and in its history.

The demo data includes an example repository with sample commits and pull requests. The repository itself is a placeholder, so its links and Sync don't work.

### Roles

| Role    | Can do                                                          |
|---------|-----------------------------------------------------------------|
| Admin   | Everything, including adding, editing and deactivating users    |
| Manager | Create and edit spaces, projects and teams; delete any task; manage phases, milestones, releases and repositories in any project |
| Member  | Create, edit, comment on, attach files to and track time on tasks; link tasks to each other and to Git activity. A project's owner can also manage its plan and repositories. |

## Tech stack

- **Backend:** Node.js 20.6 or later, Express 5 and PostgreSQL 13 or later, through the `pg` driver. Authentication uses JWTs. Email goes out through Nodemailer over SMTP.
- **Frontend:** React 19, React Router and Vite. The styling is plain CSS, with no UI framework.

## Getting started

You need a PostgreSQL database. The quickest way to get one is Docker:

```bash
npm install
npm run db:up    # starts PostgreSQL in Docker (docker-compose.yml) on localhost:5432
npm run seed     # optional: load demo users, projects and tasks
npm run dev      # API on :3001, web app on http://localhost:5173
```

Without Docker, install PostgreSQL yourself, create an empty database, and set `DATABASE_URL` to point at it. If you don't set it, the app uses `postgres://postgres:postgres@localhost:5432/instacall`, which matches the Docker setup:

```bash
# macOS / Linux
export DATABASE_URL=postgres://user:password@localhost:5432/instacall
# Windows PowerShell
$env:DATABASE_URL = "postgres://user:password@localhost:5432/instacall"
```

Each time the server starts, it creates or updates the database tables automatically (see `server/db.js`).

The first time the server starts with an empty database, it creates an admin account and the four default spaces:

- **Email:** `admin@instacall.local`
- **Password:** `admin123`

To set your own admin account on first start instead, set the `ADMIN_EMAIL`, `ADMIN_PASSWORD` and `ADMIN_NAME` environment variables.

The demo data (`npm run seed`) adds 9 more users, all with the password `password123`, for example `sarah@instacall.local`. **Running the seed wipes the database**, so don't run it once you have real data.

## Production

```bash
npm run build    # builds the frontend into dist/
npm start        # serves the API and the built app on PORT (default 3001)
```

Environment variables:

| Variable        | Default     | Purpose                                                              |
|-----------------|-------------|----------------------------------------------------------------------|
| `PORT`          | `3001`      | HTTP port                                                            |
| `DATABASE_URL`  | `postgres://postgres:postgres@localhost:5432/instacall` | PostgreSQL connection string |
| `DATABASE_SSL`  | off         | Set to `true` for hosted databases that require SSL (most cloud providers). If the provider uses a self-signed certificate, also set `DATABASE_SSL_REJECT_UNAUTHORIZED=false`. |
| `DATABASE_POOL_SIZE` | `10`   | Maximum number of database connections for each app server |
| `APP_TIMEZONE`  | server's time zone | IANA time zone, e.g. `Asia/Dhaka`, used to decide what counts as "today", "overdue" and "this week" |
| `DATA_DIR`      | `./data`    | Where attachments and the generated JWT secret are kept |
| `JWT_SECRET`    | auto        | Token signing secret. If not set, one is generated and saved to `DATA_DIR`. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | see above | First admin account |
| `APP_URL`       | `http://localhost:5173` | The address people open the app at. Links in emails point here. |
| `SMTP_HOST`     | —           | SMTP server. Email notifications are off until this is set. |
| `SMTP_PORT`     | `587`       | SMTP port. Port 465 uses TLS automatically. |
| `SMTP_SECURE`   | auto        | Set to `true` or `false` to override the TLS choice. |
| `SMTP_USER` / `SMTP_PASS` | — | SMTP login |
| `MAIL_FROM`     | `SMTP_USER` | The From address, e.g. `Instacall PM <pm@example.com>` |
| `MAX_UPLOAD_MB` | `25`        | Largest attachment allowed, in MB |

Emails are queued in the database and sent in the background. A failed send is retried up to 5 times. Admins can check delivery and send a test email from **Inbox → Notification settings**.

Attachments are stored in `DATA_DIR/attachments`. Git access tokens are encrypted with a key derived from `JWT_SECRET`, so if you change the secret, enter the tokens again.

**Backups:** back up the database with `pg_dump` (for example `pg_dump "$DATABASE_URL" > instacall.sql`), or use your host's automatic backups. Back up the `data/` directory too, because it holds the attachments.

**Running more than one app server:** several servers can share one database. Set the same `JWT_SECRET` on each, and give them a shared `DATA_DIR` (a network volume) so they all see the same attachments. Migrations, email sending and reminders are designed so that only one server does each job.

Put the app behind a reverse proxy with HTTPS (nginx, Caddy, IIS) when you expose it to the internet.

### Moving from the old SQLite version

Earlier versions stored data in `data/instacall.db` (SQLite). To bring that data across:

1. Point `DATABASE_URL` at an empty PostgreSQL database.
2. Run `npm run import:sqlite -- data/instacall.db`. This needs Node 22.13 or later, which can read SQLite files.
3. Keep the `data/attachments` folder (and `data/.jwt-secret`, unless you set `JWT_SECRET`) in `DATA_DIR`.

## Project layout

```
server/
  index.js          Express app and static hosting
  db.js             PostgreSQL pool, query helpers, transactions and schema migrations
  auth.js           JWT auth, role checks, signed file links, token encryption
  bootstrap.js      First-run admin account and default spaces
  seed.js           Demo data (npm run seed)
  taskQuery.js      Shared task query and hydration
  planning.js       Progress and state of timeline items, dependency rescheduling
  reports.js        Progress, bug and team reports
  notify.js         Notifications with per-user in-app/email preferences
  mailer.js         SMTP email outbox and sender
  reminders.js      Hourly due-soon and overdue alerts, attachment cleanup
  tools/            import-sqlite.js: one-time import from the old SQLite database
  routes/           auth, users, teams, spaces, projects, tasks, dashboard, notifications,
                    planning (phases, milestones, releases, dependencies), git, attachments
client/src/
  main.jsx          Routes and app shell
  store.jsx         Global state (user, spaces, projects, users) and the useTasks hook
  components/       Layout, task detail modal, create modal, pickers, modals, attachments, Git links
  views/            ListView, BoardView, CalendarView
  pages/            Dashboard, MyTasks, AllTasks/Calendar, Space, Team, Inbox, Login
  project/          Project page tabs: Overview, Timeline (Gantt), Planning, Development, Reports
```

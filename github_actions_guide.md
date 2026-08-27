# GitHub Actions CI/CD Guide — Bun + Elysia on AWS EC2

> **Goal:** Practice GitHub Actions by wiring up a real CI/CD pipeline — lint/test on every PR, auto-deploy to EC2 on merge to `main`, and eventually add an integration-test stage.

---

## Project Structure (what you already have)

```
cicd-test/
├── src/
│   ├── index.ts          ← entry point
│   └── routes/
│       ├── health.ts
│       └── users.ts
├── package.json
├── tsconfig.json
└── .gitignore
```

---

## Phase 1 — Push to GitHub

### 1.1 Initialize the repo

```bash
cd /mnt/devwork/Dev/web/cicd-test
git init
git add .
git commit -m "chore: initial bun + elysia server"
```

### 1.2 Create the remote repo

Go to **github.com → New repository** → name it `cicd-test` → **don't** initialize with README.

```bash
git remote add origin git@github.com:<YOUR_USERNAME>/cicd-test.git
git branch -M main
git push -u origin main
```

> [!TIP]
> Use SSH remote (`git@github.com:...`) — it avoids token hassles in Actions later.

---

## Phase 2 — Provision an AWS EC2 Instance

### 2.1 Launch an instance

| Setting | Value |
|---------|-------|
| AMI | Ubuntu 24.04 LTS |
| Instance type | `t3.micro` (free tier) |
| Key pair | Create new → download `.pem` |
| Security Group | Allow SSH (22), HTTP (80), and your app port (3000) |

> [!IMPORTANT]
> Open **port 3000** in the Security Group inbound rules — that's where Elysia listens.

### 2.2 Connect and install Bun

```bash
# From your local machine
chmod 400 your-key.pem
ssh -i your-key.pem ubuntu@<EC2_PUBLIC_IP>

# On EC2
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
bun --version   # verify
```

### 2.3 Clone your repo on EC2

```bash
# On EC2
git clone https://github.com/<YOUR_USERNAME>/cicd-test.git ~/app
cd ~/app
bun install
bun run start   # verify it starts
```

---

## Phase 3 — Create a systemd Service (keep app alive)

Create `/etc/systemd/system/cicd-test.service` on EC2:

```bash
sudo nano /etc/systemd/system/cicd-test.service
```

Paste:

```ini
[Unit]
Description=Bun + Elysia CI/CD Test Server
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/app
ExecStart=/home/ubuntu/.bun/bin/bun run start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable cicd-test
sudo systemctl start cicd-test
sudo systemctl status cicd-test   # should show Active: running
```

Test it from your local machine:

```bash
curl http://<EC2_PUBLIC_IP>:3000/health
```

---

## Phase 4 — Configure GitHub Secrets

Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**.

Add these secrets:

| Secret Name | Value |
|-------------|-------|
| `EC2_HOST` | Your EC2 public IP or DNS |
| `EC2_USER` | `ubuntu` |
| `EC2_SSH_KEY` | Full contents of your `.pem` file |

> [!CAUTION]
> Paste the **entire** `.pem` file including `-----BEGIN RSA PRIVATE KEY-----` and `-----END RSA PRIVATE KEY-----` lines.

---

## Phase 5 — The GitHub Actions Workflows

Create the directory:

```bash
mkdir -p .github/workflows
```

### Workflow 1 — CI (run on every PR)

**`.github/workflows/ci.yml`**

```yaml
name: CI

on:
  pull_request:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install

      - name: Type check
        run: bun tsc --noEmit

      # When you add tests later:
      # - name: Run tests
      #   run: bun test
```

> [!NOTE]
> This workflow fires on every PR opened against `main`. You'll see a green/red check on each PR before merging.

---

### Workflow 2 — CD (deploy on merge to main)

**`.github/workflows/cd.yml`**

```yaml
name: CD — Deploy to EC2

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Deploy to EC2 via SSH
        uses: appleboy/ssh-action@v1.2.0
        with:
          host: ${{ secrets.EC2_HOST }}
          username: ${{ secrets.EC2_USER }}
          key: ${{ secrets.EC2_SSH_KEY }}
          script: |
            cd ~/app
            git pull origin main
            bun install
            sudo systemctl restart cicd-test
            sleep 3
            curl -f http://localhost:3000/health || exit 1
```

> [!IMPORTANT]
> The last `curl` acts as a **smoke test** inside the deployment. If the server doesn't respond, the workflow step fails — giving you a red check and an email alert.

---

## Phase 6 — Test the Full Pipeline

### Happy path

```bash
# On your local machine
git checkout -b feature/add-ping-route
# ... make a small code change ...
git add . && git commit -m "feat: add /ping route"
git push origin feature/add-ping-route
```

1. Open a PR on GitHub → **CI workflow triggers** → wait for green check.
2. Merge the PR → **CD workflow triggers** → watch it SSH into EC2 and restart the server.
3. `curl http://<EC2_PUBLIC_IP>:3000/health` — confirm new code is live.

### Failure path (intentional)

Break something on purpose (e.g., a TypeScript error), push, and observe the CI workflow fail and block the PR.

---

## Phase 7 — Integration Tests (next step)

When you're ready to add integration testing, here's the pattern.

### 7.1 Add a test file

```bash
# in your project
touch src/routes/health.test.ts
```

```typescript
// src/routes/health.test.ts
import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { healthRoutes } from "./health";

const app = new Elysia().use(healthRoutes);

describe("GET /health", () => {
  it("returns status ok", async () => {
    const res = await app.handle(new Request("http://localhost/health"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
  });
});
```

Run locally with:

```bash
bun test
```

### 7.2 Update the CI workflow to run tests

```yaml
# In .github/workflows/ci.yml, add this step after type-check:
- name: Run tests
  run: bun test
```

### 7.3 Integration workflow (separate job, runs after deploy)

**`.github/workflows/integration.yml`**

```yaml
name: Integration Tests

on:
  workflow_run:
    workflows: ["CD — Deploy to EC2"]
    types: [completed]

jobs:
  integration:
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2

      - name: Install deps
        run: bun install

      - name: Run integration tests against live EC2
        env:
          BASE_URL: http://${{ secrets.EC2_HOST }}:3000
        run: bun test --filter integration
```

> [!TIP]
> Tag integration tests with a `.integration.test.ts` suffix so you can run them separately from unit tests.

---

## Quick Reference

```
PR opened      →  CI workflow  →  type-check  →  (tests)
PR merged      →  CD workflow  →  SSH pull + restart + smoke test
After deploy   →  Integration  →  hit live EC2 endpoints
```

### Useful commands on EC2

```bash
# Check service status
sudo systemctl status cicd-test

# View live logs
sudo journalctl -u cicd-test -f

# Manual restart
sudo systemctl restart cicd-test

# Check if port is open
ss -tlnp | grep 3000
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| SSH permission denied in Actions | Check `EC2_SSH_KEY` secret includes full PEM content |
| Port 3000 unreachable from outside | Add inbound rule in EC2 Security Group |
| `bun: command not found` in systemd | Use absolute path: `/home/ubuntu/.bun/bin/bun` |
| Workflow doesn't trigger | Check branch name matches exactly (`main` vs `master`) |
| `git pull` fails on EC2 | Repo is private → add a deploy key to GitHub repo settings |

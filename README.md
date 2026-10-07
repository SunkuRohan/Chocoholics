# Chocoholics (DevOps practice project)

A small shop app: Node.js + Express backend, Postgres database, Docker Compose.
Customers can browse hampers, build their own, create an account, order, repeat orders and write reviews.
Admin page: /admin.html (orders and review approval).

## Run it on EC2 (3 steps)

1. Launch an Ubuntu 24.04 (or Amazon Linux 2023) instance. In its security group allow SSH (22) and port 3000, both from your IP only.
2. Get this folder onto the instance (pick one):
   - Push it to a GitHub repo (web upload is fine), then `git clone <repo-url> && cd chocoholics`
   - Or upload `chocoholics.zip` to S3 in the console, give the instance an IAM role with read access, then
     `aws s3 cp s3://<bucket>/chocoholics.zip . && unzip chocoholics.zip && cd chocoholics`
3. Run: `./setup.sh`

`setup.sh` installs Docker, creates `.env` with a random database password, builds and starts the stack,
waits until it is healthy, and prints the URLs. It is safe to run again.

## First login
- Admin: username `admin`, password `admin`. The admin area stays locked until you set a new password.
- Customers create their own accounts from the Log in link.

## Everyday commands (run in this folder)
| Task | Command |
|---|---|
| See containers | `sudo docker compose ps` |
| App logs | `sudo docker compose logs -f app` |
| Database shell | `sudo docker compose exec db psql -U chocoholics chocoholics` |
| Back up the database | `./backup.sh` |
| Restore a backup | `./restore.sh backups/<file>.sql.gz` |
| Rebuild after changes | `sudo docker compose up -d --build` |
| Stop (keep data) | `sudo docker compose down` |
| Stop and delete data | `sudo docker compose down -v` |

## What is in the folder
- `public/` the website and admin page
- `server.js`, `catalog.js` backend (the server decides all prices)
- `Dockerfile`, `docker-compose.yml` container setup (app + Postgres, data in the `pgdata` volume)
- `setup.sh`, `backup.sh`, `restore.sh` helper scripts
- `test/` unit tests (`npm test`) and `.github/workflows/ci.yml` (runs the tests and builds the image on every push)
- Optional, for HTTPS with a domain: `docker-compose.prod.yml` and `Caddyfile`

## Notes
- Sample prices and sample reviews are placeholders. The WhatsApp number is a placeholder near the top of the script in `public/index.html`.
- Orders, accounts and reviews live only in the Postgres volume on that instance. Run `./backup.sh` before you delete anything.
- There is no forgot-password email flow.

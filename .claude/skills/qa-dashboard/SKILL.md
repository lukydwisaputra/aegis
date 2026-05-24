---
name: qa-dashboard
description: Manage the QA metrics dashboard lifecycle — start, stop, status, build, and preview
---

# /qa-dashboard

## Purpose
Controls the local QA metrics dashboard — a web UI that visualises run history, coverage trends, defect counts, and cost analytics. Supports starting/stopping the dev server, building a static export for sharing, and previewing a production build. Backed by a lightweight API server that reads from the `runs/` directory.

## Usage
```
/qa-dashboard <start|stop|status|build|preview> [--port=3030] [--api-port=3031] [--no-open] [--host=0.0.0.0]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `start` | *(subcommand)* | Start the dashboard dev server |
| `stop` | *(subcommand)* | Stop a running dashboard server |
| `status` | *(subcommand)* | Report whether the server is running and on which port |
| `build` | *(subcommand)* | Build a static export to `dashboard/dist/` |
| `preview` | *(subcommand)* | Serve the static build for production preview |
| `--port` | `3030` | Dashboard UI port |
| `--api-port` | `3031` | API server port |
| `--no-open` | `false` | Do not auto-open the browser on start |
| `--host` | `localhost` | Bind host; use `0.0.0.0` to expose on LAN |

## Behaviour
1. **start**: Spawn the dashboard UI server on `--port` and the API server on `--api-port`. Write PIDs to `dashboard/.pids`. Open browser unless `--no-open`.
2. **stop**: Read PIDs from `dashboard/.pids` and send SIGTERM to both processes. Remove `.pids` file.
3. **status**: Check for running processes via `.pids`; report port binding and uptime.
4. **build**: Run the dashboard build command; output goes to `dashboard/dist/`. Report build size.
5. **preview**: Serve `dashboard/dist/` on `--port` using a static file server.

## Events emitted
- `dashboard.started` — port, api-port, url
- `dashboard.stopped` — uptime
- `dashboard.built` — dist path, bundle size

## Example
```
/qa-dashboard start --port=3030 --no-open
```
Starts the dashboard server on port 3030 without opening a browser tab.

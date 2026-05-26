#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "boto3>=1.34",
#   "click>=8.1",
#   "python-dotenv>=1.0",
# ]
# ///
"""Migrate R2 screenshots to content-addressed v2/<sha256>.png keys.

The legacy key scheme (<emulator>/<short>/<game_id>/<frame>.png) stores a distinct
object per submission even when PNGs are byte-identical. Keying by content hash
collapses duplicates. Every submission JSON already records each PNG's sha256, so:

  copy-objects   server-side copy each unique sha256 from one legacy key to
                 v2/<sha256>.png (no download/re-upload). Old keys are left intact.
  rewrite-meta   rewrite every screenshots[].r2_key in meta/submissions/**/*.json
                 to v2/<sha256>.png. Pure local transform; does not git-commit.

Typical run: `copy-objects` first (so no JSON points at a missing object), then
`rewrite-meta`, then review the diff and commit. Creds come from a .env (same
resolution as submit-screenshots.py: --env-file > <archive>/.env > cwd walk-up).

The small R2 helpers below are duplicated from submit-screenshots.py on purpose:
these are standalone `uv run` scripts that can't cleanly import each other.
"""

from __future__ import annotations

import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

import boto3
import click
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError
from dotenv import load_dotenv


IMMUTABLE_CACHE = "public, max-age=31536000, immutable"


@dataclass(frozen=True)
class R2Config:
    endpoint: str
    access_key_id: str
    secret_access_key: str
    bucket: str


def load_r2_config(env: dict[str, str] | None = None) -> R2Config:
    env = env if env is not None else dict(os.environ)
    missing = [k for k in ("R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET") if not env.get(k)]
    if missing:
        raise click.ClickException(
            f"missing R2 env var(s): {', '.join(missing)}. fill them in a gitignored .env."
        )
    return R2Config(
        endpoint=env["R2_ENDPOINT"],
        access_key_id=env["R2_ACCESS_KEY_ID"],
        secret_access_key=env["R2_SECRET_ACCESS_KEY"],
        bucket=env["R2_BUCKET"],
    )


def make_r2_client(cfg: R2Config, *, pool_connections: int = 10):  # type: ignore[no-untyped-def]
    # max_pool_connections must be >= worker count, else threads queue behind the
    # default 10-connection pool and effective concurrency is capped at 10.
    return boto3.client(
        "s3",
        endpoint_url=cfg.endpoint,
        aws_access_key_id=cfg.access_key_id,
        aws_secret_access_key=cfg.secret_access_key,
        config=BotoConfig(
            signature_version="s3v4",
            max_pool_connections=pool_connections,
            retries={"max_attempts": 5, "mode": "standard"},
        ),
        region_name="auto",
    )


def list_existing_keys(client, cfg: R2Config, prefix: str) -> set[str]:  # type: ignore[no-untyped-def]
    """List every object key already present under prefix (one paginated pass)."""
    keys: set[str] = set()
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=cfg.bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            keys.add(obj["Key"])
    return keys


def v2_key_for(sha256: str) -> str:
    return f"v2/{sha256}.png"


def submission_files(archive_repo: Path) -> list[Path]:
    root = archive_repo / "meta" / "submissions"
    if not root.is_dir():
        raise click.ClickException(f"no submissions dir at {root}")
    return sorted(root.rglob("*.json"))


def collect_sha_sources(archive_repo: Path) -> dict[str, str]:
    """Map sha256 -> one legacy source key (first seen). Skips already-v2 keys."""
    sources: dict[str, str] = {}
    for path in submission_files(archive_repo):
        data = json.loads(path.read_text(encoding="utf-8"))
        for shot in data.get("screenshots", []):
            sha = shot["sha256"]
            key = shot["r2_key"]
            if key.startswith("v2/"):
                continue
            sources.setdefault(sha, key)
    return sources


def load_env_files(*, explicit: Path | None, archive_repo: Path) -> list[Path]:
    """Load .env files. Shell env wins. Explicit > script dir > archive/.env > cwd."""
    loaded: list[Path] = []
    if explicit and load_dotenv(dotenv_path=explicit, override=False):
        loaded.append(explicit.resolve())
    script_env = Path(__file__).resolve().parent / ".env"
    if script_env.is_file() and load_dotenv(dotenv_path=script_env, override=False):
        loaded.append(script_env.resolve())
    archive_env = archive_repo / ".env"
    if archive_env.is_file() and load_dotenv(dotenv_path=archive_env, override=False):
        loaded.append(archive_env.resolve())
    if load_dotenv(override=False):
        loaded.append(Path(".env").resolve())
    seen: set[Path] = set()
    return [p for p in loaded if not (p in seen or seen.add(p))]


def default_archive_repo() -> Path:
    return Path(__file__).resolve().parent.parent


@click.group(context_settings={"help_option_names": ["-h", "--help"]})
def cli() -> None:
    """Migrate R2 screenshots to content-addressed v2/<sha256>.png keys."""


@cli.command("copy-objects")
@click.option("--archive-repo", type=click.Path(path_type=Path, file_okay=False),
              default=None, help="emu.layle.dev repo. [default: this script's repo]")
@click.option("--env-file", "env_file", type=click.Path(path_type=Path, exists=True, dir_okay=False),
              default=None, help="Load R2 env from this file. Shell env wins.")
@click.option("--workers", type=int, default=64, show_default=True,
              help="Number of parallel copy threads (also sizes the connection pool).")
@click.option("--dry-run", is_flag=True, help="Report what would be copied. No R2 writes.")
def copy_objects(archive_repo: Path | None, env_file: Path | None, workers: int, dry_run: bool) -> None:
    """Server-side copy each unique sha256 from a legacy key to v2/<sha256>.png."""
    archive_repo = (archive_repo or default_archive_repo()).resolve()
    for p in load_env_files(explicit=env_file, archive_repo=archive_repo):
        click.echo(f"loaded env from {p}", err=True)

    sources = collect_sha_sources(archive_repo)
    click.echo(f"{len(sources)} unique sha256 referenced by legacy keys", err=True)

    if dry_run:
        # No R2 access in dry-run: show the full unique set, not the post-listing delta.
        for sha, src in list(sources.items())[:10]:
            click.echo(f"  [dry-run] {src} -> {v2_key_for(sha)}")
        if len(sources) > 10:
            click.echo(f"  ... and {len(sources) - 10} more")
        click.echo(f"done: {len(sources)} unique object(s) would be copied (minus any already under v2/)")
        return

    cfg = load_r2_config()
    client = make_r2_client(cfg, pool_connections=workers)

    click.echo("listing existing v2/ objects ...", err=True)
    existing = list_existing_keys(client, cfg, "v2/")
    click.echo(f"found {len(existing)} object(s) already under v2/", err=True)

    todo = {sha: src for sha, src in sources.items() if v2_key_for(sha) not in existing}
    click.echo(f"{len(todo)} object(s) to copy", err=True)

    counts = {"done": 0, "copied": 0, "failed": 0}
    failures: list[tuple[str, str, str]] = []  # (sha, src, error)
    lock = threading.Lock()
    total = len(todo)

    def work(item: tuple[str, str]) -> None:
        sha, src = item
        try:
            client.copy_object(
                Bucket=cfg.bucket,
                CopySource={"Bucket": cfg.bucket, "Key": src},
                Key=v2_key_for(sha),
                ContentType="image/png",
                CacheControl=IMMUTABLE_CACHE,
                MetadataDirective="REPLACE",
            )
            ok, err = True, ""
        except ClientError as e:
            ok, err = False, str(e)
        with lock:
            counts["done"] += 1
            if ok:
                counts["copied"] += 1
            else:
                counts["failed"] += 1
                failures.append((sha, src, err))
            if counts["done"] % 500 == 0 or counts["done"] == total:
                click.echo(
                    f"  {counts['done']}/{total} ({counts['copied']} copied, {counts['failed']} failed)",
                    err=True,
                )

    with ThreadPoolExecutor(max_workers=workers) as ex:
        futures = [ex.submit(work, it) for it in todo.items()]
        for fut in as_completed(futures):
            fut.result()

    click.echo(f"done: {counts['copied']} copied, {counts['failed']} failed, {len(existing)} already present")
    if failures:
        click.echo(f"{len(failures)} failure(s):", err=True)
        for sha, src, err in failures[:20]:
            click.echo(f"  {src} -> {v2_key_for(sha)}: {err}", err=True)
        if len(failures) > 20:
            click.echo(f"  ... and {len(failures) - 20} more", err=True)
        raise SystemExit(1)


@cli.command("rewrite-meta")
@click.option("--archive-repo", type=click.Path(path_type=Path, file_okay=False),
              default=None, help="emu.layle.dev repo. [default: this script's repo]")
@click.option("--dry-run", is_flag=True, help="Report changes without writing files.")
def rewrite_meta(archive_repo: Path | None, dry_run: bool) -> None:
    """Rewrite every screenshots[].r2_key in submission JSONs to v2/<sha256>.png."""
    archive_repo = (archive_repo or default_archive_repo()).resolve()

    files_changed = 0
    keys_changed = 0
    for path in submission_files(archive_repo):
        data = json.loads(path.read_text(encoding="utf-8"))
        changed = False
        for shot in data.get("screenshots", []):
            new_key = v2_key_for(shot["sha256"])
            if shot["r2_key"] != new_key:
                shot["r2_key"] = new_key
                keys_changed += 1
                changed = True
        if changed:
            files_changed += 1
            rel = path.relative_to(archive_repo)
            if dry_run:
                click.echo(f"  [dry-run] would rewrite {rel}")
            else:
                path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
                click.echo(f"  rewrote {rel}")

    verb = "would change" if dry_run else "changed"
    click.echo(f"done: {verb} {keys_changed} key(s) across {files_changed} file(s)")


if __name__ == "__main__":
    cli()

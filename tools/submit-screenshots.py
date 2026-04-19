#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "boto3>=1.34",
#   "click>=8.1",
#   "pillow>=10.0",
#   "python-dotenv>=1.0",
# ]
# ///
"""Upload emulator screenshots to R2 and record the submission JSON in emu.layle.dev.

Single copy lives in emu.layle.dev/tools/. Invoke it against any emulator repo.
Creds come from a .env next to the script or an explicit --env-file.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import boto3
import click
from botocore.config import Config as BotoConfig
from dotenv import load_dotenv
from PIL import Image


GAME_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")
IMMUTABLE_CACHE = "public, max-age=31536000, immutable"


@dataclass(frozen=True)
class GitCommit:
    sha: str
    short: str
    parent: str
    branch: str
    subject: str
    timestamp: str


@dataclass(frozen=True)
class R2Config:
    endpoint: str
    access_key_id: str
    secret_access_key: str
    bucket: str


@dataclass(frozen=True)
class ScreenshotPlan:
    game_id: str
    frame_index: int
    source_path: Path


@dataclass(frozen=True)
class GameScan:
    game_id: str
    frames: list[ScreenshotPlan]


@dataclass(frozen=True)
class Screenshot:
    game_id: str
    frame_index: int
    r2_key: str
    width: int
    height: int
    sha256: str


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def read_dimensions(path: Path) -> tuple[int, int]:
    with Image.open(path) as im:
        return im.size


def parse_title_map(path: Path | None) -> dict[str, str]:
    if path is None:
        return {}
    out: dict[str, str] = {}
    for lineno, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise click.ClickException(f"{path}:{lineno}: expected 'game_id=Title'")
        gid, title = line.split("=", 1)
        out[gid.strip()] = title.strip()
    return out


def resolve_title(
    game_id: str,
    *,
    archive_repo: Path,
    emulator: str,
    title_map: dict[str, str],
    interactive: bool,
) -> str:
    if game_id in title_map:
        return title_map[game_id]
    static = archive_repo / "meta" / "games" / emulator / f"{game_id}.json"
    if static.exists():
        try:
            data = json.loads(static.read_text(encoding="utf-8"))
            if isinstance(data, dict) and "title" in data:
                return str(data["title"])
        except (json.JSONDecodeError, OSError) as e:
            click.echo(f"warning: could not read {static}: {e}", err=True)
    if interactive and sys.stdin.isatty():
        return click.prompt(f"title for {game_id}", type=str).strip() or game_id
    click.echo(f"warning: no title for {game_id}, using game_id", err=True)
    return game_id


def _git(*args: str, cwd: Path) -> str:
    r = subprocess.run(["git", *args], cwd=str(cwd), capture_output=True, text=True, check=True)
    return r.stdout.strip()


def read_git_commit(repo: Path) -> GitCommit:
    sha = _git("rev-parse", "HEAD", cwd=repo)
    try:
        parent = _git("rev-parse", "HEAD^", cwd=repo)
    except subprocess.CalledProcessError:
        parent = ""
    return GitCommit(
        sha=sha,
        short=sha[:7],
        parent=parent,
        branch=_git("rev-parse", "--abbrev-ref", "HEAD", cwd=repo),
        subject=_git("log", "-1", "--format=%s", cwd=repo),
        timestamp=_git("log", "-1", "--format=%cI", cwd=repo),
    )


def check_clean_worktree(repo: Path, input_dir: Path, *, allow_dirty: bool) -> None:
    if allow_dirty:
        return
    status = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=str(repo), capture_output=True, text=True, check=True,
    ).stdout
    # Allow the input dir to be untracked. Everything else must be clean.
    try:
        input_rel = input_dir.resolve().relative_to(repo.resolve()).as_posix()
    except ValueError:
        input_rel = None
    dirty = []
    for line in status.splitlines():
        if len(line) < 3:
            continue
        path = line[3:].strip().strip('"').rstrip("/")
        if input_rel and (path == input_rel or path.startswith(input_rel + "/")):
            continue
        dirty.append(line)
    if dirty:
        raise click.ClickException(
            "working tree is dirty. commit, stash, or pass --allow-dirty.\n" + "\n".join(dirty)
        )


def scan_input(input_dir: Path) -> list[GameScan]:
    if not input_dir.is_dir():
        raise click.ClickException(f"input directory does not exist: {input_dir}")
    games: list[GameScan] = []
    for game_dir in sorted(input_dir.iterdir()):
        if not game_dir.is_dir():
            continue
        game_id = game_dir.name
        if not GAME_ID_RE.match(game_id):
            raise click.ClickException(f"invalid game_id {game_id!r}: must match {GAME_ID_RE.pattern}")
        frames: list[ScreenshotPlan] = []
        for png in sorted(game_dir.glob("*.png")):
            try:
                idx = int(png.stem)
            except ValueError:
                raise click.ClickException(f"PNG filename must be an integer: {png}")
            frames.append(ScreenshotPlan(game_id, idx, png))
        indices = [f.frame_index for f in frames]
        if len(indices) != len(set(indices)):
            raise click.ClickException(f"duplicate frame indices in {game_id}")
        games.append(GameScan(game_id, frames))
    return games


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


def make_r2_client(cfg: R2Config):  # type: ignore[no-untyped-def]
    return boto3.client(
        "s3",
        endpoint_url=cfg.endpoint,
        aws_access_key_id=cfg.access_key_id,
        aws_secret_access_key=cfg.secret_access_key,
        config=BotoConfig(signature_version="s3v4"),
        region_name="auto",
    )


def r2_key_for(emulator: str, short: str, game_id: str, frame_index: int) -> str:
    return f"{emulator}/{short}/{game_id}/{frame_index}.png"


def upload_one(client, cfg: R2Config, key: str, source: Path) -> None:  # type: ignore[no-untyped-def]
    with source.open("rb") as f:
        client.put_object(
            Bucket=cfg.bucket, Key=key, Body=f,
            ContentType="image/png", CacheControl=IMMUTABLE_CACHE,
        )


def build_submission(
    *, emulator: str, commit: GitCommit,
    games: Iterable[dict[str, str]], screenshots: Iterable[Screenshot],
    submitted_by: str, submitted_at: str,
) -> dict[str, Any]:
    return {
        "emulator": emulator,
        "commit": commit.sha,
        "commit_short": commit.short,
        "parent": commit.parent,
        "branch": commit.branch,
        "commit_message": commit.subject,
        "commit_timestamp": commit.timestamp,
        "submitted_at": submitted_at,
        "submitted_by": submitted_by,
        "games": sorted(games, key=lambda g: g["game_id"]),
        "screenshots": [
            {
                "game_id": s.game_id,
                "frame_index": s.frame_index,
                "r2_key": s.r2_key,
                "width": s.width,
                "height": s.height,
                "sha256": s.sha256,
            }
            for s in sorted(screenshots, key=lambda s: (s.game_id, s.frame_index))
        ],
    }


def load_env_files(*, explicit: Path | None, archive_repo: Path) -> list[Path]:
    """Load .env files. Shell env wins. Explicit > archive_repo/.env > cwd walk-up."""
    loaded: list[Path] = []
    if explicit and load_dotenv(dotenv_path=explicit, override=False):
        loaded.append(explicit.resolve())
    archive_env = archive_repo / ".env"
    if archive_env.is_file() and load_dotenv(dotenv_path=archive_env, override=False):
        loaded.append(archive_env.resolve())
    if load_dotenv(override=False):
        loaded.append(Path(".env").resolve())
    seen: set[Path] = set()
    return [p for p in loaded if not (p in seen or seen.add(p))]


def run_submission(
    *, emulator: str, input_dir: Path, archive_repo: Path,
    title_map_path: Path | None, submitted_by: str | None, branch: str | None,
    dry_run: bool, allow_dirty: bool, no_push: bool,
    emu_repo: Path, env: dict[str, str] | None = None, now: datetime | None = None,
) -> dict[str, Any]:
    r2_cfg = load_r2_config(env)
    archive_repo = archive_repo.resolve()
    emu_repo = emu_repo.resolve()
    input_dir = input_dir.resolve()
    if not archive_repo.is_dir():
        raise click.ClickException(f"archive repo not found: {archive_repo}")

    check_clean_worktree(emu_repo, input_dir, allow_dirty=allow_dirty)
    commit = read_git_commit(emu_repo)
    if branch:
        commit = replace(commit, branch=branch)
    games_scanned = scan_input(input_dir)
    if not games_scanned:
        raise click.ClickException(f"no game directories found under {input_dir}")

    title_map = parse_title_map(title_map_path)
    whitelist = title_map_path is not None
    try:
        submitter = submitted_by or _git("config", "user.name", cwd=emu_repo) or "unknown"
    except subprocess.CalledProcessError:
        submitter = submitted_by or "unknown"
    now_dt = now or datetime.now(timezone.utc)
    submitted_at = now_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    screenshots: list[Screenshot] = []
    games_meta: list[dict[str, str]] = []
    client = None if dry_run else make_r2_client(r2_cfg)

    for game in games_scanned:
        if whitelist and game.game_id not in title_map:
            click.echo(f"skip: {game.game_id} not in --title-map", err=True)
            continue

        title = resolve_title(
            game.game_id, archive_repo=archive_repo, emulator=emulator,
            title_map=title_map, interactive=not dry_run,
        )
        games_meta.append({"game_id": game.game_id, "game_title": title})

        if not game.frames:
            click.echo(f"info: {game.game_id} has no screenshots", err=True)
            continue

        for plan in game.frames:
            w, h = read_dimensions(plan.source_path)
            key = r2_key_for(emulator, commit.short, plan.game_id, plan.frame_index)
            if dry_run:
                click.echo(f"[dry-run] upload {plan.source_path} -> r2://{r2_cfg.bucket}/{key}")
            else:
                upload_one(client, r2_cfg, key, plan.source_path)
            screenshots.append(Screenshot(
                game_id=plan.game_id, frame_index=plan.frame_index, r2_key=key,
                width=w, height=h, sha256=sha256_file(plan.source_path),
            ))

    if not games_meta:
        raise click.ClickException("nothing to submit, every game was filtered out")

    submission = build_submission(
        emulator=emulator, commit=commit, games=games_meta, screenshots=screenshots,
        submitted_by=submitter, submitted_at=submitted_at,
    )

    date = commit.timestamp[:10]
    json_path = archive_repo / "meta" / "submissions" / emulator / f"{date}-{commit.short}.json"
    json_text = json.dumps(submission, indent=2) + "\n"

    if dry_run:
        click.echo(f"[dry-run] write {json_path}")
        click.echo(f"[dry-run] commit data({emulator}): add submission for {commit.short}")
        if not no_push:
            click.echo("[dry-run] push")
        return submission

    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json_text, encoding="utf-8")

    _git("add", "meta/", cwd=archive_repo)
    if subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=str(archive_repo)).returncode == 0:
        click.echo("no JSON changes to commit (idempotent re-run)")
    else:
        _git("commit", "-m", f"data({emulator}): add submission for {commit.short}", cwd=archive_repo)
        if no_push:
            click.echo("skipping push (--no-push)")
        else:
            try:
                _git("push", cwd=archive_repo)
            except subprocess.CalledProcessError:
                click.echo("push failed, trying pull --rebase and retrying", err=True)
                _git("pull", "--rebase", cwd=archive_repo)
                _git("push", cwd=archive_repo)

    click.echo(f"done: {len(screenshots)} screenshot(s) uploaded, submission at {json_path}")
    return submission


@click.command(context_settings={"help_option_names": ["-h", "--help"]})
@click.option("--emulator", required=True, help="Emulator slug (e.g. 'gecko').")
@click.option("--emu-repo", "emu_repo", type=click.Path(path_type=Path, file_okay=False),
              default=None, help="Emulator git repo. [default: cwd]")
@click.option("--input", "input_dir", type=click.Path(path_type=Path, file_okay=False),
              default=None, help="Directory of <game_id>/<index>.png. [default: <emu-repo>/screenshots]")
@click.option("--archive-repo", type=click.Path(path_type=Path, file_okay=False),
              default=None, help="emu.layle.dev repo. [default: this script's repo]")
@click.option("--env-file", "env_file", type=click.Path(path_type=Path, exists=True, dir_okay=False),
              default=None, help="Load R2 env from this file. Shell env wins.")
@click.option("--title-map", "title_map_path",
              type=click.Path(path_type=Path, exists=True, dir_okay=False),
              default=None, help="File with 'game_id=Title' lines. Acts as an allowlist.")
@click.option("--submitted-by", default=None, help="Override submitter (default: git user.name).")
@click.option("--branch", default=None, help="Override branch name. Useful for detached HEAD checkouts.")
@click.option("--dry-run", is_flag=True, help="Print what would happen. No uploads, no writes.")
@click.option("--allow-dirty", is_flag=True, help="Allow submitting from a dirty working tree.")
@click.option("--no-push", is_flag=True, help="Commit the JSON but do not push.")
def cli(
    emulator: str, emu_repo: Path | None, input_dir: Path | None,
    archive_repo: Path | None, env_file: Path | None, title_map_path: Path | None,
    submitted_by: str | None, branch: str | None,
    dry_run: bool, allow_dirty: bool, no_push: bool,
) -> None:
    emu_repo = (emu_repo or Path.cwd()).resolve()
    input_dir = (input_dir or emu_repo / "screenshots").resolve()
    archive_repo = (archive_repo or Path(__file__).resolve().parent.parent).resolve()

    for p in load_env_files(explicit=env_file, archive_repo=archive_repo):
        click.echo(f"loaded env from {p}", err=True)

    run_submission(
        emulator=emulator, input_dir=input_dir, archive_repo=archive_repo,
        title_map_path=title_map_path, submitted_by=submitted_by, branch=branch,
        dry_run=dry_run, allow_dirty=allow_dirty, no_push=no_push, emu_repo=emu_repo,
    )


if __name__ == "__main__":
    cli()

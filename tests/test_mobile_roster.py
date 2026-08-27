"""Tests for GET /api/mobile/roster and build_mobile_roster diagnostics."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml


def _write_profile(root: Path, name: str, *, hidden: bool = False, title: str | None = None) -> Path:
    if name == "default":
        path = root
    else:
        path = root / "profiles" / name
    path.mkdir(parents=True, exist_ok=True)
    (path / "config.yaml").write_text("model:\n  default: test\n", encoding="utf-8")
    meta: dict = {}
    bots: dict = {}
    if hidden:
        bots["hidden"] = True
    if title:
        bots["title"] = title
    if bots:
        meta["ui_meta"] = {"hermes-bots": bots}
        (path / "profile.yaml").write_text(yaml.safe_dump(meta), encoding="utf-8")
    return path


@pytest.fixture
def multi_bot_home(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    _write_profile(home, "default", hidden=True, title="Hermes")
    for name in ("boss-bot", "dev", "bsv-ops", "assistant", "mainline"):
        _write_profile(home, name)
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    return home


def test_build_mobile_roster_jason_union(multi_bot_home):
    from hermes_cli.mobile_roster import build_mobile_roster

    result = build_mobile_roster(include_sessions=False)
    names = [row["name"] for row in result["profiles"]]
    assert "boss-bot" in names
    assert "dev" in names
    assert "bsv-ops" in names
    assert "assistant" in names
    assert "mainline" in names
    assert "default" in names
    assert result["default_only"] is False
    assert result["incomplete"] is False
    default = next(row for row in result["profiles"] if row["name"] == "default")
    assert default["hidden"] is True
    assert default["handle"] == "hermes"


def test_build_mobile_roster_flags_default_only(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    _write_profile(home, "default", hidden=False, title="Hermes")
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)

    from hermes_cli.mobile_roster import build_mobile_roster

    result = build_mobile_roster(include_sessions=False)
    assert result["profile_count"] == 1
    assert result["default_only"] is True
    assert result["incomplete"] is True
    assert result["profiles"][0]["handle"] == "hermes"


@pytest.mark.asyncio
async def test_mobile_roster_endpoint_returns_union(multi_bot_home, monkeypatch):
    from hermes_cli.web_routers import profiles

    payload = await profiles.mobile_roster_endpoint(include_sessions=False)
    names = {row["name"] for row in payload["profiles"]}
    assert {"boss-bot", "dev", "bsv-ops", "assistant", "mainline", "default"} <= names
    assert payload["default_only"] is False

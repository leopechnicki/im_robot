"""Shared fixtures."""

from __future__ import annotations

from collections.abc import Iterator

import pytest

from ._site import Site


@pytest.fixture()
def site() -> Iterator[Site]:
    """A real imrobot site on 127.0.0.1 (see tests/_site.py)."""
    s = Site()
    yield s
    s.close()

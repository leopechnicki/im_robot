"""Minimal RFC 8941 (Structured Field Values) parser for HTTP Message Signatures.

Mirror of ``src/server/structured-fields.ts``. Each dictionary member keeps its
exact source text (``raw``) because the RFC 9421 ``@signature-params`` line must
reproduce the signed serialization. Internal module.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Union

_KEY_START = re.compile(r"[a-z*]")
_KEY_CHAR = re.compile(r"[a-z0-9_\-.*]")
_TOKEN_START = re.compile(r"[A-Za-z*]")
_TOKEN_CHAR = re.compile(r"[!#$%&'*+\-.^_`|~0-9A-Za-z:/]")
_NUMBER = re.compile(r"-?\d{1,15}(\.\d{1,3})?")
_B64 = re.compile(r"[A-Za-z0-9+/=]*")


class StructuredFieldError(ValueError):
    pass


@dataclass
class Token:
    value: str


@dataclass
class Binary:
    """Byte sequence, kept as its base64 text (undecoded)."""

    value: str


BareItem = Union[str, Token, int, float, Binary, bool]


@dataclass
class Item:
    value: BareItem
    params: dict[str, BareItem] = field(default_factory=dict)
    raw: str = ""


@dataclass
class InnerList:
    items: list[Item]
    params: dict[str, BareItem] = field(default_factory=dict)
    raw: str = ""


Member = Union[Item, InnerList]


class _Parser:
    def __init__(self, s: str) -> None:
        self.s = s
        self.pos = 0

    def peek(self) -> str:
        return self.s[self.pos] if self.pos < len(self.s) else ""

    def eof(self) -> bool:
        return self.pos >= len(self.s)

    def fail(self, msg: str) -> Any:
        raise StructuredFieldError(f"{msg} at offset {self.pos}")

    def skip_sp(self) -> None:
        while self.peek() == " ":
            self.pos += 1

    def skip_ows(self) -> None:
        while self.peek() in (" ", "\t") and not self.eof():
            self.pos += 1

    def key(self) -> str:
        if not _KEY_START.fullmatch(self.peek() or "!"):
            self.fail("expected key")
        start = self.pos
        while not self.eof() and _KEY_CHAR.fullmatch(self.peek()):
            self.pos += 1
        return self.s[start : self.pos]

    def bare_item(self) -> BareItem:
        c = self.peek()
        if c == '"':
            return self.string()
        if c == ":":
            return self.binary()
        if c == "?":
            return self.boolean()
        if c == "-" or c.isdigit():
            return self.number()
        if c and _TOKEN_START.fullmatch(c):
            return self.token()
        return self.fail("expected bare item")  # type: ignore[no-any-return]

    def string(self) -> str:
        self.pos += 1
        out = []
        while True:
            if self.eof():
                self.fail("unterminated string")
            c = self.s[self.pos]
            self.pos += 1
            if c == "\\":
                n = self.peek()
                self.pos += 1
                if n not in ('"', "\\"):
                    self.fail("bad escape in string")
                out.append(n)
            elif c == '"':
                return "".join(out)
            else:
                if not (0x20 <= ord(c) <= 0x7E):
                    self.fail("non-printable character in string")
                out.append(c)

    def token(self) -> Token:
        start = self.pos
        self.pos += 1
        while not self.eof() and _TOKEN_CHAR.fullmatch(self.peek()):
            self.pos += 1
        return Token(self.s[start : self.pos])

    def binary(self) -> Binary:
        self.pos += 1
        end = self.s.find(":", self.pos)
        if end == -1:
            self.fail("unterminated byte sequence")
        value = self.s[self.pos : end]
        if not _B64.fullmatch(value):
            self.fail("bad byte sequence")
        self.pos = end + 1
        return Binary(value)

    def boolean(self) -> bool:
        self.pos += 1
        c = self.peek()
        self.pos += 1
        if c == "1":
            return True
        if c == "0":
            return False
        return self.fail("bad boolean")  # type: ignore[no-any-return]

    def number(self) -> Union[int, float]:
        m = _NUMBER.match(self.s, self.pos)
        if not m:
            self.fail("bad number")
        assert m is not None
        self.pos = m.end()
        text = m.group(0)
        if m.group(1):
            if len(text.lstrip("-").split(".")[0]) > 12:
                self.fail("decimal too long")
            return float(text)
        return int(text)

    def params(self) -> dict[str, BareItem]:
        params: dict[str, BareItem] = {}
        while self.peek() == ";":
            self.pos += 1
            self.skip_sp()
            k = self.key()
            v: BareItem = True
            if self.peek() == "=":
                self.pos += 1
                v = self.bare_item()
            params[k] = v
        return params

    def item(self) -> Item:
        value = self.bare_item()
        return Item(value, self.params())

    def inner_list(self) -> InnerList:
        self.pos += 1
        items: list[Item] = []
        while True:
            self.skip_sp()
            if self.peek() == ")":
                self.pos += 1
                return InnerList(items, self.params())
            if self.eof():
                self.fail("unterminated inner list")
            items.append(self.item())
            if self.peek() not in (" ", ")"):
                self.fail("expected space or ) in inner list")

    def item_or_inner_list(self) -> Member:
        return self.inner_list() if self.peek() == "(" else self.item()


def parse_dictionary(value: str) -> dict[str, Member]:
    """Parse a Dictionary field value. Later duplicate keys win."""
    p = _Parser(value)
    out: dict[str, Member] = {}
    p.skip_sp()
    if p.eof():
        return out
    while True:
        k = p.key()
        member: Member
        if p.peek() == "=":
            p.pos += 1
            start = p.pos
            member = p.item_or_inner_list()
        else:
            start = p.pos
            member = Item(True, p.params())
        member.raw = value[start : p.pos]
        out[k] = member
        p.skip_ows()
        if p.eof():
            return out
        if p.peek() != ",":
            p.fail("expected comma between members")
        p.pos += 1
        p.skip_ows()
        if p.eof():
            p.fail("trailing comma")


def parse_item(value: str) -> Item:
    """Parse an Item field value."""
    p = _Parser(value)
    p.skip_sp()
    item = p.item()
    p.skip_sp()
    if not p.eof():
        p.fail("trailing characters after item")
    item.raw = value.strip()
    return item


def serialize_bare_item(item: BareItem) -> str:
    if isinstance(item, bool):
        return "?1" if item else "?0"
    if isinstance(item, str):
        return '"' + item.replace("\\", "\\\\").replace('"', '\\"') + '"'
    if isinstance(item, Token):
        return item.value
    if isinstance(item, Binary):
        return f":{item.value}:"
    if isinstance(item, int):
        return str(item)
    text = repr(float(item))
    return text if "." in text else text + ".0"


def serialize_params(params: dict[str, BareItem]) -> str:
    out = ""
    for k, v in params.items():
        out += f";{k}" if v is True else f";{k}={serialize_bare_item(v)}"
    return out


def serialize_member(member: Member) -> str:
    if isinstance(member, Item):
        return serialize_bare_item(member.value) + serialize_params(member.params)
    inner = " ".join(
        serialize_bare_item(i.value) + serialize_params(i.params) for i in member.items
    )
    return f"({inner}){serialize_params(member.params)}"

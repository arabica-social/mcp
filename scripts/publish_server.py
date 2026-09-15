#!/usr/bin/env python3
# Adapted from https://tangled.org/zzstoatzz.io/mcp-atlas/tree/main/scripts/publish_server.py
#
# MIT License
#
# Copyright 2026 Nate Wilkins
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.
"""Validate and publish one tech.waow.mcp.server record.

This script intentionally has no third-party dependencies so it can run
locally or in Tangled Pipelines.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

COLLECTION = "tech.waow.mcp.server"
RKEY_RE = re.compile(r"^[A-Za-z0-9._:~-]{1,512}$")


def request_json(
    url: str, *, body: dict[str, Any] | None = None, token: str | None = None
) -> dict[str, Any]:
    headers = {"User-Agent": "mcp-atlas-publisher/0.1"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode() if body is not None else None,
        headers=headers,
        method="POST" if body is not None else "GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.load(response)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise RuntimeError(f"{exc.code} from {url}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"could not reach {url}: {exc.reason}") from exc
    if not isinstance(result, dict):
        raise TypeError(f"expected an object from {url}")
    return result


def did_document_url(did: str) -> str:
    if did.startswith("did:plc:"):
        return f"https://plc.directory/{urllib.parse.quote(did, safe=':')}"
    if did.startswith("did:web:"):
        parts = [
            urllib.parse.unquote(part)
            for part in did.removeprefix("did:web:").split(":")
        ]
        host, *path = parts
        suffix = "/".join(path + ["did.json"]) if path else ".well-known/did.json"
        return f"https://{host}/{suffix}"
    raise ValueError(f"unsupported DID method in {did!r}; set ATPROTO_PDS explicitly")


def discover_pds(identifier: str) -> str:
    if identifier.startswith("did:"):
        did = identifier
    else:
        resolved = request_json(
            "https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?"
            + urllib.parse.urlencode({"handle": identifier})
        )
        did = resolved.get("did")
        if not isinstance(did, str):
            raise RuntimeError(f"could not resolve handle {identifier!r}")
    document = request_json(did_document_url(did))
    for service in document.get("service", []):
        if not isinstance(service, dict):
            continue
        endpoint = service.get("serviceEndpoint")
        if str(service.get("id", "")).endswith("#atproto_pds") and isinstance(
            endpoint, str
        ):
            return endpoint.rstrip("/")
    raise RuntimeError(f"the DID document for {did} has no AT Protocol PDS service")


def default_rkey(name: str) -> str:
    rkey = re.sub(r"[^a-z0-9._~-]+", "-", name.lower()).strip("-")
    if not rkey:
        raise ValueError("name does not produce a usable record key; pass --rkey")
    return rkey[:512]


def validate_record(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise TypeError("record JSON must be an object")
    record = dict(value)
    record.setdefault("$type", COLLECTION)
    if record["$type"] != COLLECTION:
        raise ValueError(f"$type must be {COLLECTION!r}")
    for field in ("name", "description", "createdAt"):
        if not isinstance(record.get(field), str) or not record[field].strip():
            raise ValueError(f"{field} must be a non-empty string")
    if len(record["name"]) > 64:
        raise ValueError("name must be at most 64 characters")
    if len(record["description"]) > 500:
        raise ValueError("description must be at most 500 characters")
    try:
        created_at = datetime.datetime.fromisoformat(record["createdAt"])
    except ValueError as exc:
        raise ValueError("createdAt must be an ISO 8601 timestamp") from exc
    if created_at.tzinfo is None:
        raise ValueError("createdAt must include a timezone")
    transport = record.get("transport")
    if transport not in (None, "http", "stdio"):
        raise ValueError("transport must be 'http' or 'stdio'")
    if transport == "http" and not record.get("url"):
        raise ValueError("an http record must include url")
    for field in ("url", "repo", "manifest"):
        url = record.get(field)
        if url is not None and (
            not isinstance(url, str)
            or urllib.parse.urlparse(url).scheme not in ("http", "https")
        ):
            raise ValueError(f"{field} must be an http(s) URL")

    nested = (
        ("tools", 128, ("name",)),
        ("environment", 32, ("name",)),
        ("packages", 8, ("registry", "identifier")),
    )
    for field, maximum, required in nested:
        items = record.get(field)
        if items is None:
            continue
        if not isinstance(items, list):
            raise TypeError(f"{field} must be an array")
        if len(items) > maximum:
            raise ValueError(f"{field} may contain at most {maximum} entries")
        for index, item in enumerate(items):
            if not isinstance(item, dict):
                raise TypeError(f"{field}[{index}] must be an object")
            for child in required:
                if not isinstance(item.get(child), str) or not item[child].strip():
                    raise ValueError(
                        f"{field}[{index}].{child} must be a non-empty string"
                    )
    return record


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("record", nargs="?", default="server-record.json", type=Path)
    parser.add_argument("--rkey", help="stable record key; defaults to a slug of name")
    parser.add_argument(
        "--dry-run", action="store_true", help="validate and print without signing in"
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    record = validate_record(json.loads(args.record.read_text()))
    rkey = args.rkey or default_rkey(record["name"])
    if not RKEY_RE.fullmatch(rkey):
        raise ValueError("rkey contains characters AT Protocol does not allow")
    if args.dry_run:
        print(
            json.dumps(
                {"collection": COLLECTION, "rkey": rkey, "record": record}, indent=2
            )
        )
        return

    identifier = os.environ.get("ATPROTO_HANDLE")
    password = os.environ.get("ATPROTO_PASSWORD")
    if not identifier or not password:
        raise RuntimeError(
            "set ATPROTO_HANDLE and ATPROTO_PASSWORD (use an app password)"
        )
    pds = (os.environ.get("ATPROTO_PDS") or discover_pds(identifier)).rstrip("/")
    session = request_json(
        f"{pds}/xrpc/com.atproto.server.createSession",
        body={"identifier": identifier, "password": password},
    )
    did, token = session.get("did"), session.get("accessJwt")
    if not isinstance(did, str) or not isinstance(token, str):
        raise TypeError("PDS returned an incomplete session")
    result = request_json(
        f"{pds}/xrpc/com.atproto.repo.putRecord",
        body={
            "repo": did,
            "collection": COLLECTION,
            "rkey": rkey,
            "record": record,
        },
        token=token,
    )
    print(f"published {result.get('uri', f'at://{did}/{COLLECTION}/{rkey}')}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, TypeError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
        sys.exit(f"error: {exc}")

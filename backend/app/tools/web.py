"""WebFetch + WebSearch tools.

WebFetch: fetch URL, convert HTML -> markdown. The official Claude Code
version also runs the markdown through a small LLM with the user's prompt
and returns that answer; we skip the LLM step (no LLM dependency in this
tool library). The caller can summarize themselves.

WebSearch: scrape DuckDuckGo's HTML endpoint directly via httpx, parse
with stdlib html.parser. Zero third-party parsing deps. Fragile if DDG
changes their HTML; acceptable trade-off.
"""

from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, unquote, urlparse

import httpx

from app.tools import Tool, register
from app.tools._common import truncate

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
FETCH_TIMEOUT_S = 30.0
SEARCH_TIMEOUT_S = 20.0
SEARCH_MAX_RESULTS = 10
DDG_ENDPOINT = "https://html.duckduckgo.com/html/"


# ---------- WebFetch ----------

async def _web_fetch(args: Dict[str, Any], folder: Path) -> str:
    url = args["url"]
    prompt = args.get("prompt", "")
    if url.startswith("http://"):
        url = "https://" + url[len("http://") :]

    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=FETCH_TIMEOUT_S,
            headers={"User-Agent": USER_AGENT},
        ) as client:
            resp = await client.get(url)
    except httpx.HTTPError as exc:
        return f"Error fetching {url}: {exc}"

    if resp.status_code >= 400:
        return f"Error: HTTP {resp.status_code} for {url}"

    content_type = resp.headers.get("content-type", "")
    body = resp.text

    if "html" in content_type.lower():
        try:
            from markdownify import markdownify as md
            body = md(body, heading_style="ATX")
        except ImportError:
            pass

    final_url = str(resp.url)
    header = f"Fetched: {final_url}\n"
    if prompt:
        header += f"(prompt suppressed — no LLM step in this tool)\nPrompt was: {prompt}\n"
    header += "---\n"
    return truncate(header + body)


# ---------- WebSearch ----------

def _unwrap(href: str) -> str:
    """DDG result links look like //duckduckgo.com/l/?uddg=<encoded>&...
    We want the real destination URL."""
    if not href:
        return ""
    if href.startswith("//"):
        href = "https:" + href
    parsed = urlparse(href)
    if "duckduckgo.com" in parsed.netloc and parsed.path.startswith("/l/"):
        qs = parse_qs(parsed.query)
        if "uddg" in qs:
            return unquote(qs["uddg"][0])
    return href


class _DDGParser(HTMLParser):
    """Extract result blocks from DDG's html.duckduckgo.com response.

    Looks for anchors with class ``result__a`` (title + url) and
    ``result__snippet`` (snippet). Robust to minor markup variation but
    will break if DDG overhauls these class names.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.results: List[Dict[str, str]] = []
        self._current: Optional[Dict[str, str]] = None
        self._mode: Optional[str] = None  # "title" | "snippet"

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag != "a":
            return
        attr_d = dict(attrs)
        cls = (attr_d.get("class") or "").split()
        href = attr_d.get("href", "") or ""
        if "result__a" in cls:
            self._current = {"url": _unwrap(href), "title": "", "snippet": ""}
            self._mode = "title"
        elif "result__snippet" in cls and self._current is not None:
            self._mode = "snippet"

    def handle_endtag(self, tag: str) -> None:
        if tag != "a" or self._current is None:
            return
        if self._mode == "title":
            self._mode = None  # keep _current alive, waiting for snippet
        elif self._mode == "snippet":
            # push and reset
            self.results.append(self._current)
            self._current = None
            self._mode = None

    def handle_data(self, data: str) -> None:
        if self._current is None or self._mode is None:
            return
        self._current[self._mode] += data


async def _web_search(args: Dict[str, Any], folder: Path) -> str:
    query = args["query"]
    allowed = set(args.get("allowed_domains") or [])
    blocked = set(args.get("blocked_domains") or [])

    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=SEARCH_TIMEOUT_S,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "en-US,en;q=0.9",
            },
        ) as client:
            # POST is more stable for DDG programmatic access than GET
            resp = await client.post(DDG_ENDPOINT, data={"q": query, "b": ""})
    except httpx.HTTPError as exc:
        return f"Error running search: {exc}"

    if resp.status_code >= 400:
        return f"Error: HTTP {resp.status_code} from DuckDuckGo"

    if "result__a" not in resp.text:
        # DDG returned something (likely a CAPTCHA/rate-limit page or an
        # empty-results page) without any results. Surface that clearly.
        return (
            "Error: no result blocks in DuckDuckGo response — likely rate-"
            "limited or blocked. Try again in a moment, or plug in a real "
            "search API (Brave/Tavily) if this recurs."
        )

    parser = _DDGParser()
    parser.feed(resp.text)

    lines: List[str] = []
    for r in parser.results:
        url = r["url"]
        if not url or url.startswith("javascript:"):
            continue
        if allowed and not any(d in url for d in allowed):
            continue
        if blocked and any(d in url for d in blocked):
            continue
        title = r["title"].strip() or "(no title)"
        snippet = " ".join(r["snippet"].split())  # collapse whitespace
        lines.append(f"- [{title}]({url})\n    {snippet}")
        if len(lines) >= SEARCH_MAX_RESULTS:
            break

    if not lines:
        return "(no results)"
    return truncate("\n\n".join(lines))


register(Tool(
    name="WebFetch",
    description=(
        "- Fetches content from a specified URL\n"
        "- Converts HTML to markdown when possible\n"
        "- HTTP URLs are automatically upgraded to HTTPS\n"
        "- Follows redirects\n"
        "- Note: this implementation does NOT run the response through an "
        "LLM with the given prompt (that's a caller concern). The `prompt` "
        "argument is accepted for API compatibility but only echoed back."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "url": {
                "description": "The URL to fetch content from",
                "type": "string",
                "format": "uri",
            },
            "prompt": {
                "description": (
                    "Prompt describing what to extract. Accepted for API "
                    "compatibility; not applied by this tool."
                ),
                "type": "string",
            },
        },
        "required": ["url", "prompt"],
    },
    executor=_web_fetch,
    scopes={"main", "sub"},
))


register(Tool(
    name="WebSearch",
    description=(
        "- Search the web via DuckDuckGo (no API key required, scraper-based)\n"
        "- Returns up to 10 result blocks with title, URL, and snippet\n"
        "- Domain filtering via allowed_domains / blocked_domains (substring match)\n"
        "- Fragile if DDG changes their HTML; no retries on rate-limit"
    ),
    input_schema={
        "type": "object",
        "properties": {
            "query": {
                "description": "The search query to use",
                "type": "string",
                "minLength": 2,
            },
            "allowed_domains": {
                "description": "Only include results whose URL contains one of these domains",
                "type": "array",
                "items": {"type": "string"},
            },
            "blocked_domains": {
                "description": "Exclude results whose URL contains one of these domains",
                "type": "array",
                "items": {"type": "string"},
            },
        },
        "required": ["query"],
    },
    executor=_web_search,
    scopes={"main", "sub"},
))

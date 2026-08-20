"""
오늘뭐먹지 — 맛집 검색 프록시 서버

카카오 로컬 API(키워드/카테고리 검색)를 프론트엔드(save.js)에서 바로 호출하지 못하도록
(CORS + API 키 노출 방지) 감싸는 아주 단순한 프록시 서버.

의존성: 표준 라이브러리(http.server, urllib)만 사용 — 프로젝트에 별도 서버 스택이
없어서(requirements.txt, package.json 등 미존재) 외부 패키지 없이 동작하도록 작성했다.

환경변수:
    KAKAO_REST_API_KEY   카카오 디벨로퍼스에서 발급받은 REST API 키 (필수)
    PORT                 서버 포트 (기본 8000)

실행:
    KAKAO_REST_API_KEY=xxxx python3 server.py

프론트엔드에서 호출하는 엔드포인트:
    GET /api/search?query=<검색어>&category_group_code=<코드>&x=<lng>&y=<lat>&radius=<m>&page=<n>

    - query 만 있으면 키워드 검색(keyword.json)을 호출한다.
    - category_group_code 만 있으면(query 없이) 카테고리 검색(category.json)을 호출한다.
    - 둘 다 있으면 키워드 검색에 category_group_code를 필터로 함께 전달한다(카카오 API 사양).
    - 그 외 x, y, radius, page, size, sort 파라미터는 그대로 카카오 API에 전달(pass-through)한다.

응답은 카카오 API의 JSON을 그대로 반환한다 (documents, meta 필드 포함).
"""

import json
import os
import ssl
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

try:
    import certifi

    _SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    _SSL_CONTEXT = None

KAKAO_KEYWORD_URL = "https://dapi.kakao.com/v2/local/search/keyword.json"
KAKAO_CATEGORY_URL = "https://dapi.kakao.com/v2/local/search/category.json"

# 카카오 API로 그대로 넘겨도 되는 pass-through 쿼리 파라미터
PASSTHROUGH_PARAMS = ["x", "y", "radius", "page", "size", "sort", "rect"]

DEFAULT_CATEGORY_GROUP_CODE = "FD6"  # 음식점 (카테고리 검색만 할 때 기본값)


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def _get_kakao_api_key():
    key = os.environ.get("KAKAO_REST_API_KEY")
    if not key:
        raise ApiError(
            500,
            "서버에 KAKAO_REST_API_KEY 환경변수가 설정되어 있지 않습니다.",
        )
    return key


def _call_kakao(url, params):
    api_key = _get_kakao_api_key()
    query_string = urllib.parse.urlencode(params)
    full_url = f"{url}?{query_string}"
    req = urllib.request.Request(
        full_url,
        headers={"Authorization": f"KakaoAK {api_key}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10, context=_SSL_CONTEXT) as res:
            body = res.read()
            return res.status, json.loads(body)
    except urllib.error.HTTPError as e:
        body = e.read()
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            parsed = {"error": body.decode("utf-8", errors="replace")}
        raise ApiError(e.code, parsed)
    except urllib.error.URLError as e:
        raise ApiError(502, f"카카오 API 호출 실패: {e.reason}")


def search_places(query_params):
    query = query_params.get("query", "").strip()
    category_group_code = query_params.get("category_group_code", "").strip()

    params = {}
    for key in PASSTHROUGH_PARAMS:
        if query_params.get(key):
            params[key] = query_params[key]

    if query:
        # 키워드 검색 (카테고리 코드가 있으면 필터로 함께 전달)
        params["query"] = query
        if category_group_code:
            params["category_group_code"] = category_group_code
        return _call_kakao(KAKAO_KEYWORD_URL, params)

    if category_group_code:
        # 순수 카테고리 검색은 카카오 API 사양상 x, y, radius 등 위치 정보가 필요할 수 있다.
        params["category_group_code"] = category_group_code or DEFAULT_CATEGORY_GROUP_CODE
        return _call_kakao(KAKAO_CATEGORY_URL, params)

    raise ApiError(400, "query 또는 category_group_code 파라미터가 필요합니다.")


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == "/api/search":
            query_params = {
                k: v[0] for k, v in urllib.parse.parse_qs(parsed.query).items()
            }
            try:
                status, data = search_places(query_params)
                self._send_json(status, data)
            except ApiError as e:
                self._send_json(e.status, {"error": e.message})
            return

        if parsed.path == "/health":
            self._send_json(200, {"ok": True})
            return

        self._send_json(404, {"error": "not found"})

    def log_message(self, format, *args):
        # 기본 stderr 로그 포맷을 그대로 사용하되 조용히 하고 싶으면 여기서 조정
        super().log_message(format, *args)


def main():
    port = int(os.environ.get("PORT", "8000"))
    server = HTTPServer(("0.0.0.0", port), Handler)
    print(f"맛집 검색 프록시 서버 실행 중: http://localhost:{port}")
    print("엔드포인트: GET /api/search?query=<검색어>&category_group_code=<코드>")
    if not os.environ.get("KAKAO_REST_API_KEY"):
        print("경고: KAKAO_REST_API_KEY 환경변수가 설정되어 있지 않습니다.")
    server.serve_forever()


if __name__ == "__main__":
    main()

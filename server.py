"""
오늘뭐먹지 — 맛집 검색 프록시 서버

카카오 로컬 API(키워드/카테고리 검색) + 구글 플레이스 API(레거시 Text Search,
New Places API)를 프론트엔드(save.js)에서 바로 호출하지 못하도록(CORS + API 키
노출 방지) 감싸는 아주 단순한 프록시 서버.

의존성: 표준 라이브러리(http.server, urllib)만 사용 — 프로젝트에 별도 서버 스택이
없어서(requirements.txt, package.json 등 미존재) 외부 패키지 없이 동작하도록 작성했다.

환경변수:
    KAKAO_REST_API_KEY     카카오 디벨로퍼스에서 발급받은 REST API 키 (필수)
    GOOGLE_PLACES_API_KEY  구글 클라우드 콘솔에서 발급받은 Places API 키 (필수)
                            ※ /api/place-reviews 는 "Places API (New)"라는 별개의
                              API 상품을 사용한다. 레거시 Places API만 사용 설정된
                              키라면 Cloud 콘솔에서 "Places API (New)"도 추가로
                              사용 설정(enable)해야 한다. 그렇지 않으면 구글이
                              403 PERMISSION_DENIED를 반환한다.
    GEMINI_API_KEY          Google AI Studio에서 발급받은 Gemini API 키 (필수, /api/analyze-reviews용)
    GEMINI_MODEL            사용할 Gemini 모델명 (기본값: gemini-2.0-flash).
                             ai.google.dev에서 최신 추천 모델을 확인해 필요하면 바꾼다.
    PORT                    서버 포트 (기본 8000)

실행:
    KAKAO_REST_API_KEY=xxxx GOOGLE_PLACES_API_KEY=yyyy GEMINI_API_KEY=zzzz python3 server.py

프론트엔드에서 호출하는 엔드포인트:
    GET /api/search?query=<검색어>&category_group_code=<코드>&x=<lng>&y=<lat>&radius=<m>&page=<n>

    - query 만 있으면 키워드 검색(keyword.json)을 호출한다.
    - category_group_code 만 있으면(query 없이) 카테고리 검색(category.json)을 호출한다.
    - 둘 다 있으면 키워드 검색에 category_group_code를 필터로 함께 전달한다(카카오 API 사양).
    - 그 외 x, y, radius, page, size, sort 파라미터는 그대로 카카오 API에 전달(pass-through)한다.

    GET /api/places-google?query=<검색어>

    - 구글 Places API(레거시 Text Search)를 호출한다. query 파라미터가 필수다.
    - language, region, location, radius, type, pagetoken 파라미터는 그대로 구글 API에
      전달(pass-through)한다.

    GET /api/place-reviews?name=<가게이름>&x=<경도>&y=<위도>

    - 구글 Places API (New)로 특정 가게의 별점/리뷰/구글맵 링크를 조회한다.
    - 이름으로 Text Search (New) 후보를 찾은 뒤, 후보 위치와 넘겨받은 좌표(x, y) 사이의
      거리를 Haversine 공식으로 직접 계산해 150m(도보 2분) 반경 안에 있는 후보만
      인정한다. 반경 밖이거나 후보가 없으면 {"found": false}를 반환한다.
    - 찾으면 Place Details (New)를 한 번 더 호출해 이름/별점/리뷰개수/리뷰/구글맵 링크
      5개 정보만 정리해 {"found": true, "place": {...}} 형태로 반환한다.

    POST /api/analyze-reviews
    body: {"placeName": "가게이름", "reviews": [{"author","rating","date","content"}, ...]}

    - Gemini API로 리뷰를 감성분석한다: 긍정/보통/부정 분류+개수, 핵심 키워드(8~15개,
      중요도 1~10 + 긍정/부정 맥락), 한 문장 요약.
    - 응답: {"analyzed": true, "result": {"sentiment": {...}, "keywords": [...], "summary": "..."}}
    - reviews가 비어있으면 400을 반환한다(리뷰 없는 가게는 프론트에서 애초에 호출하지 않는다).

응답은 각 API(카카오/구글/Gemini)의 JSON을 그대로 반환한다(단, /api/place-reviews와
/api/analyze-reviews는 여러 단계 호출 결과를 조합해 위 형태로 정리한 JSON을 반환한다).
"""

import json
import math
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

GOOGLE_PLACES_TEXTSEARCH_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json"

# 구글 Places API(Text Search)로 그대로 넘겨도 되는 pass-through 쿼리 파라미터
GOOGLE_PASSTHROUGH_PARAMS = ["language", "region", "location", "radius", "type", "pagetoken"]

# 구글 Places API (New) — 레거시 Text Search와는 별개의 API 상품(POST + 헤더 인증 방식)
PLACES_NEW_SEARCH_TEXT_URL = "https://places.googleapis.com/v1/places:searchText"
PLACES_NEW_DETAILS_BASE_URL = "https://places.googleapis.com/v1/places"

MATCH_RADIUS_METERS = 150  # 도보 2분 반경 — 이 거리를 넘는 동명 결과는 매칭 실패로 처리
# 검색 단계: 후보 식별 + 거리 검증에 필요한 최소 필드만 요청(과금 최소화)
PLACE_SEARCH_FIELD_MASK = "places.id,places.displayName,places.location"
# 상세 단계: 화면에 보여줄 5개 정보(이름/별점/리뷰개수/리뷰/지도링크)만 요청
PLACE_DETAILS_FIELD_MASK = "displayName,rating,userRatingCount,reviews,googleMapsUri"

# Gemini API (리뷰 감성분석) — 모델명은 환경변수로 오버라이드 가능
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")
GEMINI_URL_TEMPLATE = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

# Gemini structured output(responseSchema)에 강제할 JSON 스키마.
# 세 가지 분석 결과(감성 분류+개수 / 핵심 키워드 / 한줄 요약)를 한 번의 호출로 받는다.
ANALYSIS_RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "sentiment": {
            "type": "OBJECT",
            "properties": {
                "positive": {"type": "INTEGER"},
                "neutral": {"type": "INTEGER"},
                "negative": {"type": "INTEGER"},
            },
            "required": ["positive", "neutral", "negative"],
        },
        "keywords": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "word": {"type": "STRING"},
                    "score": {"type": "INTEGER"},
                    "sentiment": {"type": "STRING", "enum": ["positive", "negative"]},
                },
                "required": ["word", "score", "sentiment"],
            },
        },
        "summary": {"type": "STRING"},
    },
    "required": ["sentiment", "keywords", "summary"],
}


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


def _get_google_places_api_key():
    key = os.environ.get("GOOGLE_PLACES_API_KEY")
    if not key:
        raise ApiError(
            500,
            "서버에 GOOGLE_PLACES_API_KEY 환경변수가 설정되어 있지 않습니다.",
        )
    return key


def _call_google_places(params):
    api_key = _get_google_places_api_key()
    params = dict(params)
    params["key"] = api_key
    query_string = urllib.parse.urlencode(params)
    full_url = f"{GOOGLE_PLACES_TEXTSEARCH_URL}?{query_string}"
    req = urllib.request.Request(full_url)
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
        raise ApiError(502, f"구글 플레이스 API 호출 실패: {e.reason}")


def search_places_google(query_params):
    query = query_params.get("query", "").strip()
    if not query:
        raise ApiError(400, "query 파라미터가 필요합니다.")

    params = {"query": query}
    for key in GOOGLE_PASSTHROUGH_PARAMS:
        if query_params.get(key):
            params[key] = query_params[key]

    return _call_google_places(params)


def _haversine_distance_meters(lat1, lng1, lat2, lng2):
    """두 좌표(위도/경도) 사이의 거리를 미터 단위로 계산한다(Haversine 공식)."""
    radius = 6371000  # 지구 평균 반지름(m)
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lng2 - lng1)
    a = (
        math.sin(d_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    )
    return 2 * radius * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _call_places_new(url, api_key, field_mask, method="GET", body=None):
    """구글 Places API (New) 호출 공통 로직. POST일 땐 JSON body, 인증/필드마스크는 헤더로 전달."""
    headers = {"X-Goog-Api-Key": api_key, "X-Goog-FieldMask": field_mask}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10, context=_SSL_CONTEXT) as res:
            return res.status, json.loads(res.read())
    except urllib.error.HTTPError as e:
        body_bytes = e.read()
        try:
            parsed = json.loads(body_bytes)
        except json.JSONDecodeError:
            parsed = {}
        error_obj = parsed.get("error")
        message = error_obj.get("message") if isinstance(error_obj, dict) else error_obj
        raise ApiError(502, f"구글 Places API(New) 호출 실패: {message or e.reason}")
    except urllib.error.URLError as e:
        raise ApiError(502, f"구글 Places API(New) 호출 실패: {e.reason}")


def _search_google_place_candidate(name, lat, lng, api_key):
    """Text Search (New)로 이름 기준 후보를 찾고, 150m 반경 안에서 가장 가까운 후보를 반환한다."""
    body = {
        "textQuery": name,
        "languageCode": "ko",
        "maxResultCount": 5,
        "locationBias": {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": MATCH_RADIUS_METERS,
            }
        },
    }
    _, data = _call_places_new(
        PLACES_NEW_SEARCH_TEXT_URL, api_key, PLACE_SEARCH_FIELD_MASK, method="POST", body=body
    )

    closest = None
    closest_distance = float("inf")
    for candidate in data.get("places", []):
        location = candidate.get("location")
        if not location:
            continue
        distance = _haversine_distance_meters(
            lat, lng, location.get("latitude"), location.get("longitude")
        )
        if distance <= MATCH_RADIUS_METERS and distance < closest_distance:
            closest = candidate
            closest_distance = distance
    return closest


def _normalize_place_details(details, fallback_name):
    """Place Details(New) 응답을 화면에서 바로 쓰기 좋은 형태(5개 정보)로 정리한다."""
    display_name = details.get("displayName") or {}
    reviews = []
    for review in details.get("reviews", []):
        author_attribution = review.get("authorAttribution") or {}
        text = review.get("text") or {}
        original_text = review.get("originalText") or {}
        reviews.append(
            {
                "author": author_attribution.get("displayName") or "익명",
                "rating": review.get("rating"),
                "date": review.get("relativePublishTimeDescription", ""),
                "content": text.get("text") or original_text.get("text") or "",
            }
        )
    return {
        "name": display_name.get("text") or fallback_name,
        "rating": details.get("rating"),
        "userRatingCount": details.get("userRatingCount", 0),
        "reviews": reviews,
        "mapsUri": details.get("googleMapsUri", ""),
    }


def get_place_reviews(query_params):
    """가게 이름 + 좌표로 구글 Places API (New)에서 별점/리뷰/지도 링크를 조회한다."""
    name = query_params.get("name", "").strip()
    try:
        x = float(query_params.get("x", ""))
        y = float(query_params.get("y", ""))
    except (TypeError, ValueError):
        raise ApiError(400, "name, x, y 파라미터가 필요합니다.")

    if not name:
        raise ApiError(400, "name, x, y 파라미터가 필요합니다.")

    api_key = _get_google_places_api_key()

    # x=경도(lng), y=위도(lat) — 카카오/구글(레거시) 응답과 동일한 좌표 관례를 따른다.
    candidate = _search_google_place_candidate(name, y, x, api_key)
    if not candidate:
        return 200, {"found": False}

    place_id = candidate.get("id")
    _, details = _call_places_new(
        f"{PLACES_NEW_DETAILS_BASE_URL}/{place_id}",
        api_key,
        PLACE_DETAILS_FIELD_MASK,
        method="GET",
    )
    return 200, {"found": True, "place": _normalize_place_details(details, name)}


def _get_gemini_api_key():
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        raise ApiError(500, "서버에 GEMINI_API_KEY 환경변수가 설정되어 있지 않습니다.")
    return key


def _build_analysis_prompt(place_name, reviews):
    review_lines = "\n".join(
        f"{i + 1}. (별점 {r.get('rating', '?')}) {r.get('content') or '(내용 없음)'}"
        for i, r in enumerate(reviews)
    )
    return f"""너는 음식점 리뷰 분석가야. 아래는 '{place_name}'에 대한 구글 리뷰 {len(reviews)}건이다.

{review_lines}

위 리뷰들을 분석해서 다음 세 가지를 수행하고, 반드시 지정된 JSON 스키마 형식으로만 답해라.
1. 각 리뷰를 긍정/보통/부정 중 하나로 분류하고 각각 몇 건인지 센다 (positive/neutral/negative, 합은 {len(reviews)}이어야 한다).
2. 리뷰에 자주 등장하는 핵심 단어를 8~15개 뽑는다. 음식 이름, 맛, 분위기, 서비스 관련 단어 위주로 고른다.
   각 단어마다 중요도(score, 1~10)와 그 단어가 쓰인 맥락이 긍정인지 부정인지(sentiment)를 표기한다.
3. 이 가게 리뷰 전체를 자연스러운 한국어 한 문장으로 요약한다(summary).

한국어로 답하라."""


def _clamp_score(score):
    try:
        n = round(float(score))
    except (TypeError, ValueError):
        return 5
    return min(10, max(1, n))


def _normalize_analysis(raw):
    sentiment = raw.get("sentiment") or {}
    keywords = raw.get("keywords") if isinstance(raw.get("keywords"), list) else []
    normalized_keywords = []
    for k in keywords:
        if not isinstance(k, dict) or not str(k.get("word") or "").strip():
            continue
        normalized_keywords.append(
            {
                "word": str(k["word"]).strip(),
                "score": _clamp_score(k.get("score")),
                "sentiment": "negative" if k.get("sentiment") == "negative" else "positive",
            }
        )

    def _count(value):
        try:
            return max(0, round(float(value)))
        except (TypeError, ValueError):
            return 0

    return {
        "sentiment": {
            "positive": _count(sentiment.get("positive")),
            "neutral": _count(sentiment.get("neutral")),
            "negative": _count(sentiment.get("negative")),
        },
        "keywords": normalized_keywords[:15],
        "summary": str(raw.get("summary") or "").strip(),
    }


def analyze_reviews(payload):
    """가게 이름 + 리뷰 목록으로 Gemini에게 감성분석(분류/키워드/요약)을 요청한다."""
    place_name = str(payload.get("placeName") or "").strip()
    reviews = [
        r for r in (payload.get("reviews") or []) if isinstance(r, dict) and r.get("content")
    ]
    if not place_name or not reviews:
        raise ApiError(400, "placeName, reviews가 필요합니다.")

    api_key = _get_gemini_api_key()
    body = {
        "contents": [{"role": "user", "parts": [{"text": _build_analysis_prompt(place_name, reviews)}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": ANALYSIS_RESPONSE_SCHEMA,
        },
    }
    url = f"{GEMINI_URL_TEMPLATE.format(model=GEMINI_MODEL)}?key={api_key}"
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20, context=_SSL_CONTEXT) as res:
            data = json.loads(res.read())
    except urllib.error.HTTPError as e:
        body_bytes = e.read()
        try:
            parsed = json.loads(body_bytes)
        except json.JSONDecodeError:
            parsed = {}
        error_obj = parsed.get("error")
        message = error_obj.get("message") if isinstance(error_obj, dict) else error_obj
        raise ApiError(502, f"Gemini API 호출 실패: {message or e.reason}")
    except urllib.error.URLError as e:
        raise ApiError(502, f"Gemini API 호출 실패: {e.reason}")

    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        parsed_result = json.loads(text)
    except (KeyError, IndexError, json.JSONDecodeError):
        raise ApiError(502, "Gemini 응답에서 분석 결과를 찾지 못했습니다.")

    return 200, {"analyzed": True, "result": _normalize_analysis(parsed_result)}


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
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == "/api/analyze-reviews":
            length = int(self.headers.get("Content-Length") or 0)
            raw_body = self.rfile.read(length) if length else b"{}"
            try:
                payload = json.loads(raw_body or b"{}")
            except json.JSONDecodeError:
                self._send_json(400, {"error": "잘못된 요청 본문입니다."})
                return
            try:
                status, data = analyze_reviews(payload)
                self._send_json(status, data)
            except ApiError as e:
                self._send_json(e.status, {"error": e.message})
            return

        self._send_json(404, {"error": "not found"})

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

        if parsed.path == "/api/places-google":
            query_params = {
                k: v[0] for k, v in urllib.parse.parse_qs(parsed.query).items()
            }
            try:
                status, data = search_places_google(query_params)
                self._send_json(status, data)
            except ApiError as e:
                self._send_json(e.status, {"error": e.message})
            return

        if parsed.path == "/api/place-reviews":
            query_params = {
                k: v[0] for k, v in urllib.parse.parse_qs(parsed.query).items()
            }
            try:
                status, data = get_place_reviews(query_params)
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
    print("엔드포인트: GET /api/places-google?query=<검색어>")
    print("엔드포인트: GET /api/place-reviews?name=<가게이름>&x=<경도>&y=<위도>")
    print("엔드포인트: POST /api/analyze-reviews (body: {placeName, reviews})")
    if not os.environ.get("KAKAO_REST_API_KEY"):
        print("경고: KAKAO_REST_API_KEY 환경변수가 설정되어 있지 않습니다.")
    if not os.environ.get("GOOGLE_PLACES_API_KEY"):
        print("경고: GOOGLE_PLACES_API_KEY 환경변수가 설정되어 있지 않습니다.")
    if not os.environ.get("GEMINI_API_KEY"):
        print("경고: GEMINI_API_KEY 환경변수가 설정되어 있지 않습니다.")
    server.serve_forever()


if __name__ == "__main__":
    main()

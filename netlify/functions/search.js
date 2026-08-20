// netlify/functions/search.js
// 카카오 로컬 API(키워드/카테고리 검색) 프록시.
// 로컬 개발용 server.py(Python)와 동일한 역할을 Netlify Functions(Node)로 옮긴 것.
//
// 환경변수 (Netlify 사이트 설정 > Environment variables):
//   KAKAO_REST_API_KEY   카카오 디벨로퍼스에서 발급받은 REST API 키 (필수)
//
// 배포 후 호출 경로: /api/search?query=...&category_group_code=...
// (netlify.toml의 리다이렉트로 /.netlify/functions/search 에 연결됨)

const KAKAO_KEYWORD_URL = "https://dapi.kakao.com/v2/local/search/keyword.json";
const KAKAO_CATEGORY_URL = "https://dapi.kakao.com/v2/local/search/category.json";

const PASSTHROUGH_PARAMS = ["x", "y", "radius", "page", "size", "sort", "rect"];
const DEFAULT_CATEGORY_GROUP_CODE = "FD6";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
};

async function callKakao(url, params, apiKey) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${url}?${qs}`, {
    headers: { Authorization: `KakaoAK ${apiKey}` },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: "",
    };
  }

  const apiKey = process.env.KAKAO_REST_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        error: "서버에 KAKAO_REST_API_KEY 환경변수가 설정되어 있지 않습니다.",
      }),
    };
  }

  const query = (event.queryStringParameters?.query || "").trim();
  const categoryGroupCode = (
    event.queryStringParameters?.category_group_code || ""
  ).trim();

  const params = {};
  for (const key of PASSTHROUGH_PARAMS) {
    const value = event.queryStringParameters?.[key];
    if (value) params[key] = value;
  }

  try {
    let result;
    if (query) {
      params.query = query;
      if (categoryGroupCode) params.category_group_code = categoryGroupCode;
      result = await callKakao(KAKAO_KEYWORD_URL, params, apiKey);
    } else if (categoryGroupCode) {
      params.category_group_code = categoryGroupCode || DEFAULT_CATEGORY_GROUP_CODE;
      result = await callKakao(KAKAO_CATEGORY_URL, params, apiKey);
    } else {
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          error: "query 또는 category_group_code 파라미터가 필요합니다.",
        }),
      };
    }

    return {
      statusCode: result.status,
      headers: JSON_HEADERS,
      body: JSON.stringify(result.data),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: `카카오 API 호출 실패: ${err.message}` }),
    };
  }
};

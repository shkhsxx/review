// api/search.js
// 카카오 로컬 API(키워드/카테고리 검색) 프록시.
// Vercel Serverless Function — 이 파일이 자동으로 GET /api/search 로 매핑된다.
// (기존 netlify/functions/search.js와 동일한 로직, req/res 포맷만 Vercel에 맞춤)
//
// 환경변수 (Vercel 프로젝트 설정 > Environment Variables):
//   KAKAO_REST_API_KEY   카카오 디벨로퍼스에서 발급받은 REST API 키 (필수)
//
// 호출 경로: GET /api/search?query=...&category_group_code=...

const KAKAO_KEYWORD_URL = "https://dapi.kakao.com/v2/local/search/keyword.json";
const KAKAO_CATEGORY_URL = "https://dapi.kakao.com/v2/local/search/category.json";

const PASSTHROUGH_PARAMS = ["x", "y", "radius", "page", "size", "sort", "rect"];
const DEFAULT_CATEGORY_GROUP_CODE = "FD6";

async function callKakao(url, params, apiKey) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${url}?${qs}`, {
    headers: { Authorization: `KakaoAK ${apiKey}` },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).end();
    return;
  }

  const apiKey = process.env.KAKAO_REST_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "서버에 KAKAO_REST_API_KEY 환경변수가 설정되어 있지 않습니다." });
    return;
  }

  const query = String(req.query.query || "").trim();
  const categoryGroupCode = String(req.query.category_group_code || "").trim();

  const params = {};
  for (const key of PASSTHROUGH_PARAMS) {
    const value = req.query[key];
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
      res.status(400).json({ error: "query 또는 category_group_code 파라미터가 필요합니다." });
      return;
    }

    res.status(result.status).json(result.data);
  } catch (err) {
    res.status(502).json({ error: `카카오 API 호출 실패: ${err.message}` });
  }
};

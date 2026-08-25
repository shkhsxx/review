/**
 * save.js
 * "맛집 담기" 페이지 로직.
 * - server.py의 /api/search(카카오) + /api/places-google(구글)를 함께 호출해
 *   두 소스의 검색 결과를 가져온다.
 * - 구글 결과는 카카오 문서 형태(place_name/address_name/id 등)에 맞춰 정규화한 뒤
 *   같은 .place-card 렌더링 로직을 재사용한다.
 * - 결과를 .place-card 로 렌더링한다.
 * - 카드의 "담기" 버튼은 saved-places.js(Supabase saved_places 테이블)를 호출한다.
 *   로그인하지 않은 상태에서 누르면 안내와 함께 로그인 모달을 연다.
 * - 담은 목록(.saved-item)은 페이지 로드 시 + 변경 시마다 saved-places.js에서 다시 읽어 렌더링한다.
 * - 카드를 클릭하면(저장 버튼/링크 클릭은 제외) server.py의 /api/place-reviews
 *   (구글 Places API (New) 프록시)를 호출해 .review-panel에 별점/리뷰를 보여준다.
 *   같은 가게를 다시 클릭하면 재요청 없이 sessionStorage 캐시를 바로 보여준다
 *   (새로고침해도 유지되고, 탭을 닫으면 사라진다).
 * - 리뷰가 1건 이상 렌더링되면 곧바로 server.py의 /api/analyze-reviews(Gemini 프록시)를
 *   호출해 감성분석(긍정/보통/부정 비율, 핵심 키워드, 한줄 요약)을 .review-panel__analysis에
 *   보여준다. 분석 결과도 sessionStorage에 캐시해 같은 가게 재클릭 시 재요청하지 않는다.
 *
 * ※ HTML class 구조는 save.html 상단 주석을 참고 (design 팀원과 공유된 구조).
 */

import { getCurrentUser, onAuthChange } from "./auth.js";
import { promptLogin } from "./auth-widget.js";
import {
  getSavedPlaces,
  savePlace,
  removePlace,
  isPlaceSaved,
  waitForSavedPlaces,
} from "./saved-places.js";
import { showUndoToast } from "./toast.js";

// 로그인하지 않은 상태에서 "담기"를 눌렀을 때, 로그인에 성공하면 다시 누르지 않아도
// 방금 누르려던 가게가 자동으로 담기도록 기억해두는 슬롯. 로그인 모달을 통하지 않은
// 로그인(예: 헤더 로그인)이면 그냥 무시된다.
let pendingSave = null;

/** fetch 자체가 실패한 네트워크 오류는 사용자에게 더 명확한 한국어 안내로 바꿔준다.
 *  fetchPlaces()처럼 원본 TypeError를 일반 Error로 다시 감싸는 곳도 있어서, 타입뿐
 *  아니라 메시지 패턴("Failed to fetch" 등)도 함께 확인한다. */
function friendlyError(err, fallback) {
  const message = (err && err.message) || "";
  if (err instanceof TypeError || /failed to fetch|network ?error|load failed/i.test(message)) {
    return "네트워크 연결을 확인해주세요.";
  }
  return message || fallback;
}

// 로컬에서 server.py(파이썬 프록시)로 개발할 땐 localhost:8000을 호출하고,
// Vercel 등 배포 환경에서는 같은 오리진의 /api/search(api/ 디렉토리의 Vercel
// Serverless Function으로 자동 라우팅됨)를 상대 경로로 호출한다.
const isLocalDev =
  location.hostname === "localhost" || location.hostname === "127.0.0.1";
const API_BASE_URL = isLocalDev ? "http://localhost:8000" : "";

const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const categorySelect = document.getElementById("category-select");
const searchStatus = document.getElementById("search-status");
const placeCardList = document.getElementById("place-card-list");
const savedListItems = document.getElementById("saved-list-items");
const savedListEmpty = document.getElementById("saved-list-empty");

const reviewPanel = document.getElementById("review-panel");
const reviewPanelName = document.getElementById("review-panel-name");
const reviewPanelCloseBtn = document.getElementById("review-panel-close-btn");
const reviewPanelRating = document.getElementById("review-panel-rating");
const reviewPanelLoading = document.getElementById("review-panel-loading");
const reviewPanelNotFound = document.getElementById("review-panel-not-found");
const reviewPanelList = document.getElementById("review-panel-list");
const reviewPanelMapLink = document.getElementById("review-panel-map-link");

const reviewPanelAnalysis = document.getElementById("review-panel-analysis");
const analysisToggle = document.getElementById("review-panel-analysis-toggle");
const analysisBody = document.getElementById("review-panel-analysis-body");
const analysisLoading = document.getElementById("review-panel-analysis-loading");
const analysisError = document.getElementById("review-panel-analysis-error");
const analysisContent = document.getElementById("review-panel-analysis-content");
const sentimentBarPositive = document.getElementById("sentiment-bar-positive");
const sentimentBarNeutral = document.getElementById("sentiment-bar-neutral");
const sentimentBarNegative = document.getElementById("sentiment-bar-negative");
const sentimentCountPositive = document.getElementById("sentiment-count-positive");
const sentimentCountNeutral = document.getElementById("sentiment-count-neutral");
const sentimentCountNegative = document.getElementById("sentiment-count-negative");
const wordCloud = document.getElementById("word-cloud");
const analysisSummary = document.getElementById("analysis-summary");

// 한 번 조회한 가게의 리뷰 결과를 sessionStorage에 기억해뒀다가 같은 가게를 다시 클릭하면
// 재요청하지 않는다. 새로고침해도 유지되고, 탭을 닫으면(세션 종료) 사라진다.
// key: place.id(없으면 이름+주소로 대체), value: /api/place-reviews 응답 그대로.
const REVIEW_CACHE_PREFIX = "todaywhattoeat_review_cache:";
// 같은 key로 /api/analyze-reviews 결과(감성분석)도 별도 prefix로 캐시한다.
const ANALYSIS_CACHE_PREFIX = "todaywhattoeat_analysis_cache:";

function getCachedReview(cacheKey) {
  try {
    const raw = window.sessionStorage.getItem(REVIEW_CACHE_PREFIX + cacheKey);
    return raw ? JSON.parse(raw) : undefined;
  } catch (err) {
    console.error("[save.js] 리뷰 캐시를 읽지 못했습니다:", err);
    return undefined;
  }
}

function setCachedReview(cacheKey, result) {
  try {
    window.sessionStorage.setItem(REVIEW_CACHE_PREFIX + cacheKey, JSON.stringify(result));
  } catch (err) {
    console.error("[save.js] 리뷰 캐시를 저장하지 못했습니다:", err);
  }
}

function getCachedAnalysis(cacheKey) {
  try {
    const raw = window.sessionStorage.getItem(ANALYSIS_CACHE_PREFIX + cacheKey);
    return raw ? JSON.parse(raw) : undefined;
  } catch (err) {
    console.error("[save.js] 분석 캐시를 읽지 못했습니다:", err);
    return undefined;
  }
}

function setCachedAnalysis(cacheKey, result) {
  try {
    window.sessionStorage.setItem(ANALYSIS_CACHE_PREFIX + cacheKey, JSON.stringify(result));
  } catch (err) {
    console.error("[save.js] 분석 캐시를 저장하지 못했습니다:", err);
  }
}

function setStatus(message) {
  searchStatus.textContent = message || "";
}

/** 카카오 검색 API 호출 */
async function fetchKakaoPlaces(query, categoryGroupCode) {
  const params = new URLSearchParams();
  if (query) params.set("query", query);
  if (categoryGroupCode) params.set("category_group_code", categoryGroupCode);

  const res = await fetch(`${API_BASE_URL}/api/search?${params.toString()}`);
  const data = await res.json();

  if (!res.ok) {
    const message =
      (data && data.error && (data.error.message || data.error)) ||
      "카카오 검색 중 오류가 발생했습니다.";
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }

  return (data.documents || []).map(normalizeKakaoPlace);
}

/** 구글 플레이스 API(Text Search) 호출 */
async function fetchGooglePlaces(query) {
  const params = new URLSearchParams();
  if (query) params.set("query", query);

  const res = await fetch(`${API_BASE_URL}/api/places-google?${params.toString()}`);
  const data = await res.json();

  if (!res.ok) {
    const message =
      (data && data.error && (data.error.message || data.error)) ||
      "구글 검색 중 오류가 발생했습니다.";
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }

  // 구글 Places API는 오류 상황에서도 HTTP 200을 내려주고 status 필드로 구분한다.
  if (data.status && data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(data.error_message || `구글 검색 오류: ${data.status}`);
  }

  return (data.results || []).map(normalizeGooglePlace);
}

/**
 * 카카오/구글 검색을 함께 호출해 결과를 합친 배열을 반환한다.
 * 한쪽 API가 실패해도(예: 환경변수 미설정) 다른 쪽 결과는 그대로 보여준다.
 * 둘 다 실패했을 때만 에러를 던진다.
 */
async function fetchPlaces(query, categoryGroupCode) {
  const [kakaoResult, googleResult] = await Promise.allSettled([
    fetchKakaoPlaces(query, categoryGroupCode),
    fetchGooglePlaces(query),
  ]);

  const places = [];

  if (kakaoResult.status === "fulfilled") {
    places.push(...kakaoResult.value);
  } else {
    console.error("[save.js] 카카오 검색 실패:", kakaoResult.reason);
  }

  if (googleResult.status === "fulfilled") {
    places.push(...googleResult.value);
  } else {
    console.error("[save.js] 구글 검색 실패:", googleResult.reason);
  }

  if (kakaoResult.status === "rejected" && googleResult.status === "rejected") {
    throw new Error(kakaoResult.reason?.message || "검색 중 오류가 발생했습니다.");
  }

  return places;
}

/** 카카오 검색 결과 document에 source 표시를 붙인다(구글 결과와 동일한 형태로 다루기 위함). */
function normalizeKakaoPlace(doc) {
  return { ...doc, source: "kakao" };
}

/**
 * 구글 Places API(Text Search) 결과 한 건을 기존 createPlaceCard()가 기대하는
 * 카카오 문서 필드 이름(place_name/address_name/id 등)에 맞춰 정규화한다.
 */
function normalizeGooglePlace(googlePlace) {
  const location = googlePlace.geometry && googlePlace.geometry.location;
  const firstPhoto = Array.isArray(googlePlace.photos) ? googlePlace.photos[0] : null;
  return {
    source: "google",
    id: googlePlace.place_id || "",
    place_name: googlePlace.name || "",
    category_name:
      Array.isArray(googlePlace.types) && googlePlace.types.length
        ? googlePlace.types.join(", ")
        : "",
    address_name: googlePlace.formatted_address || "",
    road_address_name: "",
    phone: "", // Text Search 응답에는 전화번호가 포함되지 않는다.
    place_url: googlePlace.place_id
      ? `https://www.google.com/maps/place/?q=place_id:${googlePlace.place_id}`
      : "",
    x: location ? String(location.lng) : "",
    y: location ? String(location.lat) : "",
    rating: typeof googlePlace.rating === "number" ? googlePlace.rating : null,
    // 카카오는 사진 필드를 주지 않으므로 구글 결과에만 존재한다(/api/place-photo로 대신 받아옴).
    photoRef: firstPhoto ? firstPhoto.photo_reference || "" : "",
  };
}

/** saved_places 행(entry)을 savePlace()가 기대하는 place 형태로 되돌린다(삭제 되돌리기용). */
function entryToPlace(entry) {
  return {
    place_name: entry.place_name,
    category_name: entry.category,
    address_name: entry.address,
    road_address_name: "",
    x: entry.lng,
    y: entry.lat,
  };
}

/** place로부터 saved_places 테이블에서 쓰는 고유 id를 만든다("kakao-<id>" | "google-<id>"). */
function getPlaceId(place) {
  const prefix = place.source === "google" ? "google" : "kakao";
  if (place.id) return `${prefix}-${place.id}`;
  return `${prefix}-${place.place_name || ""}-${place.address_name || ""}`;
}

/** 검색 결과 한 건(place)을 .place-card DOM으로 변환 */
function createPlaceCard(place) {
  const placeId = getPlaceId(place);

  const card = document.createElement("article");
  card.className = "place-card";
  card.dataset.placeId = placeId;
  card.dataset.source = place.source || "kakao";

  if (place.photoRef) {
    const photoWrap = document.createElement("div");
    photoWrap.className = "place-card__photo-wrap";

    const photo = document.createElement("img");
    photo.className = "place-card__photo";
    photo.src = `${API_BASE_URL}/api/place-photo?photo_reference=${encodeURIComponent(
      place.photoRef
    )}&maxwidth=400`;
    photo.alt = "";
    photo.loading = "lazy";
    photoWrap.appendChild(photo);

    card.appendChild(photoWrap);
  }

  if (place.source) {
    const source = document.createElement("span");
    source.className = "place-card__source";
    source.textContent = place.source === "google" ? "구글" : "카카오";
    card.appendChild(source);
  }

  const name = document.createElement("h3");
  name.className = "place-card__name";
  name.textContent = place.place_name || "이름 없음";
  card.appendChild(name);

  if (place.category_name) {
    const category = document.createElement("p");
    category.className = "place-card__category";
    category.textContent = place.category_name;
    card.appendChild(category);
  }

  const address = document.createElement("p");
  address.className = "place-card__address";
  address.textContent = place.road_address_name || place.address_name || "";
  card.appendChild(address);

  if (place.phone) {
    const phone = document.createElement("p");
    phone.className = "place-card__phone";
    phone.textContent = place.phone;
    card.appendChild(phone);
  }

  if (typeof place.rating === "number") {
    const rating = document.createElement("p");
    rating.className = "place-card__rating";
    rating.textContent = `평점 ${place.rating.toFixed(1)}`;
    card.appendChild(rating);
  }

  if (place.place_url) {
    const link = document.createElement("a");
    link.className = "place-card__link";
    link.href = place.place_url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = place.source === "google" ? "구글 지도에서 보기" : "카카오맵에서 보기";
    card.appendChild(link);
  }

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "place-card__save-btn";
  setSaveButtonState(saveBtn, isPlaceSaved(placeId));
  saveBtn.addEventListener("click", () => handleSaveClick(place, placeId, saveBtn));
  card.appendChild(saveBtn);

  // 카드를 클릭하면 리뷰 패널을 연다. 저장 버튼/링크 클릭은 각자의 동작을 우선한다.
  card.addEventListener("click", (event) => {
    if (event.target.closest(".place-card__save-btn, .place-card__link")) return;
    openReviewPanel(place);
  });

  return card;
}

/** "담기" 버튼의 표시 상태(담음/담기)를 갱신한다. */
function setSaveButtonState(btn, saved) {
  btn.textContent = saved ? "담음" : "담기";
  btn.classList.toggle("place-card__save-btn--saved", saved);
}

/** "담기"/"담음" 버튼 클릭 핸들러. 로그인하지 않았으면 안내와 함께 로그인 모달을 연다. */
async function handleSaveClick(place, placeId, btn) {
  if (!getCurrentUser()) {
    pendingSave = { place, placeId, btn };
    promptLogin("로그인하면 담을 수 있어요.");
    return;
  }

  btn.disabled = true;
  try {
    if (isPlaceSaved(placeId)) {
      await removePlace(placeId);
      setSaveButtonState(btn, false);
      showUndoToast("담기를 취소했어요", async () => {
        try {
          await savePlace(place, placeId);
          setSaveButtonState(btn, true);
          renderSavedList();
        } catch (err) {
          console.error("[save.js] 담기 되돌리기 실패:", err);
          setStatus(friendlyError(err, "되돌리기에 실패했습니다."));
        }
      });
    } else {
      await savePlace(place, placeId);
      setSaveButtonState(btn, true);
    }
    renderSavedList();
  } catch (err) {
    console.error("[save.js] 담기 처리 실패:", err);
    setStatus(friendlyError(err, "담기 처리 중 오류가 발생했습니다."));
  } finally {
    btn.disabled = false;
  }
}

/** 검색 결과 목록을 렌더링 */
function renderPlaceCards(places) {
  placeCardList.innerHTML = "";
  if (!places.length) {
    setStatus("검색 결과가 없습니다.");
    return;
  }
  setStatus(`검색 결과 ${places.length}건`);
  const fragment = document.createDocumentFragment();
  places.forEach((place) => fragment.appendChild(createPlaceCard(place)));
  placeCardList.appendChild(fragment);
}

/** 리뷰 캐시에 쓸 키를 만든다(가게 id 기준, 없으면 이름+주소로 대체). */
function getReviewCacheKey(place) {
  return place.id || `${place.place_name || ""}-${place.address_name || ""}`;
}

/** 구글 Places API (New) 프록시(/api/place-reviews)를 호출해 별점/리뷰를 가져온다. */
async function fetchPlaceReviews(place) {
  const params = new URLSearchParams();
  params.set("name", place.place_name || "");
  params.set("x", place.x || "");
  params.set("y", place.y || "");

  const res = await fetch(`${API_BASE_URL}/api/place-reviews?${params.toString()}`);
  const data = await res.json();

  if (!res.ok) {
    const message =
      (data && data.error && (data.error.message || data.error)) ||
      "리뷰 조회 중 오류가 발생했습니다.";
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }

  return data; // { found: true, place: {...} } 또는 { found: false }
}

/** server.py의 /api/analyze-reviews(Gemini 프록시)를 호출해 감성분석 결과를 가져온다. */
async function fetchReviewAnalysis(placeName, reviews) {
  const res = await fetch(`${API_BASE_URL}/api/analyze-reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      placeName,
      reviews: reviews.map((r) => ({
        author: r.author,
        rating: r.rating,
        date: r.date,
        content: r.content,
      })),
    }),
  });
  const data = await res.json();

  if (!res.ok) {
    const message =
      (data && data.error && (data.error.message || data.error)) ||
      "리뷰 분석 중 오류가 발생했습니다.";
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }

  return data.result; // { sentiment: {positive,neutral,negative}, keywords: [...], summary }
}

/** 중요도 점수(1~10)를 워드클라우드 폰트 크기(rem)로 변환한다. */
function scoreToFontSize(score) {
  const clamped = Math.min(10, Math.max(1, typeof score === "number" ? score : 5));
  return 0.85 + ((clamped - 1) / 9) * (2.1 - 0.85);
}

/** 핵심 단어 한 건을 .word-cloud__item DOM으로 변환 */
function createWordCloudItem(keyword) {
  const item = document.createElement("span");
  const isNegative = keyword.sentiment === "negative";
  item.className = `word-cloud__item word-cloud__item--${isNegative ? "negative" : "positive"}`;
  item.style.fontSize = `${scoreToFontSize(keyword.score)}rem`;
  item.textContent = keyword.word || "";
  return item;
}

/** /api/analyze-reviews 응답(result)을 .review-panel__analysis-content에 렌더링한다. */
function renderAnalysis(result) {
  analysisContent.hidden = false;

  const sentiment = (result && result.sentiment) || {};
  const positive = sentiment.positive || 0;
  const neutral = sentiment.neutral || 0;
  const negative = sentiment.negative || 0;
  const total = positive + neutral + negative;

  sentimentBarPositive.style.flexBasis = total ? `${(positive / total) * 100}%` : "0%";
  sentimentBarNeutral.style.flexBasis = total ? `${(neutral / total) * 100}%` : "0%";
  sentimentBarNegative.style.flexBasis = total ? `${(negative / total) * 100}%` : "0%";

  sentimentCountPositive.textContent = positive;
  sentimentCountNeutral.textContent = neutral;
  sentimentCountNegative.textContent = negative;

  wordCloud.innerHTML = "";
  const fragment = document.createDocumentFragment();
  ((result && result.keywords) || []).forEach((keyword) =>
    fragment.appendChild(createWordCloudItem(keyword))
  );
  wordCloud.appendChild(fragment);

  analysisSummary.textContent = (result && result.summary) || "";
}

/** 분석 영역을 초기 숨김 상태로 되돌린다(패널을 새로 열 때마다 호출). */
function resetAnalysisPanel() {
  reviewPanelAnalysis.hidden = true;
  analysisBody.hidden = true;
  analysisToggle.textContent = "AI 리뷰 분석 보기";
  analysisToggle.setAttribute("aria-expanded", "false");
  analysisLoading.hidden = true;
  analysisError.hidden = true;
  analysisContent.hidden = true;
  wordCloud.innerHTML = "";
  analysisSummary.textContent = "";
}

/** "AI 리뷰 분석 보기/접기" 토글 버튼 클릭 핸들러. */
function toggleAnalysisBody() {
  const willShow = analysisBody.hidden;
  analysisBody.hidden = !willShow;
  analysisToggle.textContent = willShow ? "AI 리뷰 분석 접기" : "AI 리뷰 분석 보기";
  analysisToggle.setAttribute("aria-expanded", String(willShow));
}

/**
 * 리뷰 렌더링이 끝난 뒤 자동으로 호출된다. 리뷰가 없는 가게는 분석하지 않고
 * .review-panel__analysis를 숨긴 채로 둔다. 캐시가 있으면 재요청 없이 바로 보여준다.
 */
async function maybeStartAnalysis(place, cacheKey, reviewResult) {
  const allReviews = reviewResult && reviewResult.found ? reviewResult.place.reviews || [] : [];
  // 협찬/체험단 의심 리뷰는 화면에는 표시하되(createReviewItem), AI 감성분석 근거에서는 제외한다.
  const reviews = allReviews.filter((review) => !review.isAd);
  if (!reviews.length) {
    reviewPanelAnalysis.hidden = true;
    return;
  }

  reviewPanelAnalysis.hidden = false;
  analysisError.hidden = true;
  analysisContent.hidden = true;

  const cachedAnalysis = getCachedAnalysis(cacheKey);
  if (cachedAnalysis !== undefined) {
    analysisLoading.hidden = true;
    renderAnalysis(cachedAnalysis);
    return;
  }

  analysisLoading.hidden = false;

  try {
    const placeName = reviewResult.place.name || place.place_name || "";
    const analysisResult = await fetchReviewAnalysis(placeName, reviews);
    setCachedAnalysis(cacheKey, analysisResult);
    analysisLoading.hidden = true;
    renderAnalysis(analysisResult);
  } catch (err) {
    console.error("[save.js] 리뷰 분석 실패:", err);
    analysisLoading.hidden = true;
    analysisContent.hidden = true;
    analysisError.textContent = friendlyError(err, "리뷰 분석에 실패했습니다.");
    analysisError.hidden = false;
  }
}

/** 리뷰 한 건을 .review-item DOM으로 변환 */
function createReviewItem(review) {
  const item = document.createElement("article");
  item.className = "review-item";
  if (review.isAd) item.classList.add("review-item--ad-suspected");

  const author = document.createElement("p");
  author.className = "review-item__author";
  author.textContent = review.author || "익명";
  item.appendChild(author);

  const rating = document.createElement("p");
  rating.className = "review-item__rating";
  rating.textContent = typeof review.rating === "number" ? `★ ${review.rating}` : "";
  item.appendChild(rating);

  const date = document.createElement("p");
  date.className = "review-item__date";
  date.textContent = review.date || "";
  item.appendChild(date);

  const content = document.createElement("p");
  content.className = "review-item__content";
  content.textContent = review.content || "";
  item.appendChild(content);

  // 협찬/체험단 의심 리뷰는 지우지 않고, 왜 걸러졌는지 이유를 함께 보여준다.
  if (review.isAd && Array.isArray(review.adReasons) && review.adReasons.length) {
    const flags = document.createElement("div");
    flags.className = "review-item__ad-flags";
    review.adReasons.forEach((reason) => {
      const flag = document.createElement("span");
      flag.className = "flag";
      flag.textContent = `협찬 의심 · ${reason}`;
      flags.appendChild(flag);
    });
    item.appendChild(flags);
  }

  return item;
}

/** /api/place-reviews 응답(result)을 .review-panel에 렌더링한다. */
function renderReviewPanel(place, result) {
  reviewPanelLoading.hidden = true;

  if (!result || !result.found) {
    reviewPanelName.textContent = place.place_name || "";
    reviewPanelRating.textContent = "";
    reviewPanelList.innerHTML = "";
    reviewPanelMapLink.hidden = true;
    reviewPanelNotFound.textContent = "구글에서 이 가게를 찾을 수 없어요.";
    reviewPanelNotFound.hidden = false;
    return;
  }

  reviewPanelNotFound.hidden = true;
  const { name, rating, userRatingCount, reviews, mapsUri } = result.place;

  reviewPanelName.textContent = name || place.place_name || "";
  reviewPanelRating.textContent =
    typeof rating === "number"
      ? `★ ${rating.toFixed(1)} (리뷰 ${userRatingCount}개)`
      : `리뷰 ${userRatingCount}개`;

  reviewPanelList.innerHTML = "";
  const fragment = document.createDocumentFragment();
  (reviews || []).forEach((review) => fragment.appendChild(createReviewItem(review)));
  reviewPanelList.appendChild(fragment);

  if (mapsUri) {
    reviewPanelMapLink.href = mapsUri;
    reviewPanelMapLink.hidden = false;
  } else {
    reviewPanelMapLink.hidden = true;
  }
}

/** 카드 클릭 시 리뷰 패널을 열고, 캐시에 없으면 서버에서 가져와 렌더링한다.
 *  리뷰 렌더링이 끝나면 이어서 AI 감성분석(maybeStartAnalysis)을 자동으로 시작한다. */
async function openReviewPanel(place) {
  reviewPanel.hidden = false;
  reviewPanelNotFound.hidden = true;
  reviewPanelList.innerHTML = "";
  reviewPanelMapLink.hidden = true;
  reviewPanelName.textContent = place.place_name || "";
  reviewPanelRating.textContent = "";
  resetAnalysisPanel();

  const cacheKey = getReviewCacheKey(place);
  const cached = getCachedReview(cacheKey);

  if (cached !== undefined) {
    reviewPanelLoading.hidden = true;
    renderReviewPanel(place, cached);
    maybeStartAnalysis(place, cacheKey, cached);
    return;
  }

  reviewPanelLoading.hidden = false;

  try {
    const result = await fetchPlaceReviews(place);
    setCachedReview(cacheKey, result);
    renderReviewPanel(place, result);
    maybeStartAnalysis(place, cacheKey, result);
  } catch (err) {
    console.error("[save.js] 리뷰 조회 실패:", err);
    reviewPanelLoading.hidden = true;
    reviewPanelList.innerHTML = "";
    reviewPanelMapLink.hidden = true;
    reviewPanelNotFound.textContent = friendlyError(err, "리뷰를 불러오지 못했습니다.");
    reviewPanelNotFound.hidden = false;
    reviewPanelAnalysis.hidden = true;
  }
}

function closeReviewPanel() {
  reviewPanel.hidden = true;
}

/** 담은 맛집 한 건을 .saved-item DOM으로 변환 */
function createSavedItem(entry) {
  const item = document.createElement("div");
  item.className = "saved-item";
  item.dataset.placeId = entry.place_id;

  const name = document.createElement("p");
  name.className = "saved-item__name";
  name.textContent = entry.place_name;
  item.appendChild(name);

  const address = document.createElement("p");
  address.className = "saved-item__address";
  address.textContent = entry.address || "";
  item.appendChild(address);

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "saved-item__remove-btn";
  removeBtn.textContent = "삭제";
  removeBtn.addEventListener("click", async () => {
    removeBtn.disabled = true;
    try {
      await removePlace(entry.place_id);
      renderSavedList();
      // 검색 결과에 같은 가게가 보이고 있다면 "담기" 버튼을 다시 되돌린다
      const cardBtn = placeCardList.querySelector(
        `.place-card[data-place-id="${CSS.escape(entry.place_id || "")}"] .place-card__save-btn`
      );
      if (cardBtn) setSaveButtonState(cardBtn, false);

      showUndoToast("삭제했어요", async () => {
        try {
          await savePlace(entryToPlace(entry), entry.place_id);
          renderSavedList();
          if (cardBtn) setSaveButtonState(cardBtn, true);
        } catch (err) {
          console.error("[save.js] 삭제 되돌리기 실패:", err);
          setStatus(friendlyError(err, "되돌리기에 실패했습니다."));
        }
      });
    } catch (err) {
      console.error("[save.js] 담은 맛집 삭제 실패:", err);
      removeBtn.disabled = false;
      setStatus(friendlyError(err, "삭제 중 오류가 발생했습니다."));
    }
  });
  item.appendChild(removeBtn);

  return item;
}

/** 로그인한 사용자가 Supabase에 담아둔 맛집 기준으로 목록 섹션 전체를 다시 그린다. */
async function renderSavedList() {
  const list = await getSavedPlaces();
  savedListItems.innerHTML = "";

  if (!list.length) {
    savedListEmpty.hidden = false;
    return;
  }

  savedListEmpty.hidden = true;
  const fragment = document.createDocumentFragment();
  // 최근 담은 순으로 표시
  [...list]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .forEach((entry) => fragment.appendChild(createSavedItem(entry)));
  savedListItems.appendChild(fragment);
}

/** 이미 렌더링된 검색 결과 카드들의 "담기" 버튼 상태를 현재 로그인 사용자 기준으로 다시 맞춘다. */
async function refreshSaveButtons() {
  await waitForSavedPlaces();
  placeCardList.querySelectorAll(".place-card").forEach((card) => {
    const btn = card.querySelector(".place-card__save-btn");
    if (btn) setSaveButtonState(btn, isPlaceSaved(card.dataset.placeId));
  });
}

/** 검색을 실제로 실행한다. form submit과 ?q= 자동 검색이 이 함수를 공유한다. */
async function runSearch(query, categoryGroupCode) {
  if (!query) {
    setStatus("검색어를 입력해주세요.");
    return;
  }

  setStatus("검색 중...");
  placeCardList.innerHTML = "";

  try {
    const [places] = await Promise.all([fetchPlaces(query, categoryGroupCode), waitForSavedPlaces()]);
    renderPlaceCards(places);
  } catch (err) {
    console.error("[save.js] 검색 실패:", err);
    setStatus(friendlyError(err, "검색 중 오류가 발생했습니다."));
  }
}

function handleSearchSubmit(event) {
  event.preventDefault();
  runSearch(searchInput.value.trim(), categorySelect.value);
}

/** 로그인 모달을 거쳐 로그인에 성공하면, 로그인 전 누르려던 "담기"를 자동으로 이어서 실행한다. */
function resumePendingSave(user) {
  if (!user || !pendingSave) return;
  const { place, placeId, btn } = pendingSave;
  pendingSave = null;
  if (document.body.contains(btn)) handleSaveClick(place, placeId, btn);
}

function init() {
  searchForm.addEventListener("submit", handleSearchSubmit);
  reviewPanelCloseBtn.addEventListener("click", closeReviewPanel);
  analysisToggle.addEventListener("click", toggleAnalysisBody);
  onAuthChange((user) => {
    renderSavedList();
    refreshSaveButtons();
    resumePendingSave(user);
  });
  renderSavedList();

  // 홈 화면 검색창(index.html)에서 ?q=검색어 로 들어오면 곧바로 검색을 실행한다.
  const queryFromUrl = new URLSearchParams(location.search).get("q");
  if (queryFromUrl) {
    searchInput.value = queryFromUrl;
    runSearch(queryFromUrl, categorySelect.value);
  }
}

init();

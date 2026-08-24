/**
 * save.js
 * "맛집 담기" 페이지 로직.
 * - server.py의 /api/search(카카오) + /api/places-google(구글)를 함께 호출해
 *   두 소스의 검색 결과를 가져온다.
 * - 구글 결과는 카카오 문서 형태(place_name/address_name/id 등)에 맞춰 정규화한 뒤
 *   같은 .place-card 렌더링 로직을 재사용한다.
 * - 결과를 .place-card 로 렌더링한다.
 * - 카드의 "담기" 버튼은 storage.js의 savePlace()를 호출한다.
 * - 담은 목록(.saved-item)은 페이지 로드 시 + 변경 시마다 storage.js에서 다시 읽어 렌더링한다.
 * - 카드를 클릭하면(저장 버튼/링크 클릭은 제외) server.py의 /api/place-reviews
 *   (구글 Places API (New) 프록시)를 호출해 .review-panel에 별점/리뷰를 보여준다.
 *   같은 가게를 다시 클릭하면 재요청 없이 메모리 캐시(reviewCache)를 바로 보여준다.
 *
 * ※ HTML class 구조는 save.html 상단 주석을 참고 (design 팀원과 공유된 구조).
 */

import {
  getSavedPlaces,
  savePlace,
  removePlace,
  isPlaceSaved,
} from "./storage.js";

// 로컬에서 server.py(파이썬 프록시)로 개발할 땐 localhost:8000을 호출하고,
// Netlify 등 배포 환경에서는 같은 오리진의 /api/search(Netlify Functions로
// 리다이렉트됨)를 상대 경로로 호출한다.
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

// 한 번 조회한 가게의 리뷰 결과를 기억해뒀다가 같은 가게를 다시 클릭하면 재요청하지 않는다.
// key: place.id(없으면 이름+주소로 대체), value: /api/place-reviews 응답 그대로.
const reviewCache = new Map();

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
  };
}

/** 검색 결과 한 건(place)을 .place-card DOM으로 변환 */
function createPlaceCard(place) {
  const card = document.createElement("article");
  card.className = "place-card";
  card.dataset.placeId = place.id || "";
  card.dataset.source = place.source || "kakao";

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
  const alreadySaved = isPlaceSaved(place);
  saveBtn.textContent = alreadySaved ? "담음" : "담기";
  saveBtn.disabled = alreadySaved;
  saveBtn.addEventListener("click", () => {
    const { added } = savePlace(place);
    if (added) {
      saveBtn.textContent = "담음";
      saveBtn.disabled = true;
      renderSavedList();
    }
  });
  card.appendChild(saveBtn);

  // 카드를 클릭하면 리뷰 패널을 연다. 저장 버튼/링크 클릭은 각자의 동작을 우선한다.
  card.addEventListener("click", (event) => {
    if (event.target.closest(".place-card__save-btn, .place-card__link")) return;
    openReviewPanel(place);
  });

  return card;
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

/** 리뷰 한 건을 .review-item DOM으로 변환 */
function createReviewItem(review) {
  const item = document.createElement("article");
  item.className = "review-item";

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

/** 카드 클릭 시 리뷰 패널을 열고, 캐시에 없으면 서버에서 가져와 렌더링한다. */
async function openReviewPanel(place) {
  reviewPanel.hidden = false;
  reviewPanelNotFound.hidden = true;
  reviewPanelList.innerHTML = "";
  reviewPanelMapLink.hidden = true;
  reviewPanelName.textContent = place.place_name || "";
  reviewPanelRating.textContent = "";

  const cacheKey = getReviewCacheKey(place);

  if (reviewCache.has(cacheKey)) {
    reviewPanelLoading.hidden = true;
    renderReviewPanel(place, reviewCache.get(cacheKey));
    return;
  }

  reviewPanelLoading.hidden = false;

  try {
    const result = await fetchPlaceReviews(place);
    reviewCache.set(cacheKey, result);
    renderReviewPanel(place, result);
  } catch (err) {
    console.error("[save.js] 리뷰 조회 실패:", err);
    reviewPanelLoading.hidden = true;
    reviewPanelList.innerHTML = "";
    reviewPanelMapLink.hidden = true;
    reviewPanelNotFound.textContent = err.message || "리뷰를 불러오지 못했습니다.";
    reviewPanelNotFound.hidden = false;
  }
}

function closeReviewPanel() {
  reviewPanel.hidden = true;
}

/** 담은 맛집 한 건을 .saved-item DOM으로 변환 */
function createSavedItem(entry) {
  const item = document.createElement("div");
  item.className = "saved-item";
  item.dataset.placeId = entry.id;

  const name = document.createElement("p");
  name.className = "saved-item__name";
  name.textContent = entry.name;
  item.appendChild(name);

  const address = document.createElement("p");
  address.className = "saved-item__address";
  address.textContent = entry.roadAddress || entry.address || "";
  item.appendChild(address);

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "saved-item__remove-btn";
  removeBtn.textContent = "삭제";
  removeBtn.addEventListener("click", () => {
    removePlace(entry.id);
    renderSavedList();
    // 검색 결과에 같은 가게가 보이고 있다면 "담기" 버튼을 다시 활성화
    const cardBtn = placeCardList.querySelector(
      `.place-card[data-place-id="${CSS.escape(entry.placeId || "")}"] .place-card__save-btn`
    );
    if (cardBtn) {
      cardBtn.textContent = "담기";
      cardBtn.disabled = false;
    }
  });
  item.appendChild(removeBtn);

  return item;
}

/** localStorage 기준으로 담은 목록 섹션 전체를 다시 그린다 */
function renderSavedList() {
  const list = getSavedPlaces();
  savedListItems.innerHTML = "";

  if (!list.length) {
    savedListEmpty.hidden = false;
    return;
  }

  savedListEmpty.hidden = true;
  const fragment = document.createDocumentFragment();
  // 최근 담은 순으로 표시
  [...list]
    .sort((a, b) => b.savedAt - a.savedAt)
    .forEach((entry) => fragment.appendChild(createSavedItem(entry)));
  savedListItems.appendChild(fragment);
}

async function handleSearchSubmit(event) {
  event.preventDefault();
  const query = searchInput.value.trim();
  const categoryGroupCode = categorySelect.value;

  if (!query) {
    setStatus("검색어를 입력해주세요.");
    return;
  }

  setStatus("검색 중...");
  placeCardList.innerHTML = "";

  try {
    const places = await fetchPlaces(query, categoryGroupCode);
    renderPlaceCards(places);
  } catch (err) {
    console.error("[save.js] 검색 실패:", err);
    setStatus(err.message || "검색 중 오류가 발생했습니다.");
  }
}

function init() {
  searchForm.addEventListener("submit", handleSearchSubmit);
  reviewPanelCloseBtn.addEventListener("click", closeReviewPanel);
  renderSavedList();
}

init();

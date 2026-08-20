/**
 * save.js
 * "맛집 담기" 페이지 로직.
 * - server.py의 /api/search 를 호출해 카카오 로컬 검색 결과를 가져온다.
 * - 결과를 .place-card 로 렌더링한다.
 * - 카드의 "담기" 버튼은 storage.js의 savePlace()를 호출한다.
 * - 담은 목록(.saved-item)은 페이지 로드 시 + 변경 시마다 storage.js에서 다시 읽어 렌더링한다.
 *
 * ※ HTML class 구조는 save.html 상단 주석을 참고 (design 팀원과 공유된 구조).
 */

import {
  getSavedPlaces,
  savePlace,
  removePlace,
  isPlaceSaved,
} from "./storage.js";

// server.py가 기본 실행되는 주소. 배포 환경에 맞게 필요 시 조정.
const API_BASE_URL = "http://localhost:8000";

const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const categorySelect = document.getElementById("category-select");
const searchStatus = document.getElementById("search-status");
const placeCardList = document.getElementById("place-card-list");
const savedListItems = document.getElementById("saved-list-items");
const savedListEmpty = document.getElementById("saved-list-empty");

function setStatus(message) {
  searchStatus.textContent = message || "";
}

/** 카카오 검색 API 호출 */
async function fetchPlaces(query, categoryGroupCode) {
  const params = new URLSearchParams();
  if (query) params.set("query", query);
  if (categoryGroupCode) params.set("category_group_code", categoryGroupCode);

  const res = await fetch(`${API_BASE_URL}/api/search?${params.toString()}`);
  const data = await res.json();

  if (!res.ok) {
    const message =
      (data && data.error && (data.error.message || data.error)) ||
      "검색 중 오류가 발생했습니다.";
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }

  return data.documents || [];
}

/** 검색 결과 한 건(place)을 .place-card DOM으로 변환 */
function createPlaceCard(place) {
  const card = document.createElement("article");
  card.className = "place-card";
  card.dataset.placeId = place.id || "";

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

  if (place.place_url) {
    const link = document.createElement("a");
    link.className = "place-card__link";
    link.href = place.place_url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "카카오맵에서 보기";
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
  renderSavedList();
}

init();

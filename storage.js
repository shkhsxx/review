/**
 * storage.js
 * 담은 맛집 목록을 localStorage에 저장/조회/삭제하는 유틸.
 *
 * 저장 형식 (localStorage key: "todaywhattoeat_saved_places"):
 * [
 *   {
 *     id: "kakao-<place_id>",       // 카카오 place_id 기반 고유 id
 *                                   // (구글 검색 결과는 "google-<place_id>" 접두사를 사용한다.
 *                                   //  기존에 저장된 "kakao-" 데이터와는 접두사만 다를 뿐
 *                                   //  구조가 동일해 호환된다.)
 *     placeId: "26338954",
 *     name: "가게 이름",
 *     category: "음식점 > 한식",
 *     address: "지번 주소",
 *     roadAddress: "도로명 주소",
 *     phone: "02-1234-5678",
 *     link: "http://place.map.kakao.com/26338954",
 *     x: "127.111",                 // 경도
 *     y: "37.111",                  // 위도
 *     savedAt: 1690000000000        // Date.now()
 *   },
 *   ...
 * ]
 *
 * 전역 스크립트(<script src="storage.js">)로 로드하면 window에 아래 함수들이 노출된다.
 * 모듈(import)로도 사용 가능하도록 export도 함께 제공한다.
 */

const STORAGE_KEY = "todaywhattoeat_saved_places";

/** localStorage에서 저장된 전체 목록을 읽어온다. 파싱 실패 시 빈 배열. */
function getSavedPlaces() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("[storage.js] 저장된 목록을 불러오지 못했습니다:", err);
    return [];
  }
}

/** 전체 목록을 localStorage에 그대로 덮어쓴다. */
function _writeSavedPlaces(list) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

/**
 * 검색 결과 place로부터 안정적인 고유 id를 만든다.
 * place.source 값에 따라 접두사를 다르게 붙인다("kakao" | "google").
 * source가 없으면(기존 카카오 전용 코드와의 호환을 위해) 기본값은 "kakao"다.
 */
function buildPlaceId(place) {
  const prefix = place.source === "google" ? "google" : "kakao";
  if (place.id) return `${prefix}-${place.id}`;
  // id가 없을 때를 대비한 fallback (이름+주소 조합)
  return `${prefix}-${place.place_name || ""}-${place.address_name || ""}`;
}

/**
 * place를 담은 목록에 추가한다. 이미 담겨 있으면 중복 추가하지 않는다.
 * @param {object} place - 카카오 검색 결과 document 형태(또는 동일 필드를 가진 객체)
 * @returns {{added: boolean, list: object[]}} added: 실제로 새로 추가됐는지 여부
 */
function savePlace(place) {
  const id = buildPlaceId(place);
  const list = getSavedPlaces();

  if (list.some((item) => item.id === id)) {
    return { added: false, list };
  }

  const entry = {
    id,
    placeId: place.id || "",
    name: place.place_name || "",
    category: place.category_name || "",
    address: place.address_name || "",
    roadAddress: place.road_address_name || "",
    phone: place.phone || "",
    link: place.place_url || "",
    x: place.x || "",
    y: place.y || "",
    savedAt: Date.now(),
  };

  const nextList = [...list, entry];
  _writeSavedPlaces(nextList);
  return { added: true, list: nextList };
}

/** id로 담은 목록에서 하나를 제거한다. */
function removePlace(id) {
  const list = getSavedPlaces();
  const nextList = list.filter((item) => item.id !== id);
  _writeSavedPlaces(nextList);
  return nextList;
}

/** place(또는 place_name/id를 가진 원본 검색 결과)가 이미 담겨 있는지 확인한다. */
function isPlaceSaved(place) {
  const id = typeof place === "string" ? place : buildPlaceId(place);
  return getSavedPlaces().some((item) => item.id === id);
}

/** 담은 목록을 전부 비운다. */
function clearSavedPlaces() {
  _writeSavedPlaces([]);
  return [];
}

// 전역(스크립트 태그) 사용을 위해 window에 노출
if (typeof window !== "undefined") {
  window.SavedPlacesStorage = {
    getSavedPlaces,
    savePlace,
    removePlace,
    isPlaceSaved,
    clearSavedPlaces,
    buildPlaceId,
  };
}

// ES 모듈 import 사용을 위한 export (모듈로 로드될 경우에만 유효)
export {
  getSavedPlaces,
  savePlace,
  removePlace,
  isPlaceSaved,
  clearSavedPlaces,
  buildPlaceId,
};

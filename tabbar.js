/**
 * tabbar.js
 * 모바일 화면 하단 고정 탭바. index.html/save.html/mypage.html 어디서든
 * 주요 기능(홈/담기/취향찾기/인기/맛집주머니)으로 한 번에 이동할 수 있게 한다.
 * 라벨은 데스크톱 헤더/페이지 제목과 동일한 이름을 그대로 쓴다(휴리스틱: 일관성).
 * 데스크톱 폭에서는 style.css가 숨긴다(모바일 전용 내비게이션).
 *
 * `<script type="module" src="tabbar.js"></script>` 한 줄만 추가하면 어느
 * 페이지에서든 동작한다.
 */

const TABS = [
  {
    href: "index.html",
    label: "홈",
    match: (path) => path === "" || path === "index.html",
    icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 11.5 12 4l8 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 10v9a1 1 0 0 0 1 1h3v-5.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V20h3a1 1 0 0 0 1-1v-9" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`,
  },
  {
    href: "save.html",
    label: "담기",
    match: (path) => path === "save.html",
    icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="2"/><path d="m20 20-4.3-4.3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  },
  {
    href: "index.html#quiz",
    label: "취향찾기",
    match: () => false,
    icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M15 9l-2 6-4-1 2-6 4 1Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  },
  {
    href: "index.html#ranking",
    label: "인기",
    match: () => false,
    icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 3c2.2 2.6 4 5 4 7.8A4 4 0 0 1 12 15a4 4 0 0 1-4-4.2c0-1 .3-1.8.8-2.6.2 1.6 1 2 1.4 1 .3-2 .6-4.3 1.8-6.2Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 15a3 3 0 0 0 6 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  },
  {
    href: "mypage.html",
    label: "맛집주머니",
    match: (path) => path === "mypage.html",
    icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M7 9V7a5 5 0 0 1 10 0v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M5.5 9h13l1 10.5a2 2 0 0 1-2 2.2h-11a2 2 0 0 1-2-2.2L5.5 9Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`,
  },
];

function currentPage() {
  return location.pathname.split("/").pop();
}

function buildTabbar() {
  const page = currentPage();
  const nav = document.createElement("nav");
  nav.className = "tabbar";
  nav.setAttribute("aria-label", "주요 기능 이동");

  TABS.forEach((tab) => {
    const link = document.createElement("a");
    link.className = "tabbar__item";
    link.href = tab.href;
    if (tab.match(page)) link.classList.add("tabbar__item--active");

    const icon = document.createElement("span");
    icon.className = "tabbar__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = tab.icon;
    link.appendChild(icon);

    const label = document.createElement("span");
    label.className = "tabbar__label";
    label.textContent = tab.label;
    link.appendChild(label);

    nav.appendChild(link);
  });

  document.body.appendChild(nav);
}

buildTabbar();

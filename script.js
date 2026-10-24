// HTML에서 id가 year인 요소를 찾아 현재 연도를 표시합니다.
const yearElement = document.querySelector("#year");
if (yearElement) {
  yearElement.textContent = new Date().getFullYear();
}

const list = document.querySelector('#post-list');
const status = document.querySelector('#feed-status');
const retry = document.querySelector('#retry-feed');
const more = document.querySelector('#more-posts');
const filters = [...document.querySelectorAll('[data-filter]')];
let posts = [];
let selected = 'all';
let visibleCount = 6;
let feedFailed = false;

function manualPosts() {
  return (Array.isArray(window.J_LOG_MANUAL_POSTS) ? window.J_LOG_MANUAL_POSTS : []).flatMap(post => {
    let url;
    try { url = new URL(post.link); } catch { return []; }
    if (url.protocol !== 'https:' || url.hostname !== 'blog.naver.com' || !/^\/jy84570\/\d+\/?$/.test(url.pathname) || typeof post.title !== 'string') return [];
    url.search = '';
    url.hash = '';
    return [{ title: post.title, summary: String(post.summary || ''), link: url.href.replace(/\/$/, ''), date: new Date(post.date), category: String(post.category || '기록'), visibility: post.visibility, group: /여행|교환학생/.test(`${post.title} ${post.category}`) ? 'travel' : 'daily' }];
  });
}

function mergePosts(feedPosts) {
  const merged = new Map(feedPosts.map(post => [post.link.replace(/\/$/, ''), post]));
  // 수동 등록한 공개 범위와 도입부를 우선합니다.
  manualPosts().forEach(post => merged.set(post.link, post));
  posts = [...merged.values()].sort((a, b) => (b.date.getTime() || 0) - (a.date.getTime() || 0));
}

function textElement(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function renderPosts() {
  const filtered = posts.filter(post => selected === 'all' || post.group === selected);
  list.replaceChildren();
  for (const post of filtered.slice(0, visibleCount)) {
    const article = document.createElement('article');
    article.className = 'post';
    const meta = textElement('div', '', 'post-meta');
    meta.append(textElement('span', post.category));
    if (!Number.isNaN(post.date.getTime())) {
      const date = textElement('time', new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeZone: 'Asia/Seoul' }).format(post.date));
      date.dateTime = post.date.toISOString();
      meta.append(date);
    }
    const heading = document.createElement('h3');
    const link = textElement('a', post.title);
    link.href = post.link;
    heading.append(link);
    article.append(meta, heading, textElement('p', post.summary, 'post-summary'));
    if (post.visibility === 'neighbors') {
      article.append(textElement('span', '서로이웃 공개', 'visibility-badge'));
      article.append(textElement('p', '전체 글을 읽으려면 네이버 블로그에서 서로이웃을 신청해주세요. 승인 후 원문을 볼 수 있습니다.', 'neighbor-notice'));
      const neighbor = textElement('a', '블로그에서 서로이웃 신청하기 ↗', 'neighbor-link');
      neighbor.href = 'https://blog.naver.com/jy84570';
      article.append(neighbor);
    }
    const original = textElement('a', '네이버에서 이어 읽기 ↗', 'post-link');
    original.href = post.link;
    article.append(original);
    list.append(article);
  }
  status.textContent = filtered.length ? `${filtered.length}개의 기록 · 공개 피드와 직접 등록한 글` : '이 분류에는 아직 글이 없습니다.';
  if (feedFailed) status.textContent += ' · 네이버 자동 목록 연결에 실패했습니다. 다시 시도하거나 블로그에서 읽어주세요.';
  more.hidden = visibleCount >= filtered.length;
}

async function loadPosts() {
  retry.hidden = true;
  more.hidden = true;
  list.setAttribute('aria-busy', 'true');
  status.textContent = '기록을 불러오는 중입니다.';
  feedFailed = false;
  // GitHub Pages는 개인 Node 서버의 RSS 프록시를 실행할 수 없으므로,
  // 공개 배포본에서는 검토해 직접 등록한 글만 보여준다.
  if (location.hostname.endsWith('.github.io')) {
    mergePosts([]);
    renderPosts();
    status.textContent = posts.length ? `${posts.length}개의 직접 등록한 기록 · 원문은 네이버 블로그에서 읽을 수 있어요.` : '네이버 블로그에서 기록을 읽어주세요.';
    list.setAttribute('aria-busy', 'false');
    return;
  }
  try {
    const response = await fetch('/api/naver-feed', { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error('Feed unavailable');
    const xml = new DOMParser().parseFromString(await response.text(), 'application/xml');
    if (xml.querySelector('parsererror') || !xml.querySelector('rss > channel')) throw new Error('Invalid feed');
    const feedPosts = [...xml.querySelectorAll('channel > item')].flatMap(item => {
      const value = name => item.querySelector(name)?.textContent?.trim() || '';
      let url;
      try { url = new URL(value('link')); } catch { return []; }
      // 외부 피드의 HTML을 화면에 삽입하지 않고 텍스트로만 표시합니다.
      if (url.protocol !== 'https:' || url.hostname !== 'blog.naver.com' || !url.pathname.startsWith('/jy84570/')) return [];
      url.search = '';
      const description = new DOMParser().parseFromString(value('description'), 'text/html');
      description.querySelectorAll('script, style').forEach(node => node.remove());
      const summary = (description.body.textContent || '').replace(/\s+/g, ' ').trim();
      const title = value('title');
      const category = value('category') || '기록';
      return [{ title, category, link: url.href, date: new Date(value('pubDate')), summary: summary.length > 170 ? `${summary.slice(0, 170)}…` : summary, group: /여행|교환학생/.test(`${title} ${category}`) ? 'travel' : 'daily' }];
    });
    mergePosts(feedPosts);
    renderPosts();
  } catch {
    feedFailed = true;
    mergePosts([]);
    renderPosts();
    retry.hidden = false;
  } finally {
    list.setAttribute('aria-busy', 'false');
  }
}

filters.forEach(button => button.addEventListener('click', () => {
  selected = button.dataset.filter;
  visibleCount = 6;
  filters.forEach(filter => filter.setAttribute('aria-pressed', String(filter === button)));
  if (list.getAttribute('aria-busy') === 'false') renderPosts();
}));
more.addEventListener('click', () => { visibleCount += 6; renderPosts(); });
retry.addEventListener('click', loadPosts);
loadPosts();

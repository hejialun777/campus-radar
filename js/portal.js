/* ============================================================================
 * 首页逻辑 —— 由 js/projects.js 驱动渲染项目卡片
 * ========================================================================== */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function card(p, i) {
    return '' +
      '<article class="pcard pcard--' + esc(p.accent) + '" data-path="' + esc(p.path) + '" tabindex="0" role="link" ' +
        'aria-label="打开项目：' + esc(p.title) + '">' +

        '<div class="pcard__head">' +
          '<div class="pcard__icon">' + p.icon + '</div>' +
          '<div class="pcard__idnum">' + String(i + 1).padStart(2, '0') + '</div>' +
        '</div>' +

        '<div class="pcard__part">' + esc(p.part) + ' · ' + esc(p.subtitle) + '</div>' +
        '<h3 class="pcard__title">' + esc(p.title) + '</h3>' +
        '<p class="pcard__brief">' + esc(p.brief) + '</p>' +

        '<p class="pcard__problem"><span>面向场景</span>' + esc(p.problem) + '</p>' +

        '<div class="pcard__tags">' +
          (p.tags || []).map(function (t) {
            return '<span class="tag">' + esc(t) + '</span>';
          }).join('') +
        '</div>' +

        '<div class="pcard__stats">' +
          (p.stats || []).map(function (s) {
            return '<div class="pstat"><b>' + esc(s.n) + '</b><span>' + esc(s.l) + '</span></div>';
          }).join('') +
        '</div>' +

        '<details class="pcard__more">' +
          '<summary>看看它做了什么</summary>' +
          '<ul class="hi">' +
            (p.highlights || []).map(function (h) {
              return '<li><b>' + esc(h.name) + '</b><span>' + esc(h.desc) + '</span></li>';
            }).join('') +
          '</ul>' +
          '<p class="pcard__data">数据来源：' + esc(p.data) + '</p>' +
        '</details>' +

        '<div class="pcard__go">打开项目 <i>→</i></div>' +
      '</article>';
  }

  function render() {
    var grid = document.getElementById('grid');
    if (!grid) return;

    if (!PROJECTS.length) {
      grid.innerHTML = '<div class="empty">还没有项目。在 js/projects.js 里添加一条记录即可。</div>';
      return;
    }

    grid.innerHTML = PROJECTS.map(card).join('');

    var sp = document.getElementById('statProjects');
    if (sp) sp.textContent = PROJECTS.length;

    /* 整卡可点；点 details 的展开区时不要跳转 */
    grid.addEventListener('click', function (e) {
      if (e.target.closest('details')) return;
      var c = e.target.closest('[data-path]');
      if (c) location.href = c.getAttribute('data-path');
    });

    grid.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var c = e.target.closest('[data-path]');
      if (c) { e.preventDefault(); location.href = c.getAttribute('data-path'); }
    });
  }

  render();
})();

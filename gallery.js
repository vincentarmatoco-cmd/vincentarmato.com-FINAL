(function () {
  // Renders folder/manifest-driven galleries from photos.json.
  // A container opts in with:  <div class="js-gallery" data-gallery="game"></div>
  // It gets a Payday block (data.payday) pinned first, then the collage
  // (data.collage). Markup mirrors the original hand-authored collage so
  // styles.css and lightbox.js keep working unchanged.
  var mounts = Array.prototype.slice.call(
    document.querySelectorAll('.js-gallery[data-gallery]')
  );
  if (!mounts.length) return;

  function itemHTML(entry, opts) {
    // The anchor keeps the full-resolution file (lightbox target); the grid
    // tile itself uses the 800px thumb from photos/thumbs/.
    var src = entry.src;
    var thumb = entry.thumb || entry.src;
    var alt = (entry.alt || entry.caption || '').replace(/"/g, '&quot;');
    var cap = entry.caption || '';
    // Optional responsive support: manifest may supply `srcset` + `sizes`.
    var srcset = entry.srcset ? ' srcset="' + entry.srcset + '"' : '';
    var sizes = entry.sizes ? ' sizes="' + entry.sizes + '"' : '';
    var dims = entry.width && entry.height
      ? ' width="' + entry.width + '" height="' + entry.height + '"'
      : '';
    // The first few tiles are above the fold; the rest lazy-load.
    var loadAttr = opts && opts.eager ? '' : ' loading="lazy"';
    // No target="_blank": the lightbox handles clicks; if JS ever fails the
    // link opens in the same tab (never a jarring new tab on mobile).
    return (
      '<a class="collage-item" href="' + src + '">' +
        '<img src="' + thumb + '"' + srcset + sizes + dims + ' alt="' + alt + '"' +
          loadAttr + ' decoding="async" />' +
        '<span class="collage-caption">' + cap + '</span>' +
      '</a>'
    );
  }

  // Match the collage's responsive column counts (styles.css breakpoints).
  function columnCount() {
    var w = window.innerWidth;
    if (w <= 640) return 2;
    if (w <= 960) return 3;
    return 4;
  }

  function render(mount, data) {
    if (!data) return;
    // One seamless gallery: the best-* folder picks lead, the rest follow.
    // Items are dealt round-robin into shared columns, so picks 1-4 form the
    // top row (1-2 on mobile), the next picks the second row, and the rest
    // continue straight down the same columns — no seam, no gap, no crop.
    var entries = (data.payday || []).concat(data.collage || []);
    var count = columnCount();
    var cols = [];
    for (var c = 0; c < count; c++) cols.push([]);
    entries.forEach(function (e, i) {
      cols[i % count].push(itemHTML(e, { eager: i < count * 2 }));
    });

    mount.innerHTML =
      '<div class="collage-cols">' +
        cols.map(function (col) {
          return '<div class="collage-col">' + col.join('') + '</div>';
        }).join('') +
      '</div>';
  }

  var manifestData = null;

  function renderAll() {
    if (!manifestData) return;
    mounts.forEach(function (mount) {
      render(mount, manifestData[mount.getAttribute('data-gallery')]);
    });
  }

  fetch('photos.json', { cache: 'no-cache' })
    .then(function (r) {
      if (!r.ok) throw new Error('photos.json ' + r.status);
      return r.json();
    })
    .then(function (manifest) {
      manifestData = manifest;
      renderAll();
    })
    .catch(function (err) {
      // On failure, leave the <noscript>/fallback markup already in the DOM.
      if (window.console) console.error('gallery.js:', err);
    });

  // Re-deal the columns when a resize crosses a breakpoint.
  var lastCount = columnCount();
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      var next = columnCount();
      if (next !== lastCount) {
        lastCount = next;
        renderAll();
      }
    }, 150);
  });
})();

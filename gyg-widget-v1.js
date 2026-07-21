(() => {
  'use strict';

  const partnerId = 'X3LLOUG';
  const consentKey = 'sailhalong_analytics_consent_v1';
  const loaderUrl = 'https://widget.getyourguide.com/dist/pa.umd.production.min.js';
  const activityIds = {
    'best-halong-bay-cruises': '828604,463074,589002',
    'halong-bay-cruises': '422336,659753,354835',
    'halong-bay-day-trips-from-hanoi': '422336,828604,551314',
    'halong-bay-overnight-cruises': '659753,205941,354835'
  };

  let active = false;
  let mutationObserver;
  let loaderPending = false;

  const hasConsent = () => {
    try {
      return window.localStorage.getItem(consentKey) === 'granted';
    } catch {
      return false;
    }
  };

  const addStyles = () => {
    if (document.getElementById('sailhalong-gyg-styles')) return;
    const style = document.createElement('style');
    style.id = 'sailhalong-gyg-styles';
    style.textContent = `
      .sailhalong-gyg-shell {
        width: 100%;
        max-width: 100%;
        margin-top: 1.25rem;
        overflow: hidden;
        border-radius: 0.75rem;
        contain: layout paint style;
        container-type: inline-size;
      }
      .sailhalong-gyg-shell[data-gyg-state="loading"] {
        background: rgba(250, 247, 239, 0.72);
      }
      .sailhalong-gyg-shell iframe {
        display: block;
        width: 100%;
        max-width: 100%;
        border: 0;
      }
      .sailhalong-gyg-loading {
        display: flex;
        min-height: 463px;
        align-items: center;
        justify-content: center;
        padding: 1rem;
        color: rgba(13, 35, 45, 0.7);
        font-size: 0.8125rem;
        text-align: center;
      }
      [data-gyg-enhanced="true"] > a[href*="getyourguide.com"] {
        margin-top: 1.25rem;
      }
      @container (max-width: 580px) {
        .sailhalong-gyg-loading {
          min-height: calc(164cqw + 520px);
        }
      }
    `;
    document.head.appendChild(style);
  };

  const runLoader = () => {
    if (loaderPending) return;
    loaderPending = true;

    const previous = document.querySelector('script[data-sailhalong-gyg-loader]');
    if (previous) previous.remove();

    const script = document.createElement('script');
    script.async = true;
    script.defer = true;
    script.src = loaderUrl;
    script.dataset.gygPartnerId = partnerId;
    script.dataset.sailhalongGygLoader = 'true';
    script.addEventListener('load', () => {
      loaderPending = false;
      document.querySelectorAll('.sailhalong-gyg-shell').forEach((shell) => {
        shell.dataset.gygState = 'loaded';
        const loading = shell.querySelector('.sailhalong-gyg-loading');
        if (loading) loading.remove();
      });
    }, { once: true });
    script.addEventListener('error', () => {
      loaderPending = false;
      document.querySelectorAll('.sailhalong-gyg-shell').forEach((shell) => {
        shell.dataset.gygState = 'failed';
        const loading = shell.querySelector('.sailhalong-gyg-loading');
        if (loading) loading.textContent = 'Live activities are temporarily unavailable. Use the GetYourGuide link below.';
      });
    }, { once: true });
    document.head.appendChild(script);
  };

  const observeWidget = (shell) => {
    if (!('IntersectionObserver' in window)) {
      runLoader();
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      runLoader();
    }, { rootMargin: '360px 0px' });
    observer.observe(shell);
  };

  const enhance = () => {
    if (!active) return;

    document.querySelectorAll('[data-affiliate-cta="true"][data-cta-position="end"]').forEach((cta) => {
      const slug = cta.dataset.articleSlug;
      const ids = activityIds[slug];
      if (!ids || cta.dataset.gygEnhanced === 'true') return;

      cta.dataset.gygEnhanced = 'true';
      const shell = document.createElement('div');
      shell.className = 'sailhalong-gyg-shell';
      shell.dataset.gygState = 'loading';
      shell.setAttribute('aria-label', 'Current GetYourGuide activities');

      const widget = document.createElement('div');
      widget.dataset.gygHref = 'https://widget.getyourguide.com/default/activities.frame';
      widget.dataset.gygLocaleCode = 'en-US';
      widget.dataset.gygWidget = 'activities';
      widget.dataset.gygNumberOfItems = '3';
      widget.dataset.gygPartnerId = partnerId;
      widget.dataset.gygTourIds = ids;
      widget.innerHTML = '<span>Powered by <a target="_blank" rel="sponsored noopener" href="https://www.getyourguide.com/bahia-de-ha-long-l934/">GetYourGuide</a></span>';

      const loading = document.createElement('p');
      loading.className = 'sailhalong-gyg-loading';
      loading.textContent = 'Loading current GetYourGuide activities…';

      shell.append(widget, loading);
      const fallback = cta.querySelector(':scope > a[href*="getyourguide.com"]');
      if (fallback) cta.insertBefore(shell, fallback);
      else cta.appendChild(shell);
      observeWidget(shell);
    });
  };

  const activate = () => {
    if (active || !hasConsent()) return;
    active = true;
    addStyles();
    enhance();

    mutationObserver = new MutationObserver(() => enhance());
    mutationObserver.observe(document.body, { childList: true, subtree: true });
  };

  const start = () => {
    activate();
    const accept = document.getElementById('analytics-consent-accept');
    if (accept) accept.addEventListener('click', () => window.setTimeout(activate, 0));
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();

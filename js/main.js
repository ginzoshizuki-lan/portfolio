(() => {
  'use strict';

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ============================================
     Year (footer)
     ============================================ */
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ============================================
     Hero scroll progress (sticky-driven animation)
     ============================================ */
  const heroSection = document.querySelector('.hero');
  const root = document.documentElement;

  if (heroSection && !prefersReducedMotion) {
    let ticking = false;

    const updateHeroProgress = () => {
      const rect = heroSection.getBoundingClientRect();
      const total = heroSection.offsetHeight - window.innerHeight;
      const scrolled = -rect.top;
      let progress = total > 0 ? scrolled / total : 0;
      progress = Math.max(0, Math.min(1, progress));
      root.style.setProperty('--hero-progress', progress.toFixed(4));
      ticking = false;
    };

    const onScroll = () => {
      if (!ticking) {
        requestAnimationFrame(updateHeroProgress);
        ticking = true;
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    updateHeroProgress();
  } else if (heroSection && prefersReducedMotion) {
    /* reduced-motion: 最終状態を即時表示 */
    root.style.setProperty('--hero-progress', '1');
  }

  /* ============================================
     Nav: scrolled / over-hero state
     ============================================ */
  const nav = document.getElementById('nav');
  if (nav) {
    const updateNavState = () => {
      const scrolledPast = window.scrollY > 16;
      nav.classList.toggle('is-scrolled', scrolledPast);

      const heroEl = document.querySelector('.hero');
      if (heroEl) {
        const heroBottom = heroEl.offsetTop + heroEl.offsetHeight;
        const stickyHeroEnd = heroEl.offsetTop + heroEl.offsetHeight - window.innerHeight;
        const isOverHero = window.scrollY < stickyHeroEnd;
        nav.classList.toggle('is-over-hero', isOverHero);
      }
    };

    window.addEventListener('scroll', updateNavState, { passive: true });
    window.addEventListener('resize', updateNavState, { passive: true });
    updateNavState();
  }

  /* ============================================
     Mobile nav toggle
     ============================================ */
  const navToggle = document.querySelector('.nav__toggle');
  const navMenu = document.getElementById('nav-menu');

  if (navToggle && navMenu) {
    const setOpen = (open) => {
      navToggle.setAttribute('aria-expanded', String(open));
      navMenu.classList.toggle('is-open', open);
      document.body.style.overflow = open ? 'hidden' : '';
    };

    navToggle.addEventListener('click', () => {
      const isOpen = navToggle.getAttribute('aria-expanded') === 'true';
      setOpen(!isOpen);
    });

    /* Close on link click */
    navMenu.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => setOpen(false));
    });

    /* Close on Escape */
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && navToggle.getAttribute('aria-expanded') === 'true') {
        setOpen(false);
        navToggle.focus();
      }
    });
  }

  /* ============================================
     Reveal-on-scroll (IntersectionObserver)
     ============================================ */
  const revealTargets = document.querySelectorAll(
    '.intro__copy, .project, .manifesto__grid article, .profile__block, .media-item, .contact__email'
  );

  revealTargets.forEach((el) => el.classList.add('reveal'));

  /* Stagger delays for grid siblings */
  if (!prefersReducedMotion) {
    [
      { sel: '.project-list .project',              delay: 70 },
      { sel: '.manifesto__grid article',             delay: 90 },
      { sel: '.media-list .media-item',               delay: 80 },
    ].forEach(({ sel, delay }) => {
      document.querySelectorAll(sel).forEach((el, i) => {
        el.style.transitionDelay = `${i * delay}ms`;
      });
    });
  }

  if ('IntersectionObserver' in window && !prefersReducedMotion) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );

    revealTargets.forEach((el) => io.observe(el));
  } else {
    revealTargets.forEach((el) => el.classList.add('is-visible'));
  }
})();

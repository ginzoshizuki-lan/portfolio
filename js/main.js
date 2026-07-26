(() => {
  'use strict';
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* Nav scrolled state */
  const nav = document.getElementById('nav');
  if (nav) {
    const update = () => nav.classList.toggle('is-scrolled', window.scrollY > 24);
    window.addEventListener('scroll', update, { passive: true });
    update();
  }

  /* Mobile nav */
  const navToggle = document.querySelector('.nav__toggle');
  const navMenu = document.getElementById('nav-menu');
  if (navToggle && navMenu) {
    const setOpen = (open) => {
      navToggle.setAttribute('aria-expanded', String(open));
      navMenu.classList.toggle('is-open', open);
      document.body.style.overflow = open ? 'hidden' : '';
    };
    navToggle.addEventListener('click', () => {
      setOpen(navToggle.getAttribute('aria-expanded') !== 'true');
    });
    navMenu.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setOpen(false)));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && navToggle.getAttribute('aria-expanded') === 'true') {
        setOpen(false); navToggle.focus();
      }
    });
  }

  /* Reveal on scroll */
  const targets = document.querySelectorAll(
    '.intro__pull, .intro__sub, .project, .about__card, .profile__block, .writing-card, .contact__inner > *, .section-head'
  );
  targets.forEach((el) => el.classList.add('reveal'));

  if (!prefersReducedMotion) {
    [
      { sel: '.project',       step: 90 },
      { sel: '.about__card',   step: 130 },
      { sel: '.writing-card',  step: 100 },
      { sel: '.profile__block', step: 90 },
    ].forEach(({ sel, step }) => {
      document.querySelectorAll(sel).forEach((el, i) => {
        el.style.transitionDelay = `${i * step}ms`;
      });
    });
  }

  if ('IntersectionObserver' in window && !prefersReducedMotion) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -60px 0px' });
    targets.forEach((el) => io.observe(el));
  } else {
    targets.forEach((el) => el.classList.add('is-visible'));
  }

  /* Hero video
     The shot is a one-way flight, so it cannot loop without a visible jump.
     Instead it plays once on arrival and decelerates into a hold; scrolling
     back up to the hero replays it. */
  const heroVisual = document.querySelector('.hero__visual');
  const heroVideo = document.getElementById('hero-video');
  if (heroVisual && heroVideo) {
    const RAMP = 2.2;      // seconds of deceleration at the tail
    const MIN_RATE = 0.12;
    let raf = 0;

    const decelerate = () => {
      const dur = heroVideo.duration;
      if (dur && isFinite(dur)) {
        const left = dur - heroVideo.currentTime;
        if (left <= RAMP) {
          const t = Math.max(0, left / RAMP);
          heroVideo.playbackRate = MIN_RATE + (1 - MIN_RATE) * t;
        }
      }
      if (!heroVideo.paused && !heroVideo.ended) raf = requestAnimationFrame(decelerate);
    };

    const play = () => {
      if (prefersReducedMotion) return;
      cancelAnimationFrame(raf);
      heroVideo.playbackRate = 1;
      if (heroVideo.readyState >= 1) {
        try { heroVideo.currentTime = 0; } catch (_) {}
      }
      const p = heroVideo.play();
      if (p && p.catch) p.catch(() => {});
      raf = requestAnimationFrame(decelerate);
    };

    const reveal = () => heroVisual.classList.add('has-video');
    if (heroVideo.readyState >= 2) reveal();
    else heroVideo.addEventListener('loadeddata', reveal, { once: true });
    heroVideo.addEventListener('error', () => heroVisual.classList.remove('has-video'));

    play();

    if ('IntersectionObserver' in window && !prefersReducedMotion) {
      let wasOut = false;
      new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) { wasOut = true; return; }
          if (wasOut) { wasOut = false; play(); }
        });
      }, { threshold: 0.55 }).observe(heroVisual);
    }
  }
})();

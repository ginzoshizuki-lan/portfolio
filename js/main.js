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
})();

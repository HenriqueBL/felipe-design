"use client";

import { useEffect } from "react";

const SCROLL_THRESHOLD = 60;

export default function HeaderScrollState() {
  useEffect(() => {
    const header = document.querySelector(".site-header");
    if (!header) return;

    const update = () => {
      header.classList.toggle("scrolled", window.scrollY > SCROLL_THRESHOLD);
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return null;
}
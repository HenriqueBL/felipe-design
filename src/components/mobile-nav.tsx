"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Locale } from "@/lib/i18n/config";
import {
  aboutPath,
  galleryPath,
  homePath,
  accountPath,
  servicesPath,
} from "@/lib/paths";
import AuthNav from "./auth-nav";
import CartBadge from "./cart/cart-badge";

interface MobileNavLabels {
  home: string;
  services: string;
  about: string;
  gallery: string;
  account: string;
  login: string;
  logout: string;
  cart: string;
}

export default function MobileNav({
  locale,
  labels,
}: {
  locale: Locale;
  labels: MobileNavLabels;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close drawer on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        className="mobile-nav-toggle"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        aria-controls="mobile-nav-drawer"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      <div
        id="mobile-nav-drawer"
        className={`mobile-nav-drawer ${open ? "open" : ""}`}
        role="dialog"
        aria-modal={open}
        aria-label="Navigation menu"
      >
        <button
          className="mobile-nav-close"
          onClick={() => setOpen(false)}
          aria-label="Close menu"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>

        <Link href={homePath(locale)} onClick={() => setOpen(false)}>
          {labels.home}
        </Link>
        <Link href={servicesPath(locale)} onClick={() => setOpen(false)}>
          {labels.services}
        </Link>
        <Link href={galleryPath(locale)} onClick={() => setOpen(false)}>
          {labels.gallery}
        </Link>
        <Link href={aboutPath(locale)} onClick={() => setOpen(false)}>
          {labels.about}
        </Link>
        <Link href={accountPath(locale)} onClick={() => setOpen(false)}>
          {labels.account}
        </Link>

        <AuthNav locale={locale} labels={{ login: labels.login, logout: labels.logout }} />
        <CartBadge locale={locale} label={labels.cart} />

        <div className="locale-switch">
          <Link href="/en" aria-label="English" onClick={() => setOpen(false)}>
            EN
          </Link>
          <Link href="/pt" aria-label="Português" onClick={() => setOpen(false)}>
            PT
          </Link>
        </div>
      </div>
    </>
  );
}
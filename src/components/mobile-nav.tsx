"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n/config";
import AuthNav from "@/components/auth-nav";
import CartBadge from "@/components/cart/cart-badge";
import {
  homePath,
  servicesPath,
  aboutPath,
  galleryPath,
  accountPath,
} from "@/lib/paths";

export interface MobileNavLabels {
  home: string;
  services: string;
  about: string;
  gallery: string;
  account: string;
  login: string;
  logout: string;
  cart: string;
  openMenu: string;
  closeMenu: string;
  navigationMenu: string;
}

interface MobileNavProps {
  locale: Locale;
  labels: MobileNavLabels;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function MobileNav({ locale, labels }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // Close drawer on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape key closes drawer
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, close]);

  // Focus trap: keep focus inside drawer while open
  useEffect(() => {
    if (!open) return;
    const drawer = drawerRef.current;
    if (!drawer) return;

    // Move focus to first focusable element on open
    const focusables = Array.from(
      drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    );
    const firstFocusable = focusables[0];
    if (firstFocusable) {
      requestAnimationFrame(() => firstFocusable.focus());
    }

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const currentFocusables = Array.from(
        drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (currentFocusables.length === 0) return;

      const first = currentFocusables[0];
      const last = currentFocusables[currentFocusables.length - 1];
      if (!first || !last) return;

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleTab);
    return () => document.removeEventListener("keydown", handleTab);
  }, [open]);

  // Body scroll lock
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
        ref={triggerRef}
        type="button"
        className="mobile-nav-trigger"
        aria-expanded={open}
        aria-controls="mobile-nav-drawer"
        aria-label={labels.openMenu}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">☰</span>
      </button>

      {open && (
        <div
          className="mobile-nav-backdrop"
          aria-hidden="true"
          onClick={close}
        />
      )}

      <div
        ref={drawerRef}
        id="mobile-nav-drawer"
        role="dialog"
        aria-modal={open}
        aria-label={labels.navigationMenu}
        className={`mobile-nav-drawer ${open ? "open" : ""}`}
      >
        <div className="mobile-nav-header">
          <button
            type="button"
            className="mobile-nav-close"
            aria-label={labels.closeMenu}
            onClick={close}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        <nav className="mobile-nav-links">
          <Link href={homePath(locale)} onClick={close}>
            {labels.home}
          </Link>
          <Link href={servicesPath(locale)} onClick={close}>
            {labels.services}
          </Link>
          <Link href={aboutPath(locale)} onClick={close}>
            {labels.about}
          </Link>
          <Link href={galleryPath(locale)} onClick={close}>
            {labels.gallery}
          </Link>
          <Link href={accountPath(locale)} onClick={close}>
            {labels.account}
          </Link>
          <CartBadge locale={locale} label={labels.cart} />
          {/* AuthNav is rendered inside the drawer on mobile so users can sign out */}
          <AuthNav locale={locale} labels={{ login: labels.login, logout: labels.logout }} />
        </nav>
      </div>
    </>
  );
}